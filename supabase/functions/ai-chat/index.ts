/**
 * KOCHKO AI CHAT - Main Edge Function
 * Spec Sections: 5.1-5.33
 *
 * Flow:
 * 1. Auth + rate limit check
 * 2. Detect task mode from message
 * 3. Build 4-layer context
 * 4. Generate response (text or vision)
 * 5. Guardrail validation
 * 6. Extract + execute actions
 * 7. Extract Layer 2 updates (async)
 * 8. Store conversation
 */
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { chatCompletion, buildVisionContent, TEMPERATURE, MODELS } from '../shared/openai.ts';
import { supabaseAdmin, getUserId } from '../shared/supabase-admin.ts';
import { updateLayer2 } from '../shared/memory.ts';
import { sanitizeText, detectEmergency, detectCrisis, detectEDRisk, checkAllergens, extractDeclaredAllergens, ALLERGEN_FOODS, sanitizeUserInput, extractInjuredBodyParts, findInjuryConflictsInText } from '../shared/guardrails.ts';
import { validateMealParse } from '../shared/output-validator.ts';
import { checkRateLimit } from '../shared/rate-limit.ts';
import { validateChatRequest, checkPayloadSize } from '../shared/request-validator.ts';
import { analyzeMessage, getRetrievalPlan } from '../shared/retrieval-planner.ts';
import { buildContextFromPlan } from '../shared/context-builders.ts';
import { selectModel } from '../shared/model-router.ts';
import { BASE_SYSTEM_PROMPT, buildConfidenceNote } from './system-prompt.ts';
import { detectTaskMode, getModeInstructions, type TaskMode } from './task-modes.ts';
import {
  detectRepairIntent, handleUndo, buildCorrectionContext,
  shouldDetectPersona, buildPersonaDetectionPrompt, getMessageCount,
  getToneContext, buildKnowledgeSummary, getRepairContext,
} from '../shared/repair-handler.ts';
import { getAllServiceContexts, checkHabitFromChat } from '../shared/service-contexts.ts';
import { projectDailyPlanRows, type DietPlanData, type WorkoutPlanData } from '../shared/plan-projection.ts';
import { getEffectiveDateForUser, shiftDateString } from '../shared/day-boundary.ts';
import { isIFCompatible, type PeriodicState } from '../shared/periodic-config.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // T1.10: Request validation
    const sizeCheck = checkPayloadSize(req.headers.get('content-length'));
    if (!sizeCheck.valid) return respond({ error: sizeCheck.error }, 413);

    const userId = await getUserId(req);
    const body = await req.json();

    const validation = validateChatRequest(body);
    if (!validation.valid) return respond({ error: validation.error }, 400);

    const { message, image_base64, target_date, audio_base64, session_id, task_mode_hint, client_timezone, plan_type, user_approved, draft_id } = body;

    // Voice (Whisper STT) and photo (gpt-4o vision) are declared Premium features
    // (premium-gate.ts photo_logging/voice_input) but were never enforced anywhere —
    // free users got unlimited gpt-4o vision + STT, and the transcribe path below
    // even returned BEFORE rate-limiting (uncapped Whisper cost) (#R6-3). Gate both
    // server-side here. (The premium test account still uses them normally.)
    const usesPremiumIO = !!image_base64 || (!!audio_base64 && !!body.transcribe_only);
    if (usesPremiumIO) {
      const { data: ioProfile } = await supabaseAdmin.from('profiles').select('premium, premium_expires_at').eq('id', userId).maybeSingle();
      // #R2-M2: gate on ACTIVE premium (boolean AND not-expired), not the boolean alone —
      // the daily cron has a 1-day grace so an expired user keeps premium=true ~2 days.
      const ioActive = ioProfile?.premium === true && (!ioProfile.premium_expires_at || new Date(ioProfile.premium_expires_at as string) > new Date());
      if (!ioActive) {
        if (audio_base64 && body.transcribe_only) {
          return respond({ error: 'Sesli giriş Premium özelliğidir.', code: 'PREMIUM_REQUIRED' }, 403);
        }
        const photoUpsell = 'Fotoğrafla otomatik öğün analizi Premium bir özellik. Premium\'a geçince fotoğraftan kalori ve makroları çıkarabilirim. Şimdilik öğününü yazarak da kaydedebilirsin.';
        // Persist the turn so the photo attempt + upsell appears in chat history,
        // like every other early-return path (#R7-4).
        await storeMessages(userId, message?.trim() || '[Foto gönderildi]', photoUpsell, undefined, undefined, undefined, undefined, session_id);
        return respond({ message: photoUpsell, actions: [], task_mode: 'coaching' });
      }
    }

    // GAP 2: STT/Whisper transcription handler
    if (audio_base64 && body.transcribe_only) {
      const audioBuffer = Uint8Array.from(atob(audio_base64), (c: string) => c.charCodeAt(0));
      const formData = new FormData();
      formData.append('file', new File([audioBuffer], 'audio.m4a', { type: 'audio/m4a' }));
      formData.append('model', 'whisper-1');
      const whisperRes = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}` },
        body: formData,
      });
      const whisperData = await whisperRes.json() as { text?: string; error?: unknown };
      if (!whisperRes.ok) return respond({ error: whisperData.error ?? 'Transcription failed' }, 500);
      return respond({ transcription: whisperData.text ?? '' });
    }

    if (!message?.trim() && !image_base64) {
      return respond({ error: 'message or image required' }, 400);
    }

    // SAFETY FIRST (Spec 5.5 / 12.5): emergency + high-risk eating-disorder
    // screening runs BEFORE the prompt-injection guard and rate limit. A genuine
    // crisis ("ölmek istiyorum") must ALWAYS reach the 112 / crisis referral even
    // if the message also contains injection-shaped phrases or the user is rate-
    // limited — otherwise an injection match would short-circuit a distressed user
    // into the dismissive coach rejection (#R2-8).
    if (message) {
      const emergency = detectEmergency(message);
      if (emergency.isEmergency) {
        await storeMessages(userId, message, emergency.message, 'emergency', undefined, undefined, undefined, session_id);
        return respond({ message: emergency.message, actions: [], task_mode: 'emergency' });
      }
      // Self-harm / suicide crisis — MUST run before the ED check so a suicidal
      // message gets the acute crisis response (112 + professional help), never
      // the milder eating-disorder dietitian referral (#R1-C2).
      const crisis = detectCrisis(message);
      if (crisis.isCrisis) {
        await storeMessages(userId, message, crisis.message, 'safety', undefined, undefined, undefined, session_id);
        return respond({ message: crisis.message, actions: [], task_mode: 'safety' });
      }
      const edRisk = detectEDRisk(message);
      if (edRisk.isRisk && edRisk.severity === 'high') {
        await storeMessages(userId, message, edRisk.message, 'safety', undefined, undefined, undefined, session_id);
        return respond({ message: edRisk.message, actions: [], task_mode: 'safety' });
      }
      // Medium severity: continue normal flow but AI will see ED_REFERRAL in sanitized output
    }

    // Prompt injection detection (Spec 5.26) — after crisis screening
    let injectionDetected = false;
    if (message) {
      const injection = sanitizeUserInput(message);
      injectionDetected = injection.injectionDetected;
      if (injectionDetected) {
        const rejectMsg = 'Ben Kochko, beslenme ve antrenman kocunum. Bu konuda sana yardimci olamam ama beslenme veya sporla ilgili sorun varsa konusalim.';
        await storeMessages(userId, message, rejectMsg, undefined, undefined, undefined, undefined, session_id);
        return respond({ message: rejectMsg, actions: [], task_mode: 'coaching' });
      }
    }

    // Rate limiting (Spec 16.4)
    const preliminaryTaskMode = message ? detectTaskMode(message, false) : 'coaching';
    const isRecordParse = preliminaryTaskMode === 'register';
    const rateLimit = await checkRateLimit(userId, isRecordParse);
    if (!rateLimit.allowed) {
      return respond({
        message: rateLimit.message,
        actions: [],
        task_mode: 'rate_limited',
        rate_limited: true,
        remaining: 0,
      }, 200);
    }

    // Repair intent detection — BEFORE task mode (Spec 5.32)
    if (message) {
      const repairIntent = detectRepairIntent(message);

      // Handle direct undo requests
      if (repairIntent.type === 'undo') {
        const undoResult = await handleUndo(userId);
        await storeMessages(userId, message, undoResult.response ?? '', undefined, undefined, undefined, undefined, session_id);
        return respond({ message: undoResult.response, actions: [], task_mode: 'repair' });
      }

      // "Benim hakkımda ne biliyorsun?" handler (Spec 5.18)
      const knowledgePatterns = /benim hakkimda|beni tan[iı]|ne [oö]grendin|ne biliyorsun|beni ne kadar/i;
      if (knowledgePatterns.test(message)) {
        const summary = await buildKnowledgeSummary(userId);
        await storeMessages(userId, message, summary, undefined, undefined, undefined, undefined, session_id);
        return respond({ message: summary, actions: [], task_mode: 'knowledge' });
      }
    }

    // Check onboarding status
    const { data: profile } = await supabaseAdmin
      .from('profiles').select('onboarding_completed, gender, calorie_range_rest_min, calorie_range_rest_max, calorie_range_training_min, calorie_range_training_max, protein_per_kg, weight_kg, home_timezone, active_timezone, day_boundary_hour')
      .eq('id', userId).maybeSingle();
    const isOnboarding = !profile?.onboarding_completed;

    // The user's *effective* calendar day (Spec 2.8): late-night logs before
    // day_boundary_hour belong to the previous day, computed in the user's own
    // timezone — NOT the server's UTC date. Every logged_for_date / daily-keyed
    // write below must use this (or an explicit target_date backdate).
    const userTz = (client_timezone as string | undefined)
      ?? (profile?.active_timezone as string | null)
      ?? (profile?.home_timezone as string | null);
    const effectiveToday = getEffectiveDateForUser(userTz, profile?.day_boundary_hour as number | null);

    // Return-flow detection is now handled by service-contexts.ts (richer context with weight, compliance history)

    // Detect task mode (Spec 5.2)
    const taskMode = detectTaskMode(message ?? '', isOnboarding);
    // Phase 2/3/5 plan-negotiation modes (plan_diet/plan_workout/daily_log) are driven by the
    // client's explicit task_mode_hint — detectTaskMode can never produce them. Prefer the hint
    // so the <plan_snapshot> contract inside getModeInstructions actually reaches the model.
    const HINT_MODES = ['plan_diet', 'plan_workout', 'daily_log'];
    const effectiveMode: TaskMode = (typeof task_mode_hint === 'string' && HINT_MODES.includes(task_mode_hint))
      ? (task_mode_hint as TaskMode)
      : taskMode;

    // Analyze message for subtype + risk + retrieval needs (Retrieval Planner v2)
    const analysis = analyzeMessage(message ?? '', taskMode);
    const retrievalPlan = getRetrievalPlan(analysis);

    // Build scoped context based on retrieval plan
    const ctx = await buildContextFromPlan(userId, retrievalPlan, session_id);

    // Assemble system prompt = base + mode instructions + confidence note + persona/tone/repair context
    const modeInstructions = getModeInstructions(effectiveMode);
    const confidenceNote = buildConfidenceNote(ctx.contextMeta);

    // Persona detection trigger (Spec 5.15: after 100+ messages)
    let personaPrompt = '';
    const personaNeeded = await shouldDetectPersona(userId);
    if (personaNeeded) {
      const msgCount = await getMessageCount(userId);
      if (msgCount >= 100) {
        personaPrompt = buildPersonaDetectionPrompt(msgCount);
      }
    }

    // Tone context from learned preferences (Spec 5.9)
    const toneContext = await getToneContext(userId);

    // Repair context — frequent corrections (Spec 5.32)
    const repairContext = await getRepairContext(userId);

    // Correction mode — if user said "yanlış anladın"
    let correctionCtx = '';
    if (message) {
      const repairCheck = detectRepairIntent(message);
      if (repairCheck.type === 'correction') {
        correctionCtx = buildCorrectionContext(userId);
      }
    }

    // Household size for recipe scaling (Spec 7.7)
    let householdNote = '';
    if (taskMode === 'recipe') {
      const { data: pRow } = await supabaseAdmin
        .from('profiles').select('household_size').eq('id', userId).maybeSingle();
      const hh = (pRow?.household_size as number | null) ?? 1;
      if (hh > 1) {
        householdNote = `HANEHALKI: ${hh} kisi. Tarifi ${hh} porsiyon icin uret, toplam + kisi basi makrolari AYRI goster.`;
      }
    }

    // "Elimde X var" — ingredient-based saved recipe match (Spec 7.7)
    let pantryRecipesNote = '';
    if (taskMode === 'recipe' && message) {
      const lower = message.toLocaleLowerCase('tr');
      const hasPantryCue = /elimde|evde|dolapta|sahip oldug|buzdolab/.test(lower);
      if (hasPantryCue) {
        // Extract likely ingredient tokens: strip Turkish cue words, split by commas/spaces
        const cleaned = lower
          .replace(/elimde|evde sadece|evde|dolabımda|dolapta|var|sahip oldug[ua]m|buzdolabında|ne yapabilirim|ne yapsam|tarif/g, ' ')
          .replace(/[.,;:!?]/g, ' ')
          .trim();
        const tokens = cleaned.split(/\s+/).filter((t: string) => t.length >= 3).slice(0, 8);

        if (tokens.length > 0) {
          // Fetch all saved recipes and rank by token overlap
          const { data: savedRecipes } = await supabaseAdmin
            .from('saved_recipes')
            .select('id, title, ingredients, total_calories, total_protein, prep_time_min, servings')
            .eq('user_id', userId)
            .limit(50);

          if (savedRecipes && savedRecipes.length > 0) {
            type RecipeRow = { id: string; title: string; ingredients: { name: string }[]; total_calories: number | null; total_protein: number | null; prep_time_min: number | null; servings: number };
            const scored = (savedRecipes as RecipeRow[]).map(r => {
              const names = (r.ingredients ?? []).map(i => i.name?.toLocaleLowerCase('tr') ?? '');
              const matched = names.filter((n: string) => tokens.some((t: string) => n.includes(t) || t.includes(n.split(' ')[0] ?? '')));
              const matchPct = names.length > 0 ? Math.round((matched.length / names.length) * 100) : 0;
              return { r, matchPct, matched: matched.length };
            });
            const top = scored
              .filter(s => s.matchPct >= 40 || s.matched >= 2)
              .sort((a, b) => b.matchPct - a.matchPct)
              .slice(0, 3);

            if (top.length > 0) {
              const lines = top.map(s => `- ${s.r.title} (%${s.matchPct} malzeme eslesmesi, ${s.r.total_calories ?? '?'} kcal, ${s.r.prep_time_min ?? '?'}dk)`);
              pantryRecipesNote = `\n\nELINDEKI MALZEMELERDEN KUTUPHANEN'DE ESLESEN TARIFLER (oncelik bunlara ver):\n${lines.join('\n')}\nEger bu tarifler yeterli esleserse onlari oner. Yoksa mevcut malzemelerle yeni tarif uret.`;
            }
          }
        }
      }
    }

    // A7: Remaining macro budget for recipe mode
    let remainingMacrosNote = '';
    if (taskMode === 'recipe') {
      try {
        const todayStr = effectiveToday;
        const { data: todayLogs } = await supabaseAdmin
          .from('meal_logs')
          .select('id')
          .eq('user_id', userId)
          .eq('logged_for_date', todayStr)
          .eq('is_deleted', false);
        if (todayLogs && todayLogs.length > 0) {
          const logIds = todayLogs.map((l: { id: string }) => l.id);
          const { data: items } = await supabaseAdmin
            .from('meal_log_items')
            .select('calories, protein_g, carbs_g, fat_g')
            .in('meal_log_id', logIds);
          const consumed = (items ?? []).reduce(
            (acc: { cal: number; prot: number; carbs: number; fat: number }, it: { calories: number; protein_g: number; carbs_g: number; fat_g: number }) => ({
              cal: acc.cal + (it.calories ?? 0),
              prot: acc.prot + (it.protein_g ?? 0),
              carbs: acc.carbs + (it.carbs_g ?? 0),
              fat: acc.fat + (it.fat_g ?? 0),
            }),
            { cal: 0, prot: 0, carbs: 0, fat: 0 }
          );
          const calTarget = Math.round(
            ((profile?.calorie_range_rest_min ?? 1800) + (profile?.calorie_range_rest_max ?? 2200)) / 2
          );
          const protTarget = Math.round(
            (profile?.weight_kg ?? 70) * (profile?.protein_per_kg ?? 1.8)
          );
          const calRemaining = Math.max(0, calTarget - consumed.cal);
          const protRemaining = Math.max(0, protTarget - consumed.prot);
          remainingMacrosNote = `KALAN MAKRO BUTCESI: Bugun ${Math.round(consumed.cal)} kcal yenildi, ${calRemaining} kcal kaldi. Protein: ${Math.round(consumed.prot)}g yenildi, ${protRemaining}g kaldi. Karbonhidrat: ${Math.round(consumed.carbs)}g yenildi. Yag: ${Math.round(consumed.fat)}g yenildi.`;
        }
      } catch { /* macro calc non-critical */ }
    }

    // D12: Service contexts — habits, progressive disclosure, recovery, return-flow,
    // eating-out, MVD, predictive risk, caffeine-sleep, adaptive difficulty, conflicts, travel
    const serviceCtx = await getAllServiceContexts(userId, taskMode, {
      message: message ?? '',
      clientTimezone: client_timezone as string | undefined,
    });

    // Task card context: when user taps an onboarding card, inject topic-specific instructions.
    // Each topic has a MINIMUM CHECKLIST — as soon as those fields are collected (via conversation
    // or already in Layer 1), the AI MUST emit <layer2_update> to mark the task complete and tell
    // the user to return to the dashboard for the next task. No plan making, no open-ended chat.
    let taskCardCtx = '';
    if (task_mode_hint && typeof task_mode_hint === 'string' && task_mode_hint.startsWith('onboarding_')) {
      const topicKey = task_mode_hint.replace('onboarding_', '');
      type Topic = { title: string; taskKey: string; fields: string[]; brief: string };
      const TOPICS: Record<string, Topic> = {
        intro:          { title: 'Kendini tanitma',           taskKey: 'introduce_yourself', fields: ['boy (cm)', 'kilo (kg)', 'yas', 'cinsiyet'], brief: 'Dort temel: boy, kilo, yas, cinsiyet.' },
        goal:           { title: 'Hedef belirleme',           taskKey: 'set_goal',           fields: ['ana hedef (kilo ver / kas kazan / saglikli kal)', 'hedef kilo', 'neden'], brief: 'Ana hedef + hedef kilo + motivasyon.' },
        routine:        { title: 'Gunluk rutin',              taskKey: 'daily_routine',      fields: ['meslek', 'calisma saatleri', 'aktivite duzeyi'], brief: 'Meslek + calisma saati + aktivite.' },
        eating:         { title: 'Beslenme aliskanliklari',   taskKey: 'eating_habits',      fields: ['ogun sayisi', 'yeme saatleri', 'disarida yeme sikligi', 'atistirma aliskanligi'], brief: 'Ogun sayisi + saatler + disarida yeme.' },
        allergies:      { title: 'Alerji ve hassasiyetler',   taskKey: 'allergies',          fields: ['alerjik yiyecekler', 'intoleranslar', 'sindirim sorunlari'], brief: 'Alerji + intolerans + sindirim.' },
        kitchen:        { title: 'Mutfak imkanlari',          taskKey: 'kitchen_logistics',  fields: ['pisirme becerisi', 'butce', 'ekipman', 'hazirlama suresi'], brief: 'Beceri + butce + ekipman + sure.' },
        exercise:       { title: 'Spor gecmisi',              taskKey: 'exercise_history',   fields: ['deneyim seviyesi', 'hangi sporlar', 'tercih edilen tur', 'antrenman saatleri'], brief: 'Deneyim + tercih + saatler.' },
        health:         { title: 'Saglik gecmisi',            taskKey: 'health_history',     fields: ['ameliyatlar', 'kronik hastaliklar', 'ilaclar', 'hormon durumu'], brief: 'Ameliyat + hastalik + ilac + hormon.' },
        weight_history: { title: 'Kilo gecmisi',              taskKey: 'weight_history',     fields: ['denenmis diyetler', 'sonuclari', 'neden birakildi'], brief: 'Diyet gecmisi + sonuc + birakma sebebi.' },
        labs:           { title: 'Kan tahlilleri',            taskKey: 'lab_values',         fields: ['son tahlil tarihi', 'anormal degerler', 'doktor yorumu'], brief: 'Son tahlil + anormaller + yorum.' },
        sleep:          { title: 'Uyku duzeni',               taskKey: 'sleep_patterns',     fields: ['yatis saati', 'kalkis saati', 'uyku kalitesi', 'uyku sorunlari'], brief: 'Yatis + kalkis + kalite.' },
        stress:         { title: 'Stres ve motivasyon',       taskKey: 'stress_motivation',  fields: ['stres seviyesi', 'stres kaynagi', 'motivasyon kaynagi', 'en buyuk zorluk'], brief: 'Stres + motivasyon + zorluk.' },
        home:           { title: 'Ev ve cevre faktorleri',    taskKey: 'home_environment',   fields: ['evde yemek yapan kim', 'evde diyet yapmayan var mi', 'sosyal yeme baskisi'], brief: 'Evdeki yemek + sosyal baski.' },
      };
      const topic = TOPICS[topicKey];
      if (topic) {
        taskCardCtx = [
          '### BU SOHBETIN TEK AMACI: ' + topic.title.toUpperCase(),
          '(Kullanici ana sayfadaki "' + topic.title + '" kartina basarak bu sohbeti acti. Baska hicbir amac YOK.)',
          '',
          'BU GOREVIN KONTROL LISTESI — SADECE bu ' + topic.fields.length + ' alan:',
          ...topic.fields.map((f, i) => `  [${i + 1}] ${f}`),
          '',
          'BU ALANLAR DISINDAKI HERHANGI BIR SEYI SORMA. ORNEKLER:',
          (topic.taskKey === 'introduce_yourself'
            ? '  - Hedef sorma (bu "set_goal" gorevi, AYRI kart). Kullaniciya "Hedefini Hedefini Belirle kartindan konusalim" de, asla bu sohbette sorma.\n  - Beslenme aliskanligi sorma (ayri kart). Aktivite/rutin sorma (ayri kart).'
            : topic.taskKey === 'set_goal'
            ? '  - Boy/kilo/yas sorma (Kendini Tanit kartinda sorulur). Sadece hedef ve motivasyon.'
            : '  - Kendi konusunun disinda kalan her sey AYRI bir kart/gorev — bu sohbette ele ALMA.'),
          '',
          'AKIS:',
          '1. ILK MESAJDA: Layer 1 verisinden hangi alanlarin zaten dolu oldugunu tespit et, TEKRAR SORMA. Sadece ekisikleri SIRAYLA sor (tek soru kuralina uy).',
          '2. Yeni bilgi gelince MUTLAKA <actions> ile kaydet — bu ZORUNLU. Kullanicinin verdigi bilgiyi tekrar etme, liste yapma, "Su ana kadar bildiklerim: ..." ASLA DEME.',
          '3. Tum ' + topic.fields.length + ' alan tamam olunca veya kullanici "bilmiyorum/gec" dediginde DERHAL su uc seyi ayni mesajda yap:',
          '   (a) Kisa 1-cumle kapanis: "Bu konuda yeterli bilgi aldim, tesekkurler."',
          '   (b) Yonlendirme: "Ana sayfadan diger kartlara gecerek profilini tamamlayabilirsin."',
          '   (c) Mesajin SONUNA bu blogu ekle (ATLAMA, aksi halde gorev kartta kapanmaz):',
          `       <layer2_update>{"onboarding_task_completed": "${topic.taskKey}"}</layer2_update>`,
          '4. Kapanistan sonra baska soru SORMA, ayni konuyu uzatma.',
          '',
          '### <actions> EMIT ZORUNLU — ORNEK SENARYOLAR:',
          (topic.taskKey === 'introduce_yourself'
            ? 'Kullanici "191 boyundayim, 130 kilo, 25 yas, erkegim" derse son mesajin SONUNA SU BLOGU EKLE:\n<actions>[{"type":"profile_update","height_cm":191,"weight_kg":130,"birth_year":2001,"gender":"male"}]</actions>\nEksik alanlari o an gelenleri kaydet, hepsi topland\u0131g\u0131nda kapanis+<layer2_update> emit et.'
            : topic.taskKey === 'set_goal'
            ? '\u00d6RNEK 1 — Hedef tipi: Kullanici "kilo vermek ve kas kazanmak" derse (ikisi birden istenirse ana olani sec — 100kg+ birinde lose_weight olmali):\n<actions>[{"type":"profile_update","goal_type":"lose_weight"}]</actions>\n\n\u00d6RNEK 2 — Hedef kilo: Sen "hedeflediginiz kilo nedir?" diye sordun. Kullanici "100" veya "90 kg" veya "90 kilo" dedi. Bu MUTLAKA target_weight_kg\'dir, weight_kg DEGILDIR — kullanicinin mevcut kilosu zaten Layer 1\'de var.\n<actions>[{"type":"profile_update","target_weight_kg":100}]</actions>\n\n\u00d6RNEK 3 — Motivasyon: "saglikli olmak, iyi gozukmek":\n<actions>[{"type":"profile_update","motivation_source":"saglik_ve_gorunum"}]</actions>\n\nHEPSI tamamlandiginda son mesajda <layer2_update>{"onboarding_task_completed":"set_goal"}</layer2_update> EKLE. Tam olarak bu yazimla — "set_goal" string\'i AYNEN.\n\n\u26a0 DIKKAT: Bu sohbette weight_kg\'a ASLA yazma. Kullanicinin mevcut kilosu zaten Layer 1\'de, "Kendini Tanit" kartinda kaydedildi. Burada SADECE target_weight_kg yazarsin.'
            : topic.taskKey === 'eating_habits'
            ? 'Ornek: "gunde 3 ogun, disarda haftada 2 kere yerim":\n<actions>[{"type":"profile_update","meal_count_preference":3,"eating_out_frequency":"weekly"}]</actions>'
            : topic.taskKey === 'exercise_history'
            ? 'Ornek: "2 yildir fitness yapiyorum, ev de gym de gidebilirim":\n<actions>[{"type":"profile_update","training_experience":"intermediate","equipment_access":"both"}]</actions>'
            : 'Kullanici yeni bilgi verdiginde uygun profile_update alanlari ile <actions> emit et. Kaydetme BU SOHBETIN EN ONEMLI GOREVI.'),
          '',
          'KESIN YASAKLAR:',
          '- Kullanicinin verdigi bilgiyi geri okuma/listelekme. "25 yasindasin, 130 kg, 191 cm, erkek" gibi rapor yazma. Kullanici ne soyledigini biliyor.',
          '- "Kaydettim", "Profiline ekledim", "Profilini guncelledim", "Not aldim", "Bilgilerini aldim" ifadelerini KULLANMA. UI rozeti zaten gosteriyor.',
          '- Plan/supplement/kalori/antrenman onerisi YOK — bu sohbet bilgi toplama icin.',
          '- Kontrol listesi disindaki alani SORMA, ONERME, TARTISMA.',
          '- <actions> blogu olmadan kapanis yapma — veri kaydedilmez, gorev bosa gider.',
        ].join('\n');
      }
    }

    // Fresh-session opener: when there's NO chat history yet (layer4 empty) and the
    // user's first message isn't itself a log/topic, do NOT lead with proactive
    // habit/predictive nudges — that's what made a brand-new chat open with an
    // irrelevant "su iç" (water) reminder instead of responding to the user (#3/#R3-4).
    const firstMsgIsLog = !!message && (looksLikeMealReport(message) || looksLikeWorkoutReport(message));
    const freshOpener = ctx.layer4.length === 0 && !firstMsgIsLog;

    const systemPrompt = [
      BASE_SYSTEM_PROMPT,
      // Task card instructions come right after BASE so they are prominent — they override
      // default onboarding-mode ambition and keep the session narrowly scoped.
      taskCardCtx,
      modeInstructions,
      confidenceNote,
      toneContext,
      personaPrompt,
      correctionCtx,
      // Service contexts (11 integrated services)
      serviceCtx.returnFlow,           // 4. Return flow (richer: weight, compliance, plan lightening)
      freshOpener ? '' : serviceCtx.habits.prompt,        // 1. Habits — suppressed on a cold opener (#R3-4)
      serviceCtx.progressiveDisclosure,// 2. Progressive disclosure (features to introduce)
      serviceCtx.recovery,             // 3. Recovery (only in recovery mode)
      serviceCtx.eatingOut,            // 5. Eating out (only in eating_out mode)
      serviceCtx.mvd,                  // 6. MVD (only in mvd mode)
      freshOpener ? '' : serviceCtx.predictiveRisk.prompt,// 7. Predictive risk — suppressed on a cold opener (#R3-4)
      serviceCtx.caffeineSleep,        // 8. Caffeine-sleep correlation
      serviceCtx.adaptiveDifficulty,   // 9. Adaptive difficulty suggestions
      serviceCtx.conflicts,            // 10. Conflict detection (allergen, goal-behavior)
      serviceCtx.travel,               // 11. Travel/timezone context
      ctx.layer1 ? `--- KULLANICI HAKKINDA ---\n\n${ctx.layer1}` : '',
      ctx.layer2 ? `--- AI OZETI ---\n\n${ctx.layer2}` : '',
      ctx.layer3 ? `--- SON VERILER ---\n\n${ctx.layer3}` : '',
      repairContext,
      remainingMacrosNote,
      pantryRecipesNote,
      householdNote,
    ].filter(Boolean).join('\n\n');

    // Build messages array
    const gptMessages: { role: string; content: string | unknown[] }[] = [
      { role: 'system', content: systemPrompt },
    ];

    // Add chat history (Layer 4)
    for (const msg of ctx.layer4) {
      gptMessages.push({ role: msg.role, content: msg.content });
    }

    // Add current message
    if (image_base64) {
      gptMessages.push({
        role: 'user',
        content: buildVisionContent(message ?? 'Bu fotodaki yemekleri analiz et.', image_base64),
      });
    } else {
      gptMessages.push({ role: 'user', content: message });
    }

    // Call OpenAI (Spec 5.27: temperature by mode, model router for tier selection)
    const modelSelection = selectModel(analysis, !!image_base64, effectiveMode);
    const temperature = TEMPERATURE[taskMode] ?? 0.5;

    let assistantMessage = await chatCompletion<string>(
      gptMessages as { role: 'system' | 'user' | 'assistant'; content: string | unknown[] }[],
      { model: modelSelection.model, temperature, maxTokens: modelSelection.maxTokens }
    );

    // Guardrail: sanitize medical language (Spec 12.3)
    const { clean } = sanitizeText(assistantMessage);
    assistantMessage = clean;

    // Extract actions
    const { cleanMessage, actions } = extractActions(assistantMessage);
    assistantMessage = cleanMessage;

    // Fallback: if AI didn't produce actions but user gave profile info, extract manually
    // Post-process: strip verbal save acknowledgements that keep slipping past the
    // prompt rules. These phrases are explicitly banned; we find and remove them
    // deterministically so the user never sees them even when the model ignores
    // instructions. Matches at sentence boundaries to avoid mid-word damage.
    assistantMessage = stripVerbalAcknowledgements(assistantMessage);

    // Regex fallback: fill in profile fields the model might have skipped
    // (target_weight_kg, goal_type, motivation_source are the common misses).
    // Existing action fields take precedence. GATED to onboarding / onboarding_* task
    // chats only: outside onboarding its bare "NN kg" regex misreads a workout/recipe
    // weight (e.g. "bench press 4x8 70kg") as bodyweight and silently overwrites
    // profiles.weight_kg, corrupting calorie/protein targets.
    // Onboarding gets FULL regex extraction (incl. bodyweight). Regular chat gets the
    // SAFE subset (age/gender/height/target — no ambiguous bodyweight) so an
    // unambiguous profile statement still persists deterministically when the model
    // SAYS it saved but omits the <actions> block (#1/#2/#5 — confirmed in live test).
    const fullExtraction = isOnboarding
      || (typeof task_mode_hint === 'string' && task_mode_hint.startsWith('onboarding_'));
    if (message) {
      const regexExtracted = extractProfileFromMessage(message, task_mode_hint as string | undefined, !fullExtraction);
      if (regexExtracted) {
        const existingProfileAction = actions.find(a => a.type === 'profile_update') as Record<string, unknown> | undefined;
        if (existingProfileAction) {
          // Merge: only fill in fields the AI didn't set.
          for (const [k, v] of Object.entries(regexExtracted)) {
            if (!(k in existingProfileAction) || existingProfileAction[k] == null) {
              existingProfileAction[k] = v;
            }
          }
        } else if (Object.keys(regexExtracted).length > 0) {
          actions.push({ type: 'profile_update', ...regexExtracted });
        }
      }
    }

    // Meal-log safety net (Part B): the model intermittently reports a meal verbally
    // ("2 yumurta yedim") but omits the <actions> meal_log block, so nothing is saved
    // yet the reply looks like a confirmation. When the user message clearly reports an
    // eaten meal, no meal_log action is present, and we're in a logging mode, we run a
    // SECOND focused model call constrained to emit ONLY the meal_log <actions> block,
    // parse it, and inject the action so the existing executeActions(...) below logs it
    // in ONE shot — no fragile "Evet" follow-up that detectTaskMode misroutes. If the
    // forced extraction fails to produce a parseable meal_log, we fall back to the old
    // explicit-confirm prompt (zero DB write on that path → zero double-log risk).
    // GUARD: only runs on the miss path (no meal_log action already present) and only
    // for register/daily_log meal reports, so the working path is never touched and a
    // meal is never double-logged.
    if (message
      && looksLikeMealReport(message)
      && !actions.some(a => a.type === 'meal_log')
      && (effectiveMode === 'register' || effectiveMode === 'daily_log')) {
      console.warn('[meal_safety_net] meal intent, no meal_log action — attempting forced extraction', { mode: effectiveMode });
      const forcedAction = await forceMealLogAction(message, modelSelection.model);
      if (forcedAction) {
        actions.push(forcedAction);
        console.warn('[meal_safety_net] forced meal_log injected', { meal_type: forcedAction.meal_type, items: (forcedAction.items as unknown[] | undefined)?.length ?? 0 });
        // Let the normal flow + executeActions feedback run. Only synthesize a short
        // acknowledgement if the model's original reply was empty (otherwise its own
        // narration — "harika, ~350 kcal" — is fine and the UI shows the saved chip).
        if (!assistantMessage.trim()) {
          assistantMessage = 'Tamamdir, ogununu kaydediyorum.';
        }
      } else {
        // Couldn't parse a meal_log — keep the existing explicit-confirm fallback.
        console.warn('[meal_safety_net] forced extraction returned null — falling back to confirm prompt');
        assistantMessage = 'Bunu ogun olarak kaydedeyim mi? "Evet" dersen kalori ve makrolariyla ekleyeyim - istersen porsiyonlari biraz netlestir, daha dogru hesaplarim.';
      }
    }

    // Workout-log safety net (mirror of the meal net): natural-phrasing strength
    // reports ("bench press 4x8 65 kg kaldirdim") intermittently get a
    // conversational reply with NO workout_log action — the workout silently
    // vanishes. Same single forced-extraction call pattern, zero double-log risk.
    if (message
      && looksLikeWorkoutReport(message)
      && !actions.some(a => a.type === 'workout_log')
      && (effectiveMode === 'register' || effectiveMode === 'daily_log')) {
      console.warn('[workout_safety_net] workout intent, no workout_log action — attempting forced extraction');
      const forcedWorkout = await forceWorkoutLogAction(message, modelSelection.model);
      if (forcedWorkout) {
        actions.push(forcedWorkout);
        console.warn('[workout_safety_net] forced workout_log injected');
        if (!assistantMessage.trim()) assistantMessage = 'Antrenmanini kaydediyorum, eline saglik!';
      }
    }

    // Weight-log safety net — deterministic (#R1-H3): "81.5 kg geldim/oldum/tartıldım".
    // The model intermittently asserts the save in prose but omits the weight_log
    // action. Gated to a clear bodyweight report (intent verb) and NOT an exercise
    // weight ("bench press 60kg"), so a strength log can never be misread.
    if (message
      && !actions.some(a => a.type === 'weight_log')
      && !actions.some(a => a.type === 'profile_update' && (a as Record<string, unknown>).weight_kg !== undefined)
      && (effectiveMode === 'register' || effectiveMode === 'daily_log')) {
      const mW = message.toLocaleLowerCase('tr');
      const exerciseCtx = /(bench|press|squat|deadlift|curl|lunge|set|\d+\s*tekrar|tekrar\s*\d|\brep\b|kaldir|kaldır|\d+\s*x\s*\d+|x\d)/.test(mW);
      const bodyIntent = /(geldim|oldum|tartild|tartıld|tart[ıi]m|kiloyum|kilodayim|kilodayım|kiloya dust|kiloya düşt|sabah)/.test(mW);
      if (!exerciseCtx && bodyIntent) {
        const wm = mW.match(/\b(\d{2,3}(?:[.,]\d)?)\s*(?:kg|kilo)\b/);
        if (wm) {
          const w = parseFloat(wm[1].replace(',', '.'));
          if (w >= 30 && w <= 300) { actions.push({ type: 'weight_log', value: w }); console.warn('[weight_safety_net] weight_log injected', { w }); }
        }
      }
    }

    // Sleep-log safety net — deterministic (#R1-H4): "7 saat uyudum".
    if (message
      && !actions.some(a => a.type === 'sleep_log')
      && (effectiveMode === 'register' || effectiveMode === 'daily_log')) {
      const mS = message.toLocaleLowerCase('tr');
      const sm = mS.match(/(\d{1,2}(?:[.,]\d)?)\s*saat\s*(?:uyu|uyku)/);
      if (sm) {
        const h = parseFloat(sm[1].replace(',', '.'));
        if (h > 0 && h < 24) {
          const quality = /(iyi|kaliteli|rahat|derin)/.test(mS) ? 'good' : /(kotu|kötü|berbat|kesik|huzursuz|az uyu)/.test(mS) ? 'bad' : undefined;
          actions.push({ type: 'sleep_log', hours: h, quality });
          console.warn('[sleep_safety_net] sleep_log injected', { h, quality });
        }
      }
    }

    // Water-log safety net — deterministic (#R1-H6): "2 litre su içtim", "3 bardak su".
    if (message
      && !actions.some(a => a.type === 'water_log')
      && (effectiveMode === 'register' || effectiveMode === 'daily_log')) {
      const mWa = message.toLocaleLowerCase('tr');
      if (/su\s*(ic|iç)|water|sivi ald|sıvı ald/.test(mWa)) {
        const litreM = mWa.match(/(\d+(?:[.,]\d+)?)\s*(?:litre|lt|l)\b/);
        const bardakM = mWa.match(/(\d+)\s*bardak/);
        let liters = 0;
        if (litreM) liters = parseFloat(litreM[1].replace(',', '.'));
        else if (bardakM) liters = parseInt(bardakM[1]) * 0.25;
        if (liters > 0 && liters <= 15) { actions.push({ type: 'water_log', liters }); console.warn('[water_safety_net] water_log injected', { liters }); }
      }
    }

    // Supplement-log safety net — deterministic (#R1-H6): "her sabah kreatin alıyorum".
    // NOT mode-gated: habitual present-tense supplement statements route to 'coaching',
    // not 'register', so a register-only gate dropped them (live-verified). The strict
    // intake-verb + KNOWN-supplement-keyword + not-an-advice-question guards keep it from
    // misfiring on questions ("kreatin almalı mıyım?") or food protein mentions.
    if (message
      && !actions.some(a => a.type === 'supplement_log')) {
      const mSup = message.toLocaleLowerCase('tr');
      if (/(al[ıi]yorum|al[ıi]rim|kullan[ıi]yorum|ald[ıi]m|iç(iyorum|erim)|içtim)/.test(mSup) && !/almal[ıi]|al[sş]am m[ıi]|kullan(mal[ıi]|sam)/.test(mSup)) {
        const SUPPS = ['multivitamin', 'kreatin', 'creatine', 'whey', 'protein tozu', 'omega 3', 'omega-3', 'balık yağı', 'balik yagi', 'magnezyum', 'çinko', 'cinko', 'd vitamini', 'vitamin d', 'b12', 'probiyotik', 'glutamin', 'bcaa'];
        const found = SUPPS.filter((s) => mSup.includes(s));
        for (const name of found) actions.push({ type: 'supplement_log', name });
        if (found.length) console.warn('[supplement_safety_net] supplement_log injected', { found });
      }
    }

    // IF safety net — fully deterministic (no AI call): the model verbally
    // "configures" IF while emitting no action (live audit, twice). Window
    // times parse straight out of the user message.
    if (message
      && /(aralikli oruc|aralıklı oruç|intermittent fasting|\b1[468]\s*[:\/]\s*\d{1,2}\b|20\s*[:\/]\s*4|yeme penceresi)/i.test(message)
      && !actions.some(a => a.type === 'profile_update' && (a as Record<string, unknown>).if_active !== undefined)) {
      const stopIntent = /(birak|bırak|son ver|istemiyorum|kapat|bitir)/i.test(message);
      const winMatch = message.match(/(\d{1,2}[:.]\d{2})\s*[-–—ila]+\s*(\d{1,2}[:.]\d{2})/);
      const ratioMatch = message.match(/\b(1[468]|20)\s*[:\/]\s*(\d{1,2})\b/);
      const normTime = (t: string) => {
        const [h, m] = t.replace('.', ':').split(':');
        return `${h.padStart(2, '0')}:${m}`;
      };
      if (stopIntent) {
        actions.push({ type: 'profile_update', if_active: false });
        console.warn('[if_safety_net] IF deactivation injected');
      } else if (winMatch) {
        actions.push({
          type: 'profile_update',
          if_active: true,
          if_window: ratioMatch ? `${ratioMatch[1]}:${ratioMatch[2]}` : '16:8',
          if_eating_start: normTime(winMatch[1]),
          if_eating_end: normTime(winMatch[2]),
        });
        console.warn('[if_safety_net] IF setup injected', { start: normTime(winMatch[1]), end: normTime(winMatch[2]) });
      }
    }

    // Allergy safety net — deterministic: "çilek alerjim var", "deniz ürünleri
    // alerjim var", "laktoz intoleransım var". The allergen guardrails read ONLY
    // food_preferences, and the model skips the food_preference action often enough
    // (live audit) that a chat-declared allergy would otherwise protect nobody.
    // Two layers (#R1-H1/H8): (1) dictionary scan that captures multi-word/category
    // allergens by their CANONICAL name ("deniz ürünleri", not the fragment
    // "ürünlerine"); (2) single-noun fallback for allergens not in the dictionary
    // (çilek, kivi, fasulye...).
    if (message && !actions.some(a => (a as Record<string, unknown>).type === 'food_preference')) {
      const mAll = message.toLocaleLowerCase('tr');
      const negated = /(alerjim yok|alerjisi yok|intoleransim yok|intoleransım yok|alerji yok|intolerans yok)/.test(mAll);
      const hasIntent = /(alerj|intolerans)/.test(mAll);
      if (!negated && hasIntent) {
        const severe = /(ciddi|şiddetli|siddetli|agir|ağır|anafilaksi)/.test(mAll);
        const declared = extractDeclaredAllergens(message);
        const emitted = new Set<string>();
        for (const food of declared) {
          emitted.add(food);
          actions.push({ type: 'food_preference', food_name: food, preference: 'never', is_allergen: true, allergen_severity: severe ? 'severe' : 'moderate' });
        }
        // Single-noun fallback ONLY when the dictionary found nothing (unknown allergen).
        if (declared.length === 0) {
          const allergyMatch = mAll.match(/([a-zçğıöşü]{3,})\s+alerji/);
          const intoleranceMatch = mAll.match(/([a-zçğıöşü]{3,})\s+intolerans/);
          const food = allergyMatch?.[1] ?? intoleranceMatch?.[1];
          const STOPWORDS = new Set(['bir', 'hic', 'hiç', 'gida', 'gıda', 'besin', 'yok', 'ciddi', 'hafif', 'ayrica', 'ayrıca', 'bence', 'galiba', 'sanirim', 'sanırım', 'bende', 'benim', 'tum', 'tüm', 'her']);
          if (food && !STOPWORDS.has(food) && !emitted.has(food)) {
            actions.push({ type: 'food_preference', food_name: food, preference: 'never', is_allergen: true, allergen_severity: severe ? 'severe' : 'moderate' });
            emitted.add(food);
          }
        }
        if (emitted.size > 0) console.warn('[allergy_safety_net] food_preference injected', { foods: [...emitted], severe });
      }
    }

    // Injury safety net — deterministic (#R1-M5): "belimde fıtık var", "dizim ağrıyor".
    // The injury guardrail reads ONLY health_events; the model skips the health_event
    // action often enough that a chat-declared injury would otherwise protect nobody.
    // Fires only when an injury CUE word co-occurs with a recognised body part.
    if (message && !actions.some(a => (a as Record<string, unknown>).type === 'health_event')) {
      const mInj = message.toLocaleLowerCase('tr');
      const injuryCue = /(sakat|incin|burkul|fitik|fıtık|agri|ağrı|agriy|ağrıy|tutuldu|zorlan|kirec|kireç|menisk|ameliyat|koptu|zedele|yirtild|yırtıld|ağrim|agrim|sorunum var)/.test(mInj);
      const parts = injuryCue ? extractInjuredBodyParts([message]) : [];
      if (parts.length > 0) {
        // #R3: dedup — the net fires on EVERY message with an injury cue, so a user
        // discussing the same injury across turns produced duplicate health_events rows.
        // Skip if an existing health_event already covers all the mentioned body parts.
        const { data: existingHE } = await supabaseAdmin
          .from('health_events').select('description').eq('user_id', userId).limit(50);
        const covered = new Set(extractInjuredBodyParts((existingHE ?? []).map((r: { description: string }) => r.description)));
        const fresh = parts.some((p) => !covered.has(p));
        if (fresh) {
          // #R3: 'ameliyat/operasyon' is a SURGERY (past event), not an ongoing injury.
          const isSurgery = /(ameliyat|operasyon|protez|artroskopi)/.test(mInj);
          actions.push({ type: 'health_event', event_type: isSurgery ? 'surgery' : 'injury', description: message.slice(0, 280), is_ongoing: !isSurgery });
          console.warn('[injury_safety_net] health_event injected', { parts, isSurgery });
        }
      }
    }

    // Venue safety net — deterministic (#R2-M3): "Starbucks'ta latte ictim" routes to
    // register (meal_log captures the food) but the venue_log action that builds venue
    // memory (user_venues) never fired, so eating-out memory was unreachable. Detect a
    // known brand or venue word + a visit/consumption verb and record the venue visit.
    if (message && !actions.some(a => a.type === 'venue_log')) {
      const mVen = message.toLocaleLowerCase('tr');
      const visited = /(ictim|içtim|yedim|gittim|ugradim|uğradım|aldim|aldım|siparis|sipariş)/.test(mVen);
      const BRANDS = ['starbucks', 'mcdonald', 'burger king', 'big chefs', 'kfc', 'popeyes', 'dominos', "domino's", 'subway', 'kahve dunyasi', 'kahve dünyası', 'gloria jean', 'tavuk dunyasi', 'tavuk dünyası', 'simit sarayi', 'simit sarayı', 'arbys', "arby's", 'sbarro'];
      const brand = BRANDS.find(b => mVen.includes(b));
      const hasVenueWord = /(restoran|lokanta|kafe|kafeterya|cafe|kafede|disarida yedim|dışarıda yedim)/.test(mVen);
      if (visited && (brand || hasVenueWord)) {
        // Capitalize a known brand nicely; otherwise a generic label.
        const venueName = brand ? brand.replace(/\b\w/g, (c) => c.toUpperCase()) : 'Restoran';
        actions.push({ type: 'venue_log', venue_name: venueName, items: [] });
        console.warn('[venue_safety_net] venue_log injected', { venueName });
      }
    }

    // Micro-goal target safety net (#R3): "günlük su hedefim 3.5 litre", "adım hedefim
    // 12000". The model claimed it saved these but emitted no usable action. Fires only
    // on an explicit target intent (hedef + the metric word) so it can't misfire on a log.
    if (message
      && !actions.some(a => a.type === 'profile_update' && ((a as Record<string, unknown>).water_target_liters !== undefined || (a as Record<string, unknown>).step_target !== undefined))) {
      const mT = message.toLocaleLowerCase('tr');
      if (/hedef/.test(mT)) {
        const upd: Record<string, unknown> = {};
        if (/(su|sıvı|sivi)/.test(mT)) { const mm = mT.match(/(\d+(?:[.,]\d+)?)\s*(?:litre|lt|l)\b/); if (mm) { const v = parseFloat(mm[1].replace(',', '.')); if (v > 0 && v <= 10) upd.water_target_liters = v; } }
        if (/(adim|adım|step)/.test(mT)) { const mm = mT.match(/(\d{4,6})/); if (mm) { const v = parseInt(mm[1]); if (v >= 1000 && v <= 50000) upd.step_target = v; } }
        if (Object.keys(upd).length > 0) { actions.push({ type: 'profile_update', ...upd }); console.warn('[microgoal_safety_net] target injected', upd); }
      }
    }

    // Goal safety net: goal statements ("3 ayda 5 kilo vermek istiyorum, hedefim
    // 70") were lost 5/5 in the live audit — the model answers conversationally
    // and omits the actions block despite prompt rules. Forced extraction of the
    // goal fields into a profile_update action.
    if (message
      && looksLikeGoalIntent(message)
      && !actions.some(a => a.type === 'profile_update' && ((a as Record<string, unknown>).goal_type || (a as Record<string, unknown>).target_weight_kg))
      && !actions.some(a => a.type === 'goal_suggestion')) {
      console.warn('[goal_safety_net] goal intent, no goal action — attempting forced extraction');
      const forcedGoal = await forceGoalAction(message, modelSelection.model);
      if (forcedGoal) {
        actions.push(forcedGoal);
        console.warn('[goal_safety_net] forced goal profile_update injected', { goal_type: forcedGoal.goal_type });
      }
    }

    // Maintenance safety net — deterministic (#R2-H1): the model verbally confirms
    // "bakım moduna geçiyoruz" but reliably omits the maintenance_start action, so the
    // reverse-diet / maintenance flow never persists. Fire on a clear maintenance intent.
    if (message
      && !actions.some(a => a.type === 'maintenance_start')
      && /(bakim modu|bakım modu|maintenance|bakima gec|bakıma geç|kiloyu koru|kilomu koru|hedefime ulast|hedefime ulaşt|reverse diet|ters diyet)/i.test(message)
      && /(gec|geç|baslat|başlat|gecmek|geçmek|al beni|alalim|alalım|istiyorum|ulast|ulaşt)/i.test(message)
      && !/(bakim modu nedir|bakım modu nedir|maintenance nedir|ne zaman|gerekir mi|gecmeli miyim|geçmeli miyim)/i.test(message)) {
      actions.push({ type: 'maintenance_start' });
      console.warn('[maintenance_safety_net] maintenance_start injected');
    }

    // Menstrual tracking safety net — deterministic (#R2-H2): the model gives cycle
    // advice but there was no chat write path for menstrual fields. Detect intent + a
    // last-period date (YYYY-MM-DD or DD.MM.YYYY) and optional cycle length.
    if (message
      && !actions.some(a => a.type === 'profile_update' && (a as Record<string, unknown>).menstrual_tracking !== undefined)
      && /(regl|adet|menstr|donem takib|dönem takib|period)/i.test(message)) {
      const mMen = message.toLocaleLowerCase('tr');
      const stop = /(takibi (birak|bırak|kapat|istemiyorum)|takip etme)/.test(mMen);
      if (stop) {
        actions.push({ type: 'profile_update', menstrual_tracking: false });
        console.warn('[menstrual_safety_net] tracking disabled');
      } else {
        const iso = message.match(/(\d{4}-\d{2}-\d{2})/);
        const dmy = message.match(/(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/);
        let lastStart: string | null = null;
        if (iso) lastStart = iso[1];
        else if (dmy) lastStart = `${dmy[3]}-${dmy[2].padStart(2, '0')}-${dmy[1].padStart(2, '0')}`;
        const cyc = mMen.match(/(\d{2})\s*(?:gun|gün)(?:luk|lük)?\s*(?:dongu|döngü|adet|cycle)?/);
        if (lastStart || /(takibi (yap|baslat|başlat|ac|aç)|takip et)/.test(mMen)) {
          const upd: Record<string, unknown> = { type: 'profile_update', menstrual_tracking: true };
          if (lastStart) upd.menstrual_last_period_start = lastStart;
          if (cyc) { const n = parseInt(cyc[1]); if (n >= 20 && n <= 45) upd.menstrual_cycle_length = n; }
          actions.push(upd);
          console.warn('[menstrual_safety_net] tracking enabled', { lastStart, cyc: cyc?.[1] });
        }
      }
    }

    // Extract Layer 2 updates
    const { cleanMessage: finalMessage, layer2Updates } = extractLayer2Updates(assistantMessage);
    assistantMessage = finalMessage;

    // Plan snapshot + reasoning extraction (MASTER_PLAN §4.4, Phase 2/3).
    // AI in plan_diet/plan_workout modes re-emits a full snapshot every turn.
    // Server persists the snapshot to the current draft row.
    let { cleanMessage: afterSnapshot, snapshot: planSnapshot, parseError: snapshotParseError } = extractPlanSnapshot(assistantMessage);
    assistantMessage = afterSnapshot;
    const { cleanMessage: afterReasoning, reasoning: planReasoning } = extractReasoning(assistantMessage);
    assistantMessage = afterReasoning;

    // <navigate_to> — route hint for daily_log chats (Phase 5).
    const { cleanMessage: afterNav, navigateTo } = extractNavigateTo(assistantMessage);
    assistantMessage = afterNav;

    // A snapshot is only USABLE if it has a non-empty days array (and, for diet, a
    // targets object). A structurally-incomplete-but-valid-JSON snapshot would be
    // persisted and then CRASH the plan UI on render (PlanOverviewCards/PlanPreviewCard
    // read days/targets) — so treat it exactly like a parse miss: retry, and never
    // persist an unusable snapshot.
    const snapshotUsable = (snap: Record<string, unknown> | null): boolean => {
      if (!snap) return false;
      // A KOCHKO plan is always a full 7-day week (day_index 0-6). Every plan turn —
      // including a revision — must re-emit the FULL week, not a patch. Accepting a
      // partial (e.g. 1-day) snapshot let a revision truncate the persisted 7-day plan
      // to a single day (#R1-H7). Require >=7 days so an incomplete revision instead
      // triggers the forced 7-day regen below; if that still fails, the snapshot is
      // dropped and the existing full-week draft is preserved (never overwritten).
      if (!Array.isArray(snap.days) || snap.days.length < 7) return false;
      if (task_mode_hint === 'plan_diet' && (!snap.targets || typeof snap.targets !== 'object')) return false;
      return true;
    };

    // RELIABILITY (plan generation): the 7-day diet snapshot is large; the model
    // intermittently abbreviates ("... 6 more days ...") or malforms the big JSON,
    // so it parses to null/incomplete and the plan is SILENTLY dropped (user sees the
    // intro sentence with no plan) — or worse, a partial snapshot crashes the plan UI.
    // Retry ONCE with a JSON-only re-gen before giving up. (Same shape as the meal
    // forced-extraction net.) Skipped on the approval turn (client drives promotion).
    if (!snapshotUsable(planSnapshot) && user_approved !== true && (task_mode_hint === 'plan_diet' || task_mode_hint === 'plan_workout')) {
      console.warn('[plan_snapshot] first pass produced no usable snapshot — forcing JSON-only regen', { parseError: snapshotParseError, hadSnapshot: !!planSnapshot });
      try {
        const forcedRaw = await chatCompletion<string>(
          [
            ...(gptMessages as { role: 'system' | 'user' | 'assistant'; content: string | unknown[] }[]),
            { role: 'user', content: 'Onceki yanitindaki <plan_snapshot> blogu eksik/gecersiz/yarim idi. SIMDI yalnizca gecerli ve TAM bir <plan_snapshot>...</plan_snapshot> blogu uret: "days" dizisinde 7 GUN (day_index 0-6) eksiksiz, diyet ise "targets" objesi dolu. "..." / "devami benzer" / kisaltma KULLANMA, markdown (```) KULLANMA, blok disina HICBIR sey yazma, trailing virgul birakma.' },
          ],
          { model: modelSelection.model, temperature: 0.2, maxTokens: 8000 },
        );
        const retry = extractPlanSnapshot(forcedRaw);
        if (snapshotUsable(retry.snapshot)) { planSnapshot = retry.snapshot; snapshotParseError = undefined; }
        else { snapshotParseError = retry.parseError ?? 'incomplete snapshot (missing days/targets)'; planSnapshot = null; }
      } catch (e) {
        console.error('[plan_snapshot] forced regen threw', (e as Error).message);
        if (!snapshotUsable(planSnapshot)) planSnapshot = null; // never persist an unusable first-pass snapshot
      }
    }

    let persistedPlan: Record<string, unknown> | null = null;
    let planPersistError: string | null = null;
    if (planSnapshot && (task_mode_hint === 'plan_diet' || task_mode_hint === 'plan_workout')) {
      const expectedType = task_mode_hint === 'plan_diet' ? 'diet' : 'workout';
      // Diet snapshot processing (Spec 12.4): ALLERGEN guardrail FIRST (with exclusion
      // regen), THEN calorie reconciliation on the final snapshot.
      if (expectedType === 'diet') {
        const { data: prefRows } = await supabaseAdmin
          .from('food_preferences')
          .select('food_name')
          .eq('user_id', userId)
          .eq('is_allergen', true);
        const allergens = (prefRows ?? []).map((p: { food_name: string }) => p.food_name);
        const scanViolations = (snap: Record<string, unknown>): string[] => {
          const out: string[] = [];
          for (const d of (snap.days as Array<Record<string, unknown>> | undefined) ?? []) {
            for (const m of (d.meals as Array<Record<string, unknown>> | undefined) ?? []) {
              const text = `${m.name ?? ''} ${(m.items as Array<{ name?: string }> | undefined)?.map(i => i.name).join(' ') ?? ''}`;
              const check = checkAllergens(text, allergens);
              if (!check.passed) out.push(`${d.day_label ?? ''} ${m.meal_type ?? ''}: ${check.violations.join(', ')}`);
            }
          }
          return out;
        };
        if (allergens.length > 0) {
          let violations = scanViolations(planSnapshot);
          if (violations.length > 0) {
            // RECOVERY (#journey-H): the model frequently re-adds the user's allergen (e.g.
            // seafood) into the plan even with it in context. Without a recovery the persist
            // fails forever and an allergic user NEVER gets a plan. Force ONE exclusion-regen;
            // only fail if it still violates.
            console.warn('[plan_snapshot] allergen violation — forcing exclusion regen', { count: violations.length });
            try {
              const excludeList = allergens.join(', ');
              const forcedRaw = await chatCompletion<string>(
                [
                  ...(gptMessages as { role: 'system' | 'user' | 'assistant'; content: string | unknown[] }[]),
                  { role: 'user', content: `Onceki plan kullanicinin ALERJENINI iceriyordu: ${excludeList}. Bu KESIN YASAK. Bu besinleri ve TUM turevlerini (deniz urunleri ise karides/midye/kalamar/somon/levrek/balik dahil) plandan TAMAMEN cikar, yerine guvenli alternatif koy. SIMDI yalnizca gecerli ve TAM bir <plan_snapshot>...</plan_snapshot> uret: 7 gun (day_index 0-6) eksiksiz, "targets" dolu, HICBIR gunde ${excludeList} veya turevi olmasin. "...", kisaltma, markdown KULLANMA.` },
                ],
                { model: modelSelection.model, temperature: 0.2, maxTokens: 8000 },
              );
              const retry = extractPlanSnapshot(forcedRaw);
              if (retry.snapshot && snapshotUsable(retry.snapshot) && scanViolations(retry.snapshot).length === 0) {
                planSnapshot = retry.snapshot;
                violations = [];
                console.warn('[plan_snapshot] allergen exclusion regen clean — using regenerated plan');
              }
            } catch (e) {
              console.error('[plan_snapshot] allergen regen threw', (e as Error).message);
            }
            if (violations.length > 0) {
              planPersistError = `allergen_violation: ${violations.slice(0, 3).join('; ')}`;
              console.warn('[plan_snapshot] still blocked by allergen guardrail after regen', { count: violations.length });
            }
          }
        }
        // Calorie reconciliation on the FINAL (possibly regenerated) snapshot (#R2-H3).
        if (!planPersistError) reconcileDietCalories(planSnapshot);
      }
      if (planSnapshot.plan_type === expectedType && !planPersistError) {
        // Find or create the draft.
        const { data: existingRows } = await supabaseAdmin
          .from('weekly_plans')
          .select('id, plan_data, user_revisions')
          .eq('user_id', userId)
          .eq('plan_type', expectedType)
          .eq('status', 'draft')
          .limit(1);
        const existing = existingRows?.[0];

        if (existing) {
          const prevVersion = ((existing.plan_data as Record<string, unknown>)?.version as number | undefined) ?? 0;
          const nextSnapshot = { ...planSnapshot, version: prevVersion + 1 };
          const { error } = await supabaseAdmin
            .from('weekly_plans')
            .update({ plan_data: nextSnapshot })
            .eq('id', existing.id);
          if (error) planPersistError = error.message;
          else persistedPlan = nextSnapshot;
        } else {
          const { data: inserted, error } = await supabaseAdmin
            .from('weekly_plans')
            .insert({
              user_id: userId,
              plan_type: expectedType,
              status: 'draft',
              // Monday-anchor whatever the model emitted — the projection step
              // already re-anchors for the same reason; persist consistently.
              week_start: getWeekStart((planSnapshot.week_start as string) || effectiveToday),
              plan_data: { ...planSnapshot, version: 1 },
              user_revisions: [],
            })
            .select('id, plan_data')
            .limit(1);
          if (error) planPersistError = error.message;
          else persistedPlan = (inserted?.[0] as { plan_data: Record<string, unknown> })?.plan_data ?? null;
        }
      } else if (!planPersistError) {
        planPersistError = `plan_type mismatch: expected ${expectedType}, got ${planSnapshot.plan_type}`;
      }
    } else if (snapshotParseError) {
      console.log(`[plan_snapshot] parse error: ${snapshotParseError}`);
    }

    // Authoritative approval path (MASTER_PLAN §4.4 rev2.1): when client signals
    // user_approved, promote the draft to active regardless of AI output.
    let planApproved: { id: string } | null = null;
    if (user_approved === true && (task_mode_hint === 'plan_diet' || task_mode_hint === 'plan_workout')) {
      const expectedType = task_mode_hint === 'plan_diet' ? 'diet' : 'workout';

      // SERVER-SIDE free-tier plan cap (mirror of premium-gate.ts canApprovePlan:
      // free = 1 diet + 1 workout lifetime). This check used to live ONLY in the
      // client, so any direct edge call approved unlimited plans on a free account.
      const { data: gateProfile } = await supabaseAdmin
        .from('profiles').select('premium, premium_expires_at, plans_used_free').eq('id', userId).maybeSingle();
      const gateActive = gateProfile?.premium === true && (!gateProfile.premium_expires_at || new Date(gateProfile.premium_expires_at as string) > new Date());
      if (!gateActive) {
        const used = (gateProfile?.plans_used_free as { diet?: number; workout?: number } | null) ?? {};
        if ((used[expectedType] ?? 0) >= 1) {
          return respond({
            message: 'Ücretsiz planda 1 diyet + 1 antrenman planı onaylayabiliyorsun. Yeni plan onaylamak ve sınırsız revizyon için Premium\'a geçebilirsin.',
            actions: [], task_mode: effectiveMode,
            plan_snapshot: null, plan_reasoning: null,
            plan_persist_error: 'free_quota_used', plan_approved: null, navigate_to: '/settings/premium',
          });
        }
      }

      // Honor the client's draft_id when provided: the user approved the SPECIFIC
      // draft they were looking at. (The single-draft partial index makes the
      // fallback safe, but relying on it silently was a dead contract.)
      let draftQuery = supabaseAdmin
        .from('weekly_plans')
        .select('id, plan_data')
        .eq('user_id', userId)
        .eq('plan_type', expectedType)
        .eq('status', 'draft');
      if (typeof draft_id === 'string' && draft_id) draftQuery = draftQuery.eq('id', draft_id);
      const { data: draftRow } = await draftQuery.limit(1);
      const draft = draftRow?.[0] as { id: string; plan_data: Record<string, unknown> } | undefined;

      // Re-run the allergen guardrail on the draft before promoting — the
      // draft may have been persisted before the user added an allergen, or
      // produced by an earlier snapshot that slipped through.
      if (draft && expectedType === 'diet') {
        const { data: prefRows } = await supabaseAdmin
          .from('food_preferences')
          .select('food_name')
          .eq('user_id', userId)
          .eq('is_allergen', true);
        const allergens = (prefRows ?? []).map((p: { food_name: string }) => p.food_name);
        if (allergens.length > 0) {
          const days = (draft.plan_data?.days as Array<Record<string, unknown>> | undefined) ?? [];
          const violations: string[] = [];
          for (const d of days) {
            const meals = (d.meals as Array<Record<string, unknown>> | undefined) ?? [];
            for (const m of meals) {
              const text = `${m.name ?? ''} ${(m.items as Array<{ name?: string }> | undefined)?.map(i => i.name).join(' ') ?? ''}`;
              const check = checkAllergens(text, allergens);
              if (!check.passed) violations.push(`${d.day_label ?? ''} ${m.meal_type ?? ''}: ${check.violations.join(', ')}`);
            }
          }
          if (violations.length > 0) {
            planPersistError = `allergen_violation: ${violations.slice(0, 3).join('; ')}`;
            console.warn('[approve] blocked by allergen guardrail', { count: violations.length });
          }
        }
      }

      if (draft && !planPersistError) {
        // Archive the previous active if present.
        const { error: archiveErr } = await supabaseAdmin
          .from('weekly_plans')
          .update({ status: 'archived', archived_reason: 'superseded', superseded_by: draft.id })
          .eq('user_id', userId)
          .eq('plan_type', expectedType)
          .eq('status', 'active');
        if (archiveErr) {
          console.warn('[approve] archive previous active failed', archiveErr);
          planPersistError = `archive failed: ${archiveErr.message}`;
        } else {
          // Snapshot profile for drift detection.
          const { data: profSnap } = await supabaseAdmin
            .from('profiles')
            .select('weight_kg, height_cm, activity_level, diet_mode')
            .eq('id', userId)
            .maybeSingle();
          const { data: goalSnap } = await supabaseAdmin
            .from('goals')
            .select('goal_type, target_weight_kg')
            .eq('user_id', userId)
            .eq('is_active', true)
            .limit(1);
          const approval_snapshot = { ...(profSnap ?? {}), goal: goalSnap?.[0] ?? null };
          const { data: activated, error: promoteErr } = await supabaseAdmin
            .from('weekly_plans')
            .update({ status: 'active', approved_at: new Date().toISOString(), approval_snapshot })
            .eq('id', draft.id)
            .select('id')
            .limit(1);
          if (promoteErr) {
            console.warn('[approve] promote draft failed', promoteErr);
            planPersistError = `promote failed: ${promoteErr.message}`;
          } else {
            planApproved = (activated?.[0] as { id: string } | undefined) ?? null;
            // Increment plans_used_free counter for free-tier gating (MASTER_PLAN §4.7).
            const { data: profUsed } = await supabaseAdmin
              .from('profiles')
              .select('plans_used_free')
              .eq('id', userId)
              .maybeSingle();
            const used = (profUsed?.plans_used_free as { diet?: number; workout?: number } | null) ?? { diet: 0, workout: 0 };
            const nextUsed = { ...used, [expectedType]: (used[expectedType] ?? 0) + 1 };
            await supabaseAdmin.from('profiles').update({ plans_used_free: nextUsed }).eq('id', userId);

            // ROOT FIX (Option A): project the now-active weekly_plans snapshot(s) into
            // daily_plans so the dashboard/context/reports (which only read daily_plans)
            // actually see the chat-created plan. BEST-EFFORT: any failure here must NOT
            // block the already-successful approval or change the response.
            try {
              // a. Fetch BOTH active plans (the just-approved one is one of them).
              const { data: activePlans } = await supabaseAdmin
                .from('weekly_plans')
                .select('plan_type, plan_data, week_start')
                .eq('user_id', userId)
                .eq('status', 'active');
              const dietRow = (activePlans ?? []).find((p: { plan_type: string }) => p.plan_type === 'diet') as
                | { plan_type: string; plan_data: DietPlanData; week_start: string }
                | undefined;
              const workoutRow = (activePlans ?? []).find((p: { plan_type: string }) => p.plan_type === 'workout') as
                | { plan_type: string; plan_data: WorkoutPlanData; week_start: string }
                | undefined;

              // b. Determine the week anchor. Anchor to the user's CURRENT calendar week
              //    (Monday of "today"), NOT the model-chosen week_start in the snapshot —
              //    the model sometimes emits a future / non-Monday week_start, which would
              //    leave TODAY with no daily_plans row (the exact symptom we're fixing).
              //    plan_data.days[] is a Mon..Sun template; project it onto the real week.
              const requestToday = (target_date as string | undefined) ?? effectiveToday;
              const weekStart = getWeekStart(requestToday);

              // c. Profile + this week's consumed kcal (mirrors ai-plan/index.ts logic).
              const { data: profForProj } = await supabaseAdmin
                .from('profiles')
                .select('weight_kg, weekly_calorie_budget')
                .eq('id', userId)
                .maybeSingle();
              const weekEnd = addCalendarDays(weekStart, 6);
              const { data: weekMealLogs } = await supabaseAdmin
                .from('meal_logs')
                .select('id')
                .eq('user_id', userId)
                .gte('logged_for_date', weekStart)
                .lte('logged_for_date', weekEnd);
              const weekLogIds = (weekMealLogs ?? []).map((m: { id: string }) => m.id);
              let weekConsumed = 0;
              if (weekLogIds.length > 0) {
                const { data: weekItems } = await supabaseAdmin
                  .from('meal_log_items')
                  .select('calories')
                  .in('meal_log_id', weekLogIds);
                weekConsumed = (weekItems ?? []).reduce(
                  (s: number, it: { calories: number | null }) => s + (it.calories ?? 0),
                  0,
                );
              }

              // d. Project 7 rows (Mon..Sun) from the snapshots.
              const projectedRows = projectDailyPlanRows({
                dietPlanData: dietRow?.plan_data ?? null,
                workoutPlanData: workoutRow?.plan_data ?? null,
                weekStart,
                profile: {
                  weight_kg: (profForProj?.weight_kg as number | null) ?? null,
                  weekly_calorie_budget: (profForProj?.weekly_calorie_budget as number | null) ?? null,
                },
                weekConsumed,
              });

              // e. Only write today..weekEnd — never rewrite past days. Delete-then-insert
              //    so the readers' `order(version desc).limit(1)` sees a clean version=1.
              //    NOTE (midnight caveat): the delete lower bound uses the request's `today`
              //    (UTC date from target_date / now). Around the client's local midnight this
              //    could be off by one calendar day vs the user's wall clock; acceptable for a
              //    plan projection and consistent with how other daily_* writes date themselves.
              const lowerBound = requestToday > weekStart ? requestToday : weekStart;
              const writeRows = projectedRows
                .filter((r) => r.date >= lowerBound && r.date <= weekEnd)
                .map((r) => ({ ...r, user_id: userId, version: 1 }));

              if (writeRows.length > 0) {
                const { error: delErr } = await supabaseAdmin
                  .from('daily_plans')
                  .delete()
                  .eq('user_id', userId)
                  .gte('date', lowerBound)
                  .lte('date', weekEnd);
                if (delErr) {
                  console.error('[approve][projection] delete failed', delErr);
                } else {
                  const { error: insErr } = await supabaseAdmin.from('daily_plans').insert(writeRows);
                  if (insErr) {
                    console.error('[approve][projection] insert failed', insErr);
                  } else {
                    console.log(`[approve][projection] wrote ${writeRows.length} daily_plans rows (${lowerBound}..${weekEnd})`);
                  }
                }
              } else {
                console.log('[approve][projection] no rows in range to write (weekEnd in the past?)');
              }
            } catch (projErr) {
              console.error('[approve][projection] unexpected error (non-blocking)', projErr);
            }
          }
        }
      }
    }

    // Task completion detection (MASTER_PLAN §4.1).
    // Two paths:
    //  (a) AI emits explicit <task_completion> block.
    //  (b) AI emits <layer2_update>{onboarding_task_completed: X}</layer2_update>.
    // We accept either and validate server-side before trusting it, because the model
    // often thinks it "finished" a task without actually writing the required fields.
    const { cleanMessage: afterTaskCompletion, completion: rawCompletion } = extractTaskCompletion(assistantMessage);
    assistantMessage = afterTaskCompletion;

    let claimedTaskKey: string | null =
      rawCompletion?.completed
      ?? (typeof layer2Updates?.onboarding_task_completed === 'string'
            ? layer2Updates.onboarding_task_completed as string
            : null);

    // Safety net: if the AI forgot to emit the closing tag but clearly produced
    // a closing statement AND we're in an onboarding task chat, auto-claim
    // completion. validateTaskCompletion below still gates it on real DB state,
    // so a premature auto-close can't get through without the fields present.
    if (!claimedTaskKey && task_mode_hint && typeof task_mode_hint === 'string' && task_mode_hint.startsWith('onboarding_')) {
      const lowerMsg = assistantMessage.toLocaleLowerCase('tr');
      const closingSignals = [
        'yeterli bilgi',
        'diger kartlar', 'diğer kartlar',
        'ana sayfa',
        'profilini tamamla',
        'bu konuda bilgi aldim', 'bu konuda bilgi aldım',
      ];
      const closingDetected = closingSignals.some(s => lowerMsg.includes(s));
      if (closingDetected) {
        const topicToTaskKey: Record<string, string> = {
          intro: 'introduce_yourself', goal: 'set_goal', routine: 'daily_routine',
          eating: 'eating_habits', allergies: 'allergies', kitchen: 'kitchen_logistics',
          exercise: 'exercise_history', health: 'health_history', weight_history: 'weight_history',
          labs: 'lab_values', sleep: 'sleep_patterns', stress: 'stress_motivation',
          home: 'home_environment',
        };
        const topicKey = (task_mode_hint as string).replace('onboarding_', '');
        const mappedTaskKey = topicToTaskKey[topicKey];
        if (mappedTaskKey) {
          claimedTaskKey = mappedTaskKey;
          console.log(`[task_completion] safety-net auto-claim: ${mappedTaskKey} (AI forgot tag but closing phrase detected)`);
        }
      }
    }

    // Debug log for Phase 1 QA — track whether AI emitted task_completion, which path,
    // and what actions were in the response. Helps diagnose missing badges / cards.
    console.log(`[task_completion] claimed=${claimedTaskKey ?? 'none'} actions=${JSON.stringify(actions.map(a => a.type))} path=${rawCompletion ? 'task_completion_block' : layer2Updates?.onboarding_task_completed ? 'layer2_update' : 'none'}`);

    let validatedCompletion: { completed: string; summary: string; next_suggestions: string[] } | null = null;
    if (claimedTaskKey) {
      const validation = await validateTaskCompletion(userId, claimedTaskKey);
      console.log(`[task_completion] validation for ${claimedTaskKey}: ${validation.valid ? 'PASSED' : 'FAILED (' + validation.missingReason + ')'}`);
      if (validation.valid) {
        // Build next_suggestions: prefer AI's whitelisted list, else compute from incomplete tasks.
        let suggestions = Array.isArray(rawCompletion?.next_suggestions)
          ? rawCompletion!.next_suggestions!.filter((k) => VALID_TASK_KEYS.has(k))
          : [];
        if (suggestions.length === 0) {
          // Fallback: any tasks not yet in ai_summary.onboarding_tasks_completed.
          const { data: summaryRow } = await supabaseAdmin
            .from('ai_summary').select('onboarding_tasks_completed').eq('user_id', userId).maybeSingle();
          const completedList = (summaryRow?.onboarding_tasks_completed as string[] | null) ?? [];
          const allKeys = ['introduce_yourself', 'set_goal', 'daily_routine', 'eating_habits',
                           'allergies', 'kitchen_logistics', 'exercise_history', 'health_history'];
          suggestions = allKeys.filter((k) => k !== claimedTaskKey && !completedList.includes(k));
        }
        validatedCompletion = {
          completed: claimedTaskKey,
          summary: rawCompletion?.summary ?? '',
          next_suggestions: suggestions.slice(0, 3),
        };
        // Append to ai_summary.onboarding_tasks_completed if not already present.
        // (If path was <layer2_update>, the layer-2 writer below also does this; we make
        //  the write idempotent by checking first.)
        const { data: summaryRow2 } = await supabaseAdmin
          .from('ai_summary').select('onboarding_tasks_completed').eq('user_id', userId).maybeSingle();
        const completed2 = (summaryRow2?.onboarding_tasks_completed as string[] | null) ?? [];
        if (!completed2.includes(claimedTaskKey)) {
          await supabaseAdmin
            .from('ai_summary')
            .upsert({ user_id: userId, onboarding_tasks_completed: [...completed2, claimedTaskKey] }, { onConflict: 'user_id' });
        }
      } else {
        // Reject silently; AI will try again next turn. Log for debug.
        console.log(`[task_completion] rejected ${claimedTaskKey}: ${validation.missingReason}`);
      }
    }

    // Deterministic backdate fallback: the model reliably parses the MEAL but
    // unreliably emits days_ago for "dün ..." messages. If the user text names
    // a past day and the model left days_ago off, inject it.
    if (message && actions.length > 0) {
      const mLower = message.toLocaleLowerCase('tr');
      const inferredDaysAgo = /(evvelsi gun|evvelsi gün|onceki gun|önceki gün|2 gun once|2 gün önce)/.test(mLower) ? 2
        : /(^|[^a-zçğıöşü])(dun|dün)([^a-zçğıöşü]|$)/.test(mLower) ? 1
        : 0;
      if (inferredDaysAgo > 0) {
        const BACKDATABLE = new Set(['meal_log', 'workout_log', 'water_log', 'sleep_log', 'mood_log', 'supplement_log']);
        for (const a of actions) {
          const act = a as Record<string, unknown>;
          if (BACKDATABLE.has(act.type as string) && act.days_ago === undefined) {
            act.days_ago = inferredDaysAgo;
          }
        }
      }
    }

    // #R3: a what-if / projection question ("günde 500 açık yaparsam kaç kilo veririm")
    // must NOT create or mutate a goal — the model probabilistically emits an unsolicited
    // goal_type. Strip goal-mutating actions when the message is clearly hypothetical
    // (the simulation projection is answered in prose, not by setting a goal).
    if (message && /(yaparsam|edersem|yapsam|olur\s*mu|kac kilo ver|kaç kilo ver|veririm|verebilirim|kaybeder|kaybederim|ne kadar.*(ver|kaybet)|simulasyon|simülasyon|senaryo|farz et|diyelim ki)/i.test(message)) {
      for (const a of actions) {
        if ((a as Record<string, unknown>).type === 'profile_update') {
          delete (a as Record<string, unknown>).goal_type;
          delete (a as Record<string, unknown>).target_weight_kg;
        }
      }
      const kept = actions.filter(a => (a as Record<string, unknown>).type !== 'set_goal' && (a as Record<string, unknown>).type !== 'goal_suggestion');
      if (kept.length !== actions.length) { actions.length = 0; actions.push(...kept); }
    }

    // Execute actions (use target_date for batch entry, T1.17)
    // Source of log: photo > voice (transcribed) > default text/chat
    const inputSource: 'photo' | 'voice' | 'ai_chat' = image_base64 ? 'photo' : audio_base64 ? 'voice' : 'ai_chat';
    const actionFeedback = await executeActions(userId, actions, profile?.gender, (target_date as string | undefined) ?? effectiveToday, inputSource);

    // A8: Low confidence proactive verification — append confirmation question
    const mealActions = actions.filter((a) => (a as { type?: string }).type === 'meal_log');
    for (const mealAction of mealActions) {
      const items = mealAction.items as { name: string; portion: string; calories: number; confidence?: number }[] | undefined;
      if (items && items.length > 0) {
        const lowConf = items.filter(i => (i.confidence ?? 0.8) < 0.7);
        if (lowConf.length > 0) {
          const parsed = items.map(i => `${i.portion} ${i.name} (~${i.calories} kcal)`).join(', ');
          if (!assistantMessage.includes('Dogru anladiysam')) {
            assistantMessage += `\n\nDogru anladiysam: ${parsed}. Bu dogru mu?`;
          }
        }
      }
    }

    // ── Output-side safety scans (Spec 12.2/12.4: code-enforced, not
    // prompt-dependent). Free-text replies previously bypassed both filters:
    // a severe-peanut-allergy user got a peanut-butter snack recommendation,
    // and a doctor-forbidden-squat knee patient got a squat-heavy program.
    try {
      const [{ data: allergenRows }, { data: injuryRows }] = await Promise.all([
        supabaseAdmin.from('food_preferences').select('food_name').eq('user_id', userId).eq('is_allergen', true),
        supabaseAdmin.from('health_events').select('description').eq('user_id', userId).eq('is_ongoing', true),
      ]);
      const allergens = (allergenRows ?? []).map((r: { food_name: string }) => r.food_name);
      // Skip the allergen warning when the reply already addresses the allergy
      // (e.g. "fıstık alerjin olduğu için önermiyorum").
      if (allergens.length > 0 && !/alerj/i.test(assistantMessage)) {
        const scan = checkAllergens(assistantMessage, allergens);
        if (!scan.passed) {
          // checkAllergens violations are full sentences — name just the foods. Resolve
          // the displayed name via the SAME category expansion checkAllergens uses, so a
          // category allergen ("deniz ürünleri") triggered by a member food ("somon") is
          // named correctly instead of falling back to the literal "alerjen" (#R1-L5).
          const lowerReply = assistantMessage.toLocaleLowerCase('tr');
          const matched = allergens.filter(a => {
            const aName = a.toLocaleLowerCase('tr');
            const tokens = [aName, ...((ALLERGEN_FOODS as Record<string, string[]>)[aName] ?? [])];
            return tokens.some(t => t.length >= 3 && lowerReply.includes(t));
          });
          const names = matched.length > 0 ? matched.join(', ') : 'alerjen';
          assistantMessage += `\n\n⚠️ Dikkat: profilinde ${names} alerjisi kayıtlı — yukarıdaki öneri buna uygun olmayabilir. Sana uygun bir alternatif isteyebilirsin.`;
        }
      }
      const injuredParts = extractInjuredBodyParts((injuryRows ?? []).map((r: { description: string }) => r.description));
      if (injuredParts.length > 0) {
        const conflicts = findInjuryConflictsInText(assistantMessage, injuredParts);
        if (conflicts.length > 0 && !/sakatl|yaralanma|dizini koru|dikkatli ol/i.test(assistantMessage)) {
          assistantMessage += `\n\n⚠️ Not: kayıtlı sakatlığın nedeniyle ${conflicts.join(', ')} hareket(ler)i senin için riskli olabilir. İstersen sakatlık-dostu bir alternatif programlayalım.`;
        }
      }
    } catch (e) {
      console.error('[output_safety_scan] failed:', (e as Error).message);
    }

    // Store messages with token count and model version (Spec 5.25)
    const tokenEstimate = Math.round((message?.length ?? 0) / 3.5) + Math.round(assistantMessage.length / 3.5);
    await storeMessages(userId, message ?? '[foto]', assistantMessage, taskMode, modelSelection.model, tokenEstimate, actions, session_id);

    // Post-response: detect habit completions from user message (service 1)
    if (message && serviceCtx.habits.activeHabits.length > 0) {
      const habitMatch = checkHabitFromChat(message, serviceCtx.habits.activeHabits);
      if (habitMatch) {
        // Update habit streak in ai_summary (async, non-blocking)
        (async () => {
          try {
            const { data: summaryRow } = await supabaseAdmin
              .from('ai_summary').select('habit_progress').eq('user_id', userId).maybeSingle();
            if (summaryRow?.habit_progress) {
              const habits = summaryRow.habit_progress as { name?: string; habit?: string; status: string; streak: number; completion_log?: string[] }[];
              const todayStr = effectiveToday;
              const updated = habits.map(h => {
                if ((h.name ?? h.habit) === habitMatch.habitName && h.status === 'active') {
                  const log = h.completion_log ?? [];
                  if (!log.includes(todayStr)) {
                    return { ...h, streak: h.streak + 1, completion_log: [...log, todayStr] };
                  }
                }
                return h;
              });
              await supabaseAdmin.from('ai_summary').update({
                habit_progress: updated, updated_at: new Date().toISOString(),
              }).eq('user_id', userId);
            }
          } catch { /* non-critical */ }
        })();
      }
    }

    // Spec 5.15: First-time persona detection surface signal
    // If Layer 2 update contains a new persona AND user had none before, signal UI
    // to show a confirmation card ("You look like type X — correct?").
    let personaJustDetected: string | null = null;
    if (layer2Updates?.user_persona && personaNeeded) {
      const { data: currentSummary } = await supabaseAdmin
        .from('ai_summary').select('user_persona').eq('user_id', userId).maybeSingle();
      const existingPersona = currentSummary?.user_persona as string | null;
      const newPersona = layer2Updates.user_persona as string;
      if (newPersona && existingPersona !== newPersona) {
        personaJustDetected = newPersona;
      }
    }

    // Async: update Layer 2 if needed
    if (layer2Updates) {
      processLayer2Updates(userId, layer2Updates).catch((err: Error) => {
        console.error('[Layer2] Memory write failed:', err.message);
      });
    }

    // Async: finalize onboarding the moment the 4 core demographics exist — NOT
    // only when THIS message carried a profile_update action. Demographics often
    // land via the regex extractor (extractProfileFromMessage), which updates the
    // profile WITHOUT emitting a profile_update action, so the old action-gated
    // check meant onboarding_completed + TDEE/calorie/protein/water targets were
    // never written for those users. checkOnboardingCompletion is idempotent (its
    // own gate skips once completed, and isOnboarding flips false next request).
    if (isOnboarding) {
      checkOnboardingCompletion(userId).then(() => {}, (e) => console.error('[Onboarding] checkOnboardingCompletion failed:', (e as Error).message));
    }

    const outActions = actions.map((a, i: number) => {
      const base: { type: string; feedback: string | null; confidence?: 'high' | 'medium' | 'low' } = {
        type: (a as { type: string }).type,
        feedback: actionFeedback[i] ?? null,
      };
      // Surface meal-parse confidence so the client can render the
      // ConfidenceBadge (Spec 3.3). Same bucketing as executeActions: the
      // weakest item drives the badge.
      if (base.type === 'meal_log') {
        const items = (a as { items?: { confidence?: number }[] }).items;
        if (items?.length) {
          const minConf = Math.min(...items.map(it => typeof it.confidence === 'number' ? it.confidence : 0.75));
          base.confidence = minConf >= 0.85 ? 'high' : minConf >= 0.65 ? 'medium' : 'low';
        }
      }
      return base;
    });
    if (personaJustDetected) {
      outActions.push({
        type: 'persona_detected',
        feedback: personaJustDetected,
      });
    }

    // If a plan was meant to be saved but persistence FAILED, the AI's prose may
    // still claim success ("planını oluşturdum"). Append a Turkish caveat so the
    // user isn't told it worked, and suppress the "planına git" navigation for a
    // plan that was never saved (#R6-2). The client also reads plan_persist_error.
    let finalNavigateTo = navigateTo;
    if (planPersistError && !persistedPlan) {
      assistantMessage += '\n\n(Not: planı kaydederken bir sorun oldu, birazdan tekrar dener misin?)';
      finalNavigateTo = null;
    }

    return respond({
      message: assistantMessage,
      actions: outActions,
      task_mode: taskMode,
      task_completion: validatedCompletion,
      plan_snapshot: persistedPlan,
      plan_reasoning: planReasoning,
      plan_persist_error: planPersistError,
      plan_approved: planApproved,
      navigate_to: finalNavigateTo,
    });
  } catch (err) {
    const msg = (err as Error).message;
    console.error('[ai-chat] unhandled error:', err); // full detail stays server-side
    if (msg.startsWith('SESSION_NOT_FOUND')) {
      return respond({ error: 'Oturum bulunamadi. Lutfen sohbeti yeniden ac.', code: 'SESSION_NOT_FOUND' }, 404);
    }
    // LLM availability/billing errors are diagnostic (not sensitive) — keep visible so
    // the operator can see quota issues. Everything else (DB internals, stack info) is
    // sanitized to a generic message so Postgres/schema details don't leak (#R6-11).
    if (/openai|quota|insufficient|rate.?limit|api key|anthropic|model/i.test(msg)) {
      return respond({ error: msg, code: 'AI_UNAVAILABLE' }, 500);
    }
    return respond({ error: 'Beklenmeyen bir hata oluştu. Lütfen tekrar dene.', code: 'AI_INTERNAL' }, 500);
  }
});

// --- Helper Functions ---

/**
 * Canonical snake_case exercise id. The model emits natural language
 * ("bench press", "askere basma"); readers match exact ids. TR/EN aliases
 * map to the canonical set used by COMPOUND_LIFTS / the Strength screen.
 */
const EXERCISE_ALIASES: Record<string, string> = {
  'bench': 'bench_press', 'bench_press': 'bench_press', 'gogus_press': 'bench_press', 'göğüs_press': 'bench_press',
  'squat': 'squat', 'skuat': 'squat', 'çömelme': 'squat', 'comelme': 'squat',
  'deadlift': 'deadlift', 'olu_kaldiris': 'deadlift', 'ölü_kaldırış': 'deadlift',
  'ohp': 'overhead_press', 'overhead_press': 'overhead_press', 'askere_basma': 'overhead_press',
  'military_press': 'overhead_press', 'omuz_press': 'overhead_press',
  'row': 'barbell_row', 'barbell_row': 'barbell_row', 'barfiks': 'pull_up', 'pull_up': 'pull_up', 'pullup': 'pull_up',
};
function canonicalExerciseName(raw: string): string {
  const snake = (raw ?? '').toLocaleLowerCase('tr').trim().replace(/\s+/g, '_');
  return EXERCISE_ALIASES[snake] ?? snake;
}

function respond(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

/** Monday-anchored week start for a 'YYYY-MM-DD' date (UTC). Mirrors ai-plan/index.ts. */
function getWeekStart(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00.000Z`);
  const day = d.getUTCDay(); // 0=Sun..6=Sat
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  d.setUTCDate(diff);
  return d.toISOString().split('T')[0];
}

/** Add N calendar days to a 'YYYY-MM-DD' date, returns 'YYYY-MM-DD' (UTC). */
function addCalendarDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().split('T')[0];
}

function extractActions(text: string): { cleanMessage: string; actions: Record<string, unknown>[] } {
  let actions: Record<string, unknown>[] = [];
  const match = text.match(/<actions>([\s\S]*?)<\/actions>/);
  if (match) {
    try {
      const parsed = JSON.parse(match[1]);
      actions = Array.isArray(parsed) ? parsed : [parsed];
    } catch { /* ignore */ }
  }
  return { cleanMessage: text.replace(/<actions>[\s\S]*?<\/actions>/, '').trim(), actions };
}

/** Fallback: extract profile data from user message if AI didn't produce actions */
/**
 * Strip verbal "I saved X" acknowledgements the model keeps emitting despite
 * prompt rules. The UI shows save badges; saying them in text is clutter.
 * Works by removing whole sentences that match any of the banned phrases.
 * Conservative: only strips when the phrase starts a sentence fragment or
 * follows a sentence boundary, to avoid nuking unrelated text.
 */
function stripVerbalAcknowledgements(text: string): string {
  // JS \b is ASCII-based: Turkish suffixed forms ("kaydettikten" = "kaydettik|ten")
  // would produce a fake word boundary, so word-end checks use a Turkish-aware
  // negative lookahead (?![A-Za-zÇĞİÖŞÜçğıöşü]) instead. Sentences are consumed to
  // their END ([^.!?\n]*(?:[.!?]+\s*|$)) so no ", güzel bir kahvaltı." stubs remain.
  const patterns: RegExp[] = [
    // "Öğününü kaydettim.", "2 yumurta kaydettik...", "Öğle yemeğini kaydediyorum.",
    // "Kaydedildi." — 1st person past + present + passive. 3rd person "kaydetti" is
    // deliberately excluded (can be legitimate narration); suffixed forms like
    // "kaydettikten/kaydettiğinde/kaydettiklerini" are protected by the lookahead.
    /(?:^|(?<=[.!?\n]\s*))(?:[A-Za-zÇĞİÖŞÜçğıöşü0-9][^.!?\n]*?)?kayd(?:ett(?:im|ik)|ediyorum|edildi)(?![A-Za-zÇĞİÖŞÜçğıöşü])[^.!?\n]*(?:[.!?]+\s*|$)/gi,
    // "Aktivite seviyeni öğrendim." — "öğrendiğinde/öğrendikçe" protected by lookahead.
    /(?:^|(?<=[.!?\n]\s*))[A-Za-zÇĞİÖŞÜçğıöşü][^.!?\n]*?öğren(?:dim|dik|di)(?![A-Za-zÇĞİÖŞÜçğıöşü])[^.!?\n]*(?:[.!?]+\s*|$)/gi,
    // "Profilini güncelledim." — advice like "profilini güncelleyebilirsin" is kept.
    /(?:^|(?<=[.!?\n]\s*))[^.!?\n]*?profili[^.!?\n]*?güncelle(?:dim|dik)(?![A-Za-zÇĞİÖŞÜçğıöşü])[^.!?\n]*(?:[.!?]+\s*|$)/gi,
    // "Not aldım.", "Not ettim." — "not aldıktan sonra..." protected by lookahead.
    /(?:^|(?<=[.!?\n]\s*))[^.!?\n]*?not\s*(?:aldı[mk]|etti[mk])(?![A-Za-zÇĞİÖŞÜçğıöşü])[^.!?\n]*(?:[.!?]+\s*|$)/gi,
    // "Hedefini anladım." — only short ack sentences that END at the verb; empathy
    // sentences that continue with a comma ("Seni çok iyi anladım, zor bir dönemden
    // geçiyorsun.") are kept because [.!] must follow immediately.
    /(?:^|(?<=[.!?\n]\s*))[^.!?\n]{0,40}?anladı[mk][.!]\s*/gi,
    // "Bilgilerini aldım."
    /(?:^|(?<=[.!?\n]\s*))[^.!?\n]*?bilgi(?:leri|ni)[^.!?\n]*?aldı[mk](?![A-Za-zÇĞİÖŞÜçğıöşü])[^.!?\n]*(?:[.!?]+\s*|$)/gi,
  ];
  let out = text;
  for (const p of patterns) out = out.replace(p, '');
  // Collapse excessive whitespace left by removals; re-insert the space a
  // mid-paragraph removal swallowed ("kaldı.Devam" → "kaldı. Devam" — uppercase
  // only, so decimals like "2.5" stay intact).
  return out
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/([.!?])([A-ZÇĞİÖŞÜ])/g, '$1 $2')
    .trim();
}

/**
 * Server safety net (meal-log reliability Part B): does this user message read like a
 * report of a meal the user ALREADY ate (past tense), as opposed to a hypothetical
 * ("kac kalori olur"), a refusal ("yemedim"), or a question? Used to detect when the
 * model verbally acknowledges a meal but forgets the <actions> meal_log block, so we can
 * ask for an explicit confirm instead of silently dropping the meal.
 */
function looksLikeMealReport(msg: string): boolean {
  const m = msg.toLocaleLowerCase('tr');
  const ate = /\b(yedim|yedik|yemistim|yemiştim|ictim|icmistim|atistirdim|tukettim|kahvalti yaptim)\b/.test(m) || /\b(içtim|içmiştim|atıştırdım|tükettim)\b/.test(m);
  if (!ate) return false;
  if (/(kac kalori|kaç kalori|olur mu|yesem|yersem|icsem|içsem|ne olur|kac gram|kaç gram)/.test(m)) return false;
  // 'kaydetme' (imperative "don't log") must NOT match 'kaydetmeyi unutmuşum'
  // ("I forgot to log it" — the OPPOSITE intent, user wants it logged).
  if (/(yemedim|içmedim|icmedim|kaydetme\b(?![^.!?]{0,12}unut)|sayma\b|atladim|atladım)/.test(m)) return false;
  // Water-only drink reports ("2 litre su içtim, 7 saat uyudum") are handled by
  // water_log — without this exclusion the meal net misfired and appended
  // "Bunu ogun olarak kaydedeyim mi?" to pure metric messages.
  const onlyDrinkIsWater = /\bsu\b[^.!?]{0,20}(içtim|ictim)|(içtim|ictim)[^.!?]{0,8}\bsu\b/.test(m);
  const hasEatVerb = /\b(yedim|yedik|atistirdim|atıştırdım|tukettim|tükettim|kahvalti yaptim)\b/.test(m);
  if (onlyDrinkIsWater && !hasEatVerb) return false;
  return true;
}

/**
 * Server safety net (meal-log reliability Part B, forced action extraction):
 * When the main model reported a meal verbally but omitted the <actions> meal_log block,
 * make a SECOND, focused model call that is constrained to output ONLY the meal_log
 * actions block. Parse it with extractActions and return the first meal_log action so the
 * caller can inject it into the `actions` array BEFORE executeActions runs — logging the
 * meal in a single turn (no fragile "Evet" follow-up that detectTaskMode misroutes).
 *
 * Returns null if the model produced nothing parseable as a meal_log; the caller then
 * keeps the existing confirm-prompt fallback. Robust to the model wrapping the block in
 * ```json fences (extractActions only strips the <actions> tags, not fences) and to a
 * bare JSON array with no <actions> wrapper at all.
 */
async function forceMealLogAction(
  message: string,
  model: string,
): Promise<Record<string, unknown> | null> {
  const systemInstruction = [
    'Sen bir beslenme parse motorusun. Kullanicinin yedigi/ictigi ogunu analiz et ve SADECE asagidaki formatta tek bir <actions> blogu dondur.',
    'BASKA HICBIR SEY YAZMA — aciklama yok, selamlama yok, markdown yok, kod blogu (```) yok. Sadece <actions>...</actions>.',
    'Format:',
    '<actions>[{"type":"meal_log","meal_type":"breakfast|lunch|dinner|snack","raw":"kullanicinin yazdigi metin","cooking_method":"haslama|izgara|kizartma|firinda|cig|buharla|sotele|null","items":[{"name":"yiyecek adi","portion":"porsiyon (orn. 200 gram)","calories":sayi,"protein_g":sayi,"carbs_g":sayi,"fat_g":sayi,"confidence":0.0-1.0}]}]</actions>',
    'KURALLAR:',
    '- meal_type SADECE breakfast, lunch, dinner veya snack olabilir. Kullanici "ogle/oglen" derse lunch, "aksam" derse dinner, "kahvalti/sabah" derse breakfast, "atistirma/ara ogun" derse snack. Belirsizse snack kullan.',
    '- Her yiyecek icin gercekci kalori ve makro (protein_g, carbs_g, fat_g) tahmini ver. Turk mutfagi porsiyonlarini bilerek hesapla.',
    '- Kullanici gram/adet/porsiyon belirttiyse ona gore hesapla. Belirtmediyse tipik bir porsiyon varsay.',
    '- calories, protein_g, carbs_g, fat_g DAIMA sayi (number) olmali, 0 olabilir ama string OLMAZ.',
    '- Eger metinde hicbir yiyecek/icecek tespit edemezsen bos dizi dondur: <actions>[]</actions>.',
  ].join('\n');

  let raw: string;
  try {
    raw = await chatCompletion<string>(
      [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: message },
      ],
      { model, temperature: 0.2, maxTokens: 600 },
    );
  } catch (e) {
    console.error('[forceMealLogAction] chatCompletion failed:', (e as Error).message);
    return null;
  }

  // Strip markdown code fences the model may wrap the block in (```json ... ```), then
  // hand to extractActions. If the model returned a bare JSON array with no <actions>
  // wrapper, wrap it so extractActions can parse it.
  let cleaned = raw.trim().replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  if (!/<actions>/i.test(cleaned)) {
    const firstBracket = cleaned.indexOf('[');
    const lastBracket = cleaned.lastIndexOf(']');
    if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
      cleaned = `<actions>${cleaned.slice(firstBracket, lastBracket + 1)}</actions>`;
    }
  }

  const { actions: parsed } = extractActions(cleaned);
  const mealAction = parsed.find((a) => (a as { type?: string }).type === 'meal_log') as Record<string, unknown> | undefined;
  if (!mealAction) return null;

  // Must carry at least one item, otherwise there is nothing to log (would create an
  // empty meal_log with zero calories — keep the confirm-prompt fallback instead).
  const items = mealAction.items as unknown[] | undefined;
  if (!Array.isArray(items) || items.length === 0) return null;

  // Guard meal_type to the CHECK-constrained set (executeActions also defaults it, but
  // normalise here so logs/feedback are correct).
  const VALID_MEAL_TYPES = new Set(['breakfast', 'lunch', 'dinner', 'snack']);
  const mt = mealAction.meal_type as string | undefined;
  if (!mt || !VALID_MEAL_TYPES.has(mt)) mealAction.meal_type = 'snack';

  // Ensure raw is populated for the meal_logs.raw_input column.
  if (typeof mealAction.raw !== 'string' || !mealAction.raw) mealAction.raw = message;

  return mealAction;
}

/** Past-tense workout report? (mirror of looksLikeMealReport, for the workout net) */
function looksLikeWorkoutReport(msg: string): boolean {
  const m = msg.toLocaleLowerCase('tr');
  const did = /\b(yaptim|yaptım|kostum|koştum|yurudum|yürüdüm|yuzdum|yüzdüm|kaldirdim|kaldırdım|calistim|çalıştım|bitirdim)\b/.test(m)
    || /(antrenman|salon|egzersiz|kardiyo|kosu|koşu)/.test(m) && /\b(yaptim|yaptım|gittim|bitti|tamamladim|tamamladım)\b/.test(m)
    || /\d+\s*(set|tekrar|x)\s*\d*/.test(m) && /(press|squat|deadlift|bench|barfiks|agirlik|ağırlık|kg)/.test(m);
  if (!did) return false;
  if (/(yapsam|yapacagim|yapacağım|yapmali miyim|yapmalı mıyım|plan|oner|öner)/.test(m)) return false;
  if (/(yapmadim|yapmadım|gitmedim|atladim|atladım)/.test(m)) return false;
  return true;
}

/** Forced single-purpose extraction for workouts (mirror of forceMealLogAction). */
async function forceWorkoutLogAction(
  message: string,
  model: string,
): Promise<Record<string, unknown> | null> {
  const systemInstruction = [
    'Sen bir antrenman parse motorusun. Kullanicinin YAPTIGI antrenmani analiz et ve SADECE asagidaki formatta tek bir <actions> blogu dondur.',
    'BASKA HICBIR SEY YAZMA — aciklama yok, markdown yok. Sadece <actions>...</actions>.',
    'Format:',
    '<actions>[{"type":"workout_log","raw":"kullanicinin yazdigi","workout_type":"cardio|strength|flexibility|sports|mixed","duration_min":sayi,"intensity":"low|moderate|high","calories_burned":sayi,"strength_sets":[{"exercise":"squat|bench_press|deadlift|overhead_press|barbell_row|pull_up|veya_snake_case","sets":sayi,"reps":sayi,"weight_kg":sayi}]}]</actions>',
    'KURALLAR:',
    '- exercise adlarini DAIMA kucuk harf snake_case yaz (bench press → bench_press).',
    '- Sure belirtilmemisse antrenman tipine gore makul tahmin (guc ~45, kardiyo ~30).',
    '- calories_burned gercekci tahmin; sayi olmali.',
    '- Agirlik calismasi yoksa strength_sets bos dizi olsun.',
    '- Antrenman tespit edemezsen bos dizi dondur: <actions>[]</actions>.',
  ].join('\n');

  let raw: string;
  try {
    raw = await chatCompletion<string>(
      [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: message },
      ],
      { model, temperature: 0.2, maxTokens: 500 },
    );
  } catch (e) {
    console.error('[forceWorkoutLogAction] chatCompletion failed:', (e as Error).message);
    return null;
  }

  let cleaned = raw.trim().replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  if (!/<actions>/i.test(cleaned)) {
    const a = cleaned.indexOf('['), b = cleaned.lastIndexOf(']');
    if (a !== -1 && b > a) cleaned = `<actions>${cleaned.slice(a, b + 1)}</actions>`;
  }
  const { actions: parsed } = extractActions(cleaned);
  const workoutAction = parsed.find((x) => (x as { type?: string }).type === 'workout_log') as Record<string, unknown> | undefined;
  if (!workoutAction) return null;
  if (typeof workoutAction.raw !== 'string' || !workoutAction.raw) workoutAction.raw = message;
  return workoutAction;
}

/** Goal-setting statement? ("3 ayda 5 kilo vermek istiyorum, hedefim 70") */
function looksLikeGoalIntent(msg: string): boolean {
  const m = msg.toLocaleLowerCase('tr');
  return /(hedefim|hedef koy|yeni hedef|hedefimi)\b/.test(m)
    || /(kilo vermek|kilo almak|kas kazanmak|zayiflamak|zayıflamak|formda olmak)\s+isti/.test(m);
}

/** Forced extraction of goal fields into a profile_update action. */
async function forceGoalAction(
  message: string,
  model: string,
): Promise<Record<string, unknown> | null> {
  const systemInstruction = [
    'Sen bir hedef parse motorusun. Kullanicinin sagliklik/kilo hedefini analiz et ve SADECE su formatta tek bir <actions> blogu dondur:',
    '<actions>[{"type":"profile_update","goal_type":"lose_weight|gain_weight|gain_muscle|health|maintain|conditioning","target_weight_kg":sayi_veya_null}]</actions>',
    'KURALLAR:',
    '- "kilo vermek/zayiflamak" → lose_weight; "kilo almak" → gain_weight; "kas" → gain_muscle; "saglikli olmak" → health; "korumak" → maintain; "kondisyon/dayaniklilik" → conditioning.',
    '- Kullanici hedef kilo soylediyse target_weight_kg olarak yaz (30-300 arasi degilse null).',
    '- Hedef tespit edemezsen bos dizi: <actions>[]</actions>.',
    'BASKA HICBIR SEY YAZMA.',
  ].join('\n');

  let raw: string;
  try {
    raw = await chatCompletion<string>(
      [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: message },
      ],
      { model, temperature: 0.1, maxTokens: 200 },
    );
  } catch (e) {
    console.error('[forceGoalAction] chatCompletion failed:', (e as Error).message);
    return null;
  }

  let cleaned = raw.trim().replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  if (!/<actions>/i.test(cleaned)) {
    const a = cleaned.indexOf('['), b = cleaned.lastIndexOf(']');
    if (a !== -1 && b > a) cleaned = `<actions>${cleaned.slice(a, b + 1)}</actions>`;
  }
  const { actions: parsed } = extractActions(cleaned);
  const goalAction = parsed.find((x) => {
    const t = x as Record<string, unknown>;
    return t.type === 'profile_update' && (t.goal_type || t.target_weight_kg);
  }) as Record<string, unknown> | undefined;
  if (!goalAction) return null;

  // Validate against the canonical enum — never let free text reach the column.
  if (goalAction.goal_type && !CANONICAL_GOAL_TYPES.has(goalAction.goal_type as string)) delete goalAction.goal_type;
  const tw = Number(goalAction.target_weight_kg);
  if (!Number.isFinite(tw) || tw < 30 || tw > 300) delete goalAction.target_weight_kg;
  if (!goalAction.goal_type && !goalAction.target_weight_kg) return null;
  return goalAction;
}

// Canonical goal types (mig 043 CHECK). Hoisted to module scope so BOTH the
// regex safety-net (validateGoalAction) and the model-emitted profile_update goal
// path reuse the same whitelist — a free-text/Turkish goal_type must never reach
// the CHECK-constrained column. (#8)
const CANONICAL_GOAL_TYPES = new Set(['lose_weight', 'gain_weight', 'gain_muscle', 'health', 'maintain', 'conditioning']);

// CHECK-constrained profiles enum columns. The model occasionally emits Turkish
// free text ("orta", "kadın") which 23514-fails the WHOLE batch update and
// silently drops every co-submitted field (height_cm, weight_kg, ...). Normalize/
// drop the offending value on the way out, mirroring ai-extractor. (#7)
const PROFILE_ENUM_WHITELIST: Record<string, string[]> = {
  gender: ['male', 'female', 'other'],
  activity_level: ['sedentary', 'light', 'moderate', 'active', 'very_active'],
  budget_level: ['low', 'medium', 'high'],
  cooking_skill: ['none', 'basic', 'good'],
  diet_mode: ['standard', 'low_carb', 'keto', 'high_protein'],
  equipment_access: ['home', 'gym', 'both'],
  training_style: ['cardio', 'strength', 'mixed'],
};
const PROFILE_ENUM_ALIASES: Record<string, string[]> = {
  male: ['erkek', 'bay', 'man'],
  female: ['kadın', 'kadin', 'bayan', 'woman'],
  high: ['yüksek', 'yuksek', 'çok', 'cok'],
  moderate: ['orta', 'normal'],
  medium: ['orta', 'normal'],
  low: ['düşük', 'dusuk', 'az', 'hafif'],
  good: ['iyi'],
  none: ['yok', 'hiç', 'hic'],
  basic: ['temel', 'başlangıç', 'baslangic'],
  home: ['ev', 'evde'],
  gym: ['salon', 'spor salonu'],
  both: ['ikisi', 'her ikisi', 'ikisi de'],
  strength: ['güç', 'guc', 'kuvvet', 'ağırlık', 'agirlik'],
  cardio: ['kardiyo'],
  mixed: ['karışık', 'karisik', 'karma'],
};
// Returns a canonical value, or null if the value can't be mapped (→ drop it).
function normalizeProfileEnum(field: string, value: unknown): string | null {
  const enums = PROFILE_ENUM_WHITELIST[field];
  if (!enums) return typeof value === 'string' ? value : null;
  if (typeof value !== 'string') return null;
  const v = value.toLocaleLowerCase('tr').trim();
  if (enums.includes(v)) return v;
  for (const e of enums) {
    if ((PROFILE_ENUM_ALIASES[e] ?? []).includes(v)) return e;
  }
  return null;
}

function extractProfileFromMessage(msg: string, taskModeHint?: string, safeOnly = false): Record<string, unknown> | null {
  // safeOnly (regular chat): skip the AMBIGUOUS bodyweight extraction only — a bare
  // "70kg" in a workout/recipe context would be misread as bodyweight. Age/gender/
  // height/target are unambiguous, so they're still extracted to deterministically
  // catch the model omitting a profile_update action ("yaşını güncelledim" w/ no
  // <actions>) outside onboarding (#1/#2/#5).
  const result: Record<string, unknown> = {};
  const lower = msg.toLocaleLowerCase('tr');

  // Context-aware: in the "Hedefini belirle" chat, a bare number reply (30-300)
  // is almost always the target weight — the AI just asked "hedeflediğin kilo?"
  // and the user shorthand-answers. Without this, regex below requires the
  // "hedef" keyword and misses the most common phrasing.
  // In the "Hedefini belirle" (goal) chat, EVERY weight the user states is the TARGET
  // — the prompt explicitly forbids writing current weight_kg here (#R1-C1). Capture
  // the target from a bare number, "NN kg/kilo", or "hedefim NN" phrasings, and we will
  // NOT run the current-weight extraction below for this chat.
  const inGoalChat = taskModeHint === 'onboarding_goal';
  if (inGoalChat) {
    const bare = msg.trim();
    if (/^\d{2,3}(?:[.,]\d)?$/.test(bare)) {
      const n = parseFloat(bare.replace(',', '.'));
      if (n >= 30 && n <= 300) result.target_weight_kg = n;
    }
    if (result.target_weight_kg == null) {
      const gm = lower.match(/(\d{2,3}(?:[.,]\d)?)\s*(?:kg|kilo)/);
      if (gm) { const n = parseFloat(gm[1].replace(',', '.')); if (n >= 30 && n <= 300) result.target_weight_kg = n; }
    }
  }

  // Height: "boyum 175", "boy: 180", "175 cm", "175 boy", "175 boyundayim".
  // Both orders matter — Turkish users very often put the number first
  // ("175 boy"), which the old "boy"-then-number regex missed entirely.
  const heightMatch = lower.match(/boy\w*\s*[:=]?\s*(\d{2,3})|(\d{2,3})\s*(?:cm|boy)/);
  if (heightMatch) {
    const h = parseInt(heightMatch[1] ?? heightMatch[2]);
    if (h >= 100 && h <= 250) result.height_cm = h;
  }

  // Target weight: "hedef kilo 90", "hedef kilom 90", "90 kg hedef" — checked BEFORE
  // plain weight so "hedef kilo 100" isn't misread as current weight.
  const targetMatch = lower.match(/hedef\s*kilo\w*\s*[:=]?\s*(\d{2,3}(?:[.,]\d)?)|(\d{2,3}(?:[.,]\d)?)\s*(?:kg|kilo)\s*hedef/);
  if (targetMatch && result.target_weight_kg == null) {
    const t = parseFloat((targetMatch[1] ?? targetMatch[2]).replace(',', '.'));
    if (t >= 30 && t <= 300) result.target_weight_kg = t;
  }
  // Verb-less goal correction "hedefim 78" / "hedefim 78 olsun" (#R1-M8). Gated to
  // NON-exercise messages so a LIFT goal ("bench press hedefim 100 kg") is never
  // misread as a bodyweight target. The \d{2,3} guard also excludes amounts ("5 kilo").
  if (result.target_weight_kg == null
    && !/(bench|press|squat|deadlift|curl|set|tekrar|\brep\b|kaldir|kaldır|antren|egzersiz|\d+\s*x\s*\d+)/.test(lower)) {
    const hm = lower.match(/hedef\w*\s*[:=]?\s*(\d{2,3}(?:[.,]\d)?)\b/);
    if (hm) { const t = parseFloat(hm[1].replace(',', '.')); if (t >= 30 && t <= 300) result.target_weight_kg = t; }
  }

  // Current weight: "kilom 72", "72 kg", "72 kiloyum" — but not if we just matched it as target.
  // Prefer "mevcut kilo X" disambiguation when both appear in the same line.
  // Bodyweight is the ONLY ambiguous field (a workout "70kg" misreads as bodyweight),
  // so skip it in safeOnly/regular-chat mode (#1/#2/#5) AND in the goal chat where the
  // prompt forbids touching current weight (#R1-C1).
  if (!safeOnly && !inGoalChat) {
    // #R3-net: the bare "NN kg/kilo" alternative must require the unit to END at a word
    // boundary, else "kilo" matches the PREFIX of "kilom" in "boyum 182 kilom 88" and the
    // leftmost match grabs the HEIGHT (182) as weight. The "kilo\w* NN" alt (2nd) then
    // correctly captures the real weight (88) that FOLLOWS "kilom". (kiloyum listed
    // explicitly so "88 kiloyum" still matches despite the suffix.)
    const currentMatch = lower.match(/mevcut\s*kilo\w*\s*[:=]?\s*(\d{2,3}(?:\.\d)?)|kilo\w*\s*[:=]?\s*(\d{2,3}(?:\.\d)?)|(\d{2,3}(?:\.\d)?)\s*(?:kg|kiloyum|kilo)\b/);
    if (currentMatch) {
      const w = parseFloat(currentMatch[1] ?? currentMatch[2] ?? currentMatch[3]);
      // Skip if the value matches the target we already extracted, to avoid
      // double-assigning a single number to both fields.
      if (w >= 30 && w <= 300 && result.target_weight_kg !== w) result.weight_kg = w;
    }
  }

  // Age/birth year: "25 yaşındayım", "yasim 25", "1998 doğumluyum"
  const birthMatch = lower.match(/(19|20)\d{2}\s*(dogumlu|doğumlu)/);
  if (birthMatch) {
    result.birth_year = parseInt(birthMatch[0]);
  } else {
    const ageMatch = lower.match(/(\d{1,2})\s*(yas|yaş)|yas\w*\s*[:=]?\s*(\d{1,2})/);
    if (ageMatch) {
      const age = parseInt(ageMatch[1] ?? ageMatch[3]);
      if (age >= 10 && age <= 100) result.birth_year = new Date().getFullYear() - age;
    }
  }

  // Gender. "erkeğim" mutates the final k→ğ; ASCII-keyboard users type "erkegim" (g),
  // so the class is [gkğ] (#R1-M1). \bbay\b matches "bay/bayım" but not "bayan"
  // (no trailing word boundary). \bmale\b prevents the substring in "female" matching male.
  if (/erke[gkğ]|\bbay\b|\bmale\b/.test(lower)) result.gender = 'male';
  else if (/kad[iı]n|bayan|\bfemale\b/.test(lower)) result.gender = 'female';

  // Activity level — previously NEVER extracted, so onboarding always fell back to the
  // 'sedentary' column default and every TDEE used the 1.2 multiplier (~30% too low,
  // #R1-H2). Weekly training frequency takes priority over occupation words like
  // "masa başı" (a desk worker who trains 3-4x/week is moderate, not sedentary). The
  // frequency inference is gated to messages with an exercise/activity context word so
  // a meal/recipe log ("haftada 3 kez balık") can never misfire.
  const hasActivityContext = /spor|antren|egzersiz|idman|hareket|aktivite|aktif|yuru|yürü|kosu|koşu|antrenman|gym|fitness/.test(lower);
  const freqMatch = lower.match(/haftada\s*(\d)(?:\s*[-–—]\s*(\d))?\s*(?:gun|gün|kez|defa|kere)/);
  if (freqMatch && hasActivityContext) {
    const hi = parseInt(freqMatch[2] ?? freqMatch[1]);
    if (hi <= 2) result.activity_level = 'light';
    else if (hi <= 4) result.activity_level = 'moderate';
    else if (hi <= 6) result.activity_level = 'active';
    else result.activity_level = 'very_active';
  } else if (/cok aktif|çok aktif|atletik|profesyonel sporcu|cok hareketli|çok hareketli/.test(lower)) {
    result.activity_level = 'very_active';
  } else if (/(orta|normal)\s*(seviye|derece|aktiv)/.test(lower)) {
    result.activity_level = 'moderate';
  } else if (/hareketsiz|masa basi|masa başı|sedanter|hic spor yapm|hiç spor yapm|gun boyu otur|gün boyu otur/.test(lower)) {
    result.activity_level = 'sedentary';
  } else if (hasActivityContext && /(duzenli|düzenli)\s*spor|aktif bir|cok hareketli|çok hareketli/.test(lower)) {
    result.activity_level = 'active';
  }

  // Goal type from Turkish phrases. Priority: explicit wins; combos (weight AND muscle)
  // resolve to lose_weight if body mass suggests deficit is the first move.
  const wantsLose = /kilo\s*(verme|ver\w*)|zayiflama|zayıflama/.test(lower);
  const wantsMuscle = /kas\s*(kazan|yapma|yapım)|kasl[iı]/.test(lower);
  const wantsGain = /kilo\s*(alma|al\w*)\s/.test(lower);
  const wantsHealth = /sagl[iı]kl[iı]\s*(ol|yasa|yaşa|kal)/.test(lower) && !wantsLose && !wantsGain;
  const wantsCondition = /kondisyon|dayanikl[iı]/.test(lower);
  if (wantsLose) result.goal_type = 'lose_weight';
  else if (wantsMuscle && !wantsLose) result.goal_type = 'gain_muscle';
  else if (wantsGain) result.goal_type = 'gain_weight';
  else if (wantsHealth) result.goal_type = 'health';
  else if (wantsCondition) result.goal_type = 'conditioning';

  // Motivation source keywords — captured as free text for motivation_source column.
  // GATED to onboarding/goal capture (!safeOnly): in regular chat a transient mood
  // report ("bugün enerjik hissediyorum") was being written as the PERMANENT
  // motivation_source trait via the bare "enerj" substring (#R1-H5).
  if (!safeOnly) {
    const motivationBits: string[] = [];
    if (/sagl[iı]k/.test(lower)) motivationBits.push('saglik');
    if (/gor[uü]n[uü]m|iyi\s*g[oö]z[uü]k/.test(lower)) motivationBits.push('gorunum');
    if (/motivasyon\w*\s+enerj|enerjik olmak|enerjim ol/.test(lower)) motivationBits.push('enerji');
    if (/ozguven|özgüven|kendime\s*g[uü]ven/.test(lower)) motivationBits.push('ozguven');
    if (motivationBits.length > 0) result.motivation_source = motivationBits.join('_');
  }

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Plan snapshot parser — MASTER_PLAN §4.4.
 * Every plan chat turn is expected to re-emit the FULL plan, not a patch.
 * This extracts it, strips the tag from the displayed message, and returns
 * the parsed object so the caller can persist it via plan.service.applySnapshot.
 */
// Rescale each diet day's item portions (grams + kcal + macros) so the day total hits
// targets.kcal — the model reliably under-fills (#R2-H3). Mutates the snapshot in place.
function reconcileDietCalories(snap: Record<string, unknown>): void {
  const tgt = Number((snap.targets as Record<string, unknown> | undefined)?.kcal);
  if (!Number.isFinite(tgt) || tgt <= 0) return;
  for (const day of (snap.days as Array<Record<string, unknown>> | undefined) ?? []) {
    const meals = (day.meals as Array<Record<string, unknown>> | undefined) ?? [];
    const daySum = meals.reduce((s, m) => s + (Number(m.total_kcal) || 0), 0);
    if (daySum <= 0) continue;
    if (Math.abs(daySum - tgt) / tgt <= 0.12) continue;
    const factor = Math.max(0.5, Math.min(2.5, tgt / daySum));
    const sc = (v: unknown) => Math.round((Number(v) || 0) * factor);
    for (const m of meals) {
      for (const it of (m.items as Array<Record<string, unknown>> | undefined) ?? []) {
        if (it.grams != null) it.grams = sc(it.grams);
        if (it.kcal != null) it.kcal = sc(it.kcal);
        if (it.protein != null) it.protein = sc(it.protein);
        if (it.carbs != null) it.carbs = sc(it.carbs);
        if (it.fat != null) it.fat = sc(it.fat);
      }
      if (m.total_kcal != null) m.total_kcal = sc(m.total_kcal);
      if (m.total_protein != null) m.total_protein = sc(m.total_protein);
      if (m.total_carbs != null) m.total_carbs = sc(m.total_carbs);
      if (m.total_fat != null) m.total_fat = sc(m.total_fat);
    }
  }
}

function extractPlanSnapshot(text: string): { cleanMessage: string; snapshot: Record<string, unknown> | null; parseError?: string } {
  const match = text.match(/<plan_snapshot>([\s\S]*?)<\/plan_snapshot>/);
  if (!match) return { cleanMessage: text, snapshot: null };
  let parsed: Record<string, unknown> | null = null;
  let parseError: string | undefined;
  // Models occasionally wrap the JSON in markdown fences, add stray prose around
  // it, or leave a trailing comma — any of which breaks a naive JSON.parse and
  // silently drops the entire plan (the user taps "Plan oluştur" and nothing
  // happens). Normalise before parsing: strip fences, slice to the outermost
  // braces, then try with and without trailing-comma repair.
  let raw = match[1].trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const first = raw.indexOf('{');
  const last = raw.lastIndexOf('}');
  if (first !== -1 && last !== -1 && last > first) raw = raw.slice(first, last + 1);
  for (const candidate of [raw, raw.replace(/,(\s*[}\]])/g, '$1')]) {
    try {
      parsed = JSON.parse(candidate) as Record<string, unknown>;
      parseError = undefined;
      break;
    } catch (e) {
      parseError = (e as Error).message;
    }
  }
  return {
    cleanMessage: text.replace(/<plan_snapshot>[\s\S]*?<\/plan_snapshot>/, '').trim(),
    snapshot: parsed,
    parseError,
  };
}

/** Parse <reasoning> block — AI's explanation for a plan decision. */
function extractReasoning(text: string): { cleanMessage: string; reasoning: string | null } {
  const match = text.match(/<reasoning>([\s\S]*?)<\/reasoning>/);
  if (!match) return { cleanMessage: text, reasoning: null };
  return {
    cleanMessage: text.replace(/<reasoning>[\s\S]*?<\/reasoning>/, '').trim(),
    reasoning: match[1].trim(),
  };
}

/**
 * Parse <navigate_to> block (MASTER_PLAN §4.9).
 * AI emits this in general/daily_log chats when the user expresses plan intent.
 * Client renders a "Plana git →" button on the message; if user ignores it,
 * the prompt instructs the model not to re-emit.
 */
// NOTE: index routes link as the GROUP path — '/(tabs)/index' does not match
// expo-router's linking config (lands on +not-found); '/(tabs)' is the dashboard.
const VALID_NAVIGATE_ROUTES = new Set([
  '/plan/diet', '/plan/workout', '/(tabs)', '/(tabs)/chat', '/(tabs)/profile',
  '/settings/coach-memory', '/settings/goals', '/settings/premium',
]);

function extractNavigateTo(text: string): { cleanMessage: string; navigateTo: string | null } {
  const match = text.match(/<navigate_to>([\s\S]*?)<\/navigate_to>/);
  if (!match) return { cleanMessage: text, navigateTo: null };
  let route: string | null = null;
  try {
    const obj = JSON.parse(match[1]);
    if (typeof obj?.route === 'string' && VALID_NAVIGATE_ROUTES.has(obj.route)) {
      route = obj.route;
    }
  } catch { /* drop malformed */ }
  return {
    cleanMessage: text.replace(/<navigate_to>[\s\S]*?<\/navigate_to>/, '').trim(),
    navigateTo: route,
  };
}

function extractLayer2Updates(text: string): { cleanMessage: string; layer2Updates: Record<string, unknown> | null } {
  let updates: Record<string, unknown> | null = null;
  const match = text.match(/<layer2_update>([\s\S]*?)<\/layer2_update>/);
  if (match) {
    try { updates = JSON.parse(match[1]); } catch { /* ignore */ }
  }
  return { cleanMessage: text.replace(/<layer2_update>[\s\S]*?<\/layer2_update>/, '').trim(), layer2Updates: updates };
}

// ─── Task completion protocol (MASTER_PLAN §4.1) ───
// AI emits <task_completion>{"completed":"key","summary":"...","next_suggestions":["key1","key2"]}
// Server strips it, validates that the claimed task's required fields ARE persisted,
// and only then returns a structured task_completion to the client.

interface TaskCompletionBlock {
  completed: string;
  summary?: string;
  next_suggestions?: string[];
}

function extractTaskCompletion(text: string): { cleanMessage: string; completion: TaskCompletionBlock | null } {
  const match = text.match(/<task_completion>([\s\S]*?)<\/task_completion>/);
  if (!match) return { cleanMessage: text, completion: null };
  let parsed: TaskCompletionBlock | null = null;
  try {
    const obj = JSON.parse(match[1]);
    if (obj && typeof obj.completed === 'string') parsed = obj as TaskCompletionBlock;
  } catch { /* malformed JSON, drop silently — parse-failure fallback per §4.4 */ }
  return {
    cleanMessage: text.replace(/<task_completion>[\s\S]*?<\/task_completion>/, '').trim(),
    completion: parsed,
  };
}

// Authoritative 13-task registry — mirrors src/services/onboarding-tasks.service.ts
// and MASTER_PLAN Appendix A. Used by both server validation and next_suggestions whitelist.
const VALID_TASK_KEYS = new Set([
  'introduce_yourself', 'set_goal', 'daily_routine', 'eating_habits', 'allergies',
  'kitchen_logistics', 'exercise_history', 'health_history', 'weight_history',
  'lab_values', 'sleep_patterns', 'stress_motivation', 'home_environment',
]);

async function validateTaskCompletion(
  userId: string,
  taskKey: string,
): Promise<{ valid: boolean; missingReason?: string }> {
  if (!VALID_TASK_KEYS.has(taskKey)) return { valid: false, missingReason: `unknown task key: ${taskKey}` };

  const { data: p } = await supabaseAdmin.from('profiles').select('*').eq('id', userId).maybeSingle();
  const profile = (p ?? {}) as Record<string, unknown>;

  switch (taskKey) {
    case 'introduce_yourself':
      if (!profile.height_cm)  return { valid: false, missingReason: 'height_cm' };
      if (!profile.weight_kg)  return { valid: false, missingReason: 'weight_kg' };
      if (!profile.birth_year) return { valid: false, missingReason: 'birth_year' };
      if (!profile.gender)     return { valid: false, missingReason: 'gender' };
      return { valid: true };
    case 'set_goal': {
      // limit(1) instead of maybeSingle(): if multiple active goals exist (legacy
      // before migration 033), maybeSingle throws and validation fails silently.
      const { data: gs } = await supabaseAdmin
        .from('goals').select('goal_type').eq('user_id', userId).eq('is_active', true).limit(1);
      const goalType = gs?.[0]?.goal_type;
      if (!goalType) return { valid: false, missingReason: 'goal_type' };
      return { valid: true };
    }
    case 'daily_routine':
      if (!profile.occupation && !profile.work_start) return { valid: false, missingReason: 'occupation_or_work_start' };
      return { valid: true };
    case 'eating_habits':
      if (!profile.eating_out_frequency && !profile.meal_count_preference) return { valid: false, missingReason: 'eating_habits_any_field' };
      return { valid: true };
    case 'allergies': {
      const { count } = await supabaseAdmin
        .from('food_preferences').select('id', { count: 'exact', head: true })
        .eq('user_id', userId).eq('is_allergen', true);
      // Empty allergy list is valid if user confirmed — we trust the AI's judgment here
      // since "no allergies" is a legitimate outcome. Count >= 0 means user was asked.
      return { valid: true, ...(count !== null ? {} : { missingReason: 'allergies_query_failed' }) };
    }
    case 'kitchen_logistics':
      if (!profile.kitchen_equipment && !profile.meal_prep_time) return { valid: false, missingReason: 'kitchen_any_field' };
      return { valid: true };
    case 'exercise_history':
      if (!profile.training_experience && !profile.exercise_history) return { valid: false, missingReason: 'training_or_history' };
      return { valid: true };
    case 'health_history': {
      const { count } = await supabaseAdmin
        .from('health_events').select('id', { count: 'exact', head: true }).eq('user_id', userId);
      // Same logic as allergies — empty list valid if user confirmed "no conditions".
      return { valid: true, ...(count !== null ? {} : { missingReason: 'health_query_failed' }) };
    }
    case 'weight_history':
      if (!profile.previous_diets) return { valid: false, missingReason: 'previous_diets' };
      return { valid: true };
    case 'lab_values': {
      const { count } = await supabaseAdmin
        .from('lab_values').select('id', { count: 'exact', head: true }).eq('user_id', userId);
      // Trust AI; empty is valid ("I don't have recent labs").
      return { valid: true, ...(count !== null ? {} : { missingReason: 'labs_query_failed' }) };
    }
    case 'sleep_patterns':
      if (!profile.sleep_time || !profile.sleep_quality) return { valid: false, missingReason: 'sleep_time_or_quality' };
      return { valid: true };
    case 'stress_motivation':
      if (!profile.stress_level && !profile.motivation_source) return { valid: false, missingReason: 'stress_or_motivation' };
      return { valid: true };
    case 'home_environment':
      if (!profile.household_cooking) return { valid: false, missingReason: 'household_cooking' };
      return { valid: true };
    default:
      return { valid: false, missingReason: 'unhandled' };
  }
}

async function storeMessages(userId: string, userMsg: string, assistantMsg: string, taskMode?: string, modelUsed?: string, tokenCount?: number, executedActions?: Record<string, unknown>[], externalSessionId?: string) {
  let sessionId: string | null = null;

  if (externalSessionId) {
    const { data: existing } = await supabaseAdmin
      .from('chat_sessions')
      .select('id')
      .eq('id', externalSessionId)
      .eq('user_id', userId)
      .maybeSingle();
    if (!existing) {
      // Fail closed — silent fallback to the active session would write the
      // user's message into a different conversation than the one they're
      // viewing. Surface the mismatch instead.
      throw new Error(`SESSION_NOT_FOUND: ${externalSessionId}`);
    }
    sessionId = existing.id;
  } else {
    const { data: session } = await supabaseAdmin
      .from('chat_sessions')
      .select('id')
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();

    if (session) {
      sessionId = session.id;
    } else {
      const { data: newSession, error: insertErr } = await supabaseAdmin
        .from('chat_sessions')
        .insert({ user_id: userId, is_active: true })
        .select('id')
        .maybeSingle();
      if (insertErr) {
        // Most likely cause: a concurrent device just created an active
        // session; the unique partial index (migration 035) rejected this
        // INSERT. Re-select and reuse that session instead of failing.
        const isUniqueViolation = insertErr.code === '23505'
          || /duplicate key|uniq_chat_sessions_one_active_per_user/i.test(insertErr.message ?? '');
        if (!isUniqueViolation) throw insertErr;
        const { data: retry } = await supabaseAdmin
          .from('chat_sessions')
          .select('id')
          .eq('user_id', userId)
          .eq('is_active', true)
          .maybeSingle();
        sessionId = retry?.id ?? null;
      } else {
        sessionId = newSession?.id ?? null;
      }
    }
  }

  await supabaseAdmin.from('chat_messages').insert([
    { user_id: userId, session_id: sessionId, role: 'user', content: userMsg, task_mode: taskMode },
    {
      user_id: userId, session_id: sessionId, role: 'assistant', content: assistantMsg,
      task_mode: taskMode, model_version: modelUsed ?? null,
      token_count: tokenCount ?? null,
      actions_executed: executedActions?.length ? executedActions.map(a => ({ type: a.type })) : null,
    },
  ]);

  // Auto-generate session title from first user message
  if (sessionId) {
    const { count } = await supabaseAdmin
      .from('chat_messages').select('*', { count: 'exact', head: true })
      .eq('session_id', sessionId);
    if (count && count <= 2) {
      // Use first user message as title (more descriptive than AI response)
      const title = userMsg.substring(0, 60).replace(/\n/g, ' ');
      await supabaseAdmin.from('chat_sessions')
        .update({ title, message_count: count })
        .eq('id', sessionId)
        .is('title', null); // Only set if title not already set
    } else if (count) {
      await supabaseAdmin.from('chat_sessions')
        .update({ message_count: count })
        .eq('id', sessionId);
    }
  }
}

async function executeActions(
  userId: string,
  actions: Record<string, unknown>[],
  gender: string | null,
  targetDate?: string,
  inputMethod: 'text' | 'photo' | 'barcode' | 'voice' | 'template' | 'ai_chat' = 'ai_chat'
): Promise<(string | null)[]> {
  if (!actions || !Array.isArray(actions) || actions.length === 0) return [];
  const today = targetDate ?? new Date().toISOString().split('T')[0];
  const feedback: (string | null)[] = [];

  // Get existing water for today. waterTotal is a MUTABLE running total: every metric
  // upsert (weight/sleep/mood/water) re-writes water_liters because upsert REPLACES the
  // column, so a water_log batched before a later metric action would otherwise be reset
  // to the original value. Increment waterTotal in water_log and write it in the others.
  const { data: todayMetrics } = await supabaseAdmin
    .from('daily_metrics').select('water_liters').eq('user_id', userId).eq('date', today).maybeSingle();
  let waterTotal = (todayMetrics?.water_liters as number | null) ?? 0;

  // Backdated metric upserts must preserve THAT day's water — writing today's
  // running total into yesterday's row would corrupt it.
  const backdatedWater = new Map<string, number>();
  const waterFor = async (date: string): Promise<number> => {
    if (date === today) return waterTotal;
    if (backdatedWater.has(date)) return backdatedWater.get(date)!;
    const { data } = await supabaseAdmin
      .from('daily_metrics').select('water_liters').eq('user_id', userId).eq('date', date).maybeSingle();
    const w = (data?.water_liters as number | null) ?? 0;
    backdatedWater.set(date, w);
    return w;
  };
  const setWaterFor = (date: string, v: number) => {
    if (date === today) waterTotal = v;
    else backdatedWater.set(date, v);
  };

  for (const action of actions) {
    try {
      // Spec 3.1: natural-language backdating ("dün akşam pizza yedim" →
      // days_ago:1 in the action JSON). Clamped to 7 days back, never future.
      const rawDaysAgo = Number((action as Record<string, unknown>).days_ago);
      const actionDate = Number.isFinite(rawDaysAgo) && rawDaysAgo >= 1 && rawDaysAgo <= 7
        ? shiftDateString(today, -Math.round(rawDaysAgo))
        : today;
      switch (action.type) {
        case 'meal_log': {
          // Collect all sub-messages (allergen warning, caffeine notices, low-confidence
          // note, 'Ogun kaydedildi') into ONE entry. The caller maps feedback positionally
          // to actions (one chip per action), so pushing multiple entries here would shove
          // the extras onto later actions' chips and drop them for a lone meal_log.
          const mealFeedback: string[] = [];
          const items = action.items as { name: string; portion: string; calories: number; protein_g: number; carbs_g: number; fat_g: number; confidence?: number }[] | undefined;
          // meal_type is CHECK-constrained to breakfast|lunch|dinner|snack. A stray model
          // value (e.g. 'brunch', 'ara ogun') would 23514-reject the whole insert and
          // silently drop the meal — whitelist it, defaulting to 'snack' on any miss.
          const VALID_MEAL_TYPES = new Set(['breakfast', 'lunch', 'dinner', 'snack']);
          const rawMealType = action.meal_type as string ?? 'snack';
          const mealType = VALID_MEAL_TYPES.has(rawMealType) ? rawMealType : 'snack';

          // Aggregate confidence: bucket from min item confidence
          let mealConfidence: 'high' | 'medium' | 'low' = 'medium';
          if (items?.length) {
            const confidences = items.map(i => typeof i.confidence === 'number' ? i.confidence : 0.75);
            const minConf = Math.min(...confidences);
            mealConfidence = minConf >= 0.85 ? 'high' : minConf >= 0.65 ? 'medium' : 'low';
          }

          // Allergen check for register mode (Spec 12.7)
          if (items?.length) {
            const { data: allergens } = await supabaseAdmin
              .from('food_preferences')
              .select('food_name, allergen_severity')
              .eq('user_id', userId)
              .eq('is_allergen', true);
            if (allergens && allergens.length > 0) {
              const itemNames = items.map(i => i.name.toLocaleLowerCase('tr'));
              const matched = allergens.filter(a =>
                itemNames.some(n => n.includes(a.food_name.toLocaleLowerCase('tr')))
              );
              if (matched.length > 0) {
                const warns = matched.map(m =>
                  `${m.food_name}${m.allergen_severity === 'severe' ? ' (CIDDI ALERJI!)' : ' (alerjen)'}`
                );
                mealFeedback.push(`⚠️ ALERJEN UYARISI: ${warns.join(', ')} — yine de kaydedildi`);
              }
            }
          }

          // Duplicate guard: the model sometimes re-emits meals from earlier
          // turns of the same conversation (observed live: 1 new meal arrived
          // with 2 re-logs of already-saved ones). Same text + same target day
          // within 10 minutes = duplicate, skip silently.
          const rawText = (action.raw as string ?? '').trim();
          if (rawText) {
            const { data: recentDupe } = await supabaseAdmin
              .from('meal_logs').select('id')
              .eq('user_id', userId)
              .eq('raw_input', rawText)
              .eq('logged_for_date', actionDate)
              .eq('is_deleted', false)
              .gte('logged_at', new Date(Date.now() - 10 * 60 * 1000).toISOString())
              .limit(1);
            if (recentDupe && recentDupe.length > 0) {
              feedback.push(null); // already saved — no chip, no double row
              break;
            }
          }

          const { data: log, error: logErr } = await supabaseAdmin.from('meal_logs').insert({
            user_id: userId, raw_input: rawText,
            meal_type: mealType,
            input_method: inputMethod,
            confidence: mealConfidence,
            logged_for_date: actionDate, synced: true,
          }).select('id').maybeSingle();

          // Supabase does not throw on DB errors — if the parent insert failed (or returned
          // no row) the meal was NOT saved. Surface a failure chip instead of falling
          // through to 'Ogun kaydedildi', which would lie to the user about a saved meal.
          if (logErr || !log) {
            if (logErr) console.error('[meal_logs] insert failed:', logErr.message);
            feedback.push('Kayit basarisiz: ogun');  // one entry for this action
            break;
          }

          if (log && items?.length) {
            // Phase 6: Cooking method calorie adjustments
            const cookingMethod = action.cooking_method as string | null;
            const COOKING_MULTIPLIERS: Record<string, number> = {
              fried: 1.15, deep_fried: 1.25, kizartma: 1.15, derin_kizartma: 1.25,
              grilled: 0.95, izgara: 0.95,
              steamed: 0.90, buharla: 0.90,
              boiled: 0.95, haslama: 0.95,
              sauteed: 1.10, sotele: 1.10, kavurma: 1.10,
              raw: 1.0, cig: 1.0,
              baked: 1.0, firinda: 1.0,
            };
            const multiplier = cookingMethod ? (COOKING_MULTIPLIERS[cookingMethod.toLowerCase()] ?? 1.0) : 1.0;

            const { error: itemsErr } = await supabaseAdmin.from('meal_log_items').insert(
              items.map(i => ({
                meal_log_id: log.id, food_name: i.name ?? 'Yiyecek', portion_text: i.portion ?? '1 porsiyon',
                // calories is smallint (max 32767) — clamp so one absurd value (parse
                // error) can't overflow and 22003-fail the WHOLE item batch (#R4-14).
                calories: Math.min(32767, Math.max(0, Math.round(i.calories * multiplier))),
                protein_g: Math.max(0, i.protein_g), carbs_g: Math.max(0, i.carbs_g),
                fat_g: Math.max(0, Math.round(i.fat_g * multiplier)),
                data_source: 'ai_estimate',
              }))
            );
            // NOTE: cooking_method is NOT a column on meal_log_items — its effect
            // is already folded into calories/fat via `multiplier` above. Writing
            // it 42703'd and silently dropped EVERY item (zero-calorie meals).
            if (itemsErr) console.error('[meal_log_items] insert failed:', itemsErr.message);
          }

          // --- Auto Meal Time Learning (Spec 5.15) ---
          learnMealTime(userId, mealType, action.logged_at as string | undefined).then(() => {}, () => {});

          // --- Caffeine Integration (Spec 5.34) ---
          // Caffeine notices used to be pushed as separate feedback entries (and the case
          // broke early), so for a lone meal_log they landed on later actions' chips and
          // were dropped. Accumulate them into mealFeedback so they reach the user.
          if (items?.length) {
            const caffeineFeedback = await checkCaffeineIntake(userId, items, today);
            for (const cf of caffeineFeedback) mealFeedback.push(cf);
          }

          // A8: Low confidence proactive verification
          // NOTE: assistantMessage is not in scope here; pass via closure via the outer variable.
          // We check the action's items for suspicious calorie totals.
          if (items?.length) {
            const totalMealCal = items.reduce((s, i) => s + (i.calories ?? 0), 0);
            if (totalMealCal > 1500 || (totalMealCal > 0 && totalMealCal < 50)) {
              mealFeedback.push('NOT: Dusuk guvenli tahmin — kullanicidan dogrulama iste.');
            }
          }

          mealFeedback.push('Ogun kaydedildi');
          // Single entry per action: join allergen + caffeine + low-conf + 'kaydedildi'.
          feedback.push(mealFeedback.join('\n'));
          break;
        }
        case 'workout_log': {
          const durationMin = (action.duration_min as number) ?? 0;
          // Whitelist the two CHECK-constrained columns (workout_type IN cardio|
          // strength|flexibility|sports|mixed, intensity IN low|moderate|high). An
          // off-enum model value (e.g. 'running'/'kuvvet'/'çok yüksek') would
          // 23514-fail the insert, skip strength_sets, and the user would be falsely
          // told the workout was saved (#R2-1).
          const VALID_WORKOUT_TYPES = new Set(['cardio', 'strength', 'flexibility', 'sports', 'mixed']);
          const VALID_INTENSITIES = new Set(['low', 'moderate', 'high']);
          const intensity = VALID_INTENSITIES.has(action.intensity as string) ? (action.intensity as string) : 'moderate';
          const workoutType = VALID_WORKOUT_TYPES.has(action.workout_type as string) ? (action.workout_type as string) : 'mixed';
          let workoutPrNote = '';

          // MET-based calories_burned if AI didn't provide or gave zero (Spec 7.5)
          // MET table for common workout types/intensities
          const MET_TABLE: Record<string, Record<string, number>> = {
            cardio:     { low: 5,  moderate: 7,  high: 10 },
            strength:   { low: 3,  moderate: 5,  high: 6.5 },
            flexibility:{ low: 2,  moderate: 2.5, high: 3 },
            sports:     { low: 5,  moderate: 7,  high: 10 },
            mixed:      { low: 4,  moderate: 6,  high: 8 },
          };
          let caloriesBurned = (action.calories_burned as number) ?? 0;
          if (caloriesBurned <= 0 && durationMin > 0) {
            const met = MET_TABLE[workoutType]?.[intensity] ?? 5;
            const { data: pRow } = await supabaseAdmin
              .from('profiles').select('weight_kg').eq('id', userId).maybeSingle();
            const bodyWeight = (pRow?.weight_kg as number | null) ?? 70;
            // kcal = MET * weight_kg * hours
            caloriesBurned = Math.round(met * bodyWeight * (durationMin / 60));
          }

          const { data: wlogRow, error: wlogErr } = await supabaseAdmin.from('workout_logs').insert({
            user_id: userId, raw_input: action.raw as string ?? '',
            workout_type: workoutType,
            duration_min: durationMin,
            intensity,
            calories_burned: caloriesBurned,
            logged_for_date: actionDate, synced: true,
          }).select('id').maybeSingle();
          // Gate ALL downstream effects (strength_sets, PR, calorie bump, success
          // chip) on a real write — never claim "Antrenman kaydedildi" on failure.
          if (wlogErr || !wlogRow) {
            console.error('[workout_logs] insert failed:', wlogErr?.message);
            feedback.push('Antrenmanı kaydedemedim, tekrar dener misin?');
            break;
          }

          // Per-set strength data: the system-prompt contract carries detail as a nested
          // strength_sets array on workout_log ({exercise, sets:count, reps, weight_kg}).
          // The handler never read it, so chat strength logging never populated the
          // strength_sets table (breaking PR detection / progressive overload). Expand the
          // numeric set count into set_number = 1..N rows and insert them now.
          const strengthSets = action.strength_sets as { exercise: string; sets: number; reps: number; weight_kg: number }[] | undefined;
          if (wlogRow?.id && Array.isArray(strengthSets) && strengthSets.length > 0) {
            const setRows: { workout_log_id: string; exercise_name: string; set_number: number; reps: number; weight_kg: number }[] = [];
            for (const s of strengthSets) {
              const setCount = Math.max(1, Math.round(Number(s.sets) || 1));
              for (let n = 1; n <= setCount; n++) {
                setRows.push({
                  workout_log_id: wlogRow.id as string,
                  // Canonical snake_case at the WRITE boundary — every reader
                  // (ai-plan progression, overload notifier, Strength screen)
                  // matches exact snake_case ids, so "bench press" rows were
                  // invisible to all of them.
                  exercise_name: canonicalExerciseName(s.exercise),
                  set_number: n,
                  // reps is NOT NULL — coerce so a model that omits reps doesn't
                  // 23502-fail the WHOLE batch and lose every set (#R2-11). weight
                  // defaults to 0 (bodyweight) when absent.
                  reps: Math.max(1, Math.round(Number(s.reps)) || 1),
                  weight_kg: Number.isFinite(Number(s.weight_kg)) ? Number(s.weight_kg) : 0,
                });
              }
            }
            if (setRows.length > 0) {
              // Spec 13.3: PR detection — compare each exercise's top weight
              // against the user's historical max; mark is_pr and award a 'pr'
              // achievement (is_pr had NO writer anywhere before this).
              const prRows = setRows as (typeof setRows[number] & { is_pr?: boolean })[];
              const prNotes: string[] = [];
              try {
                const uniqueExercises = [...new Set(setRows.map(r => r.exercise_name))];
                for (const ex of uniqueExercises) {
                  const newMax = Math.max(...setRows.filter(r => r.exercise_name === ex).map(r => Number(r.weight_kg) || 0));
                  if (newMax <= 0) continue;
                  const { data: histRows } = await supabaseAdmin
                    .from('strength_sets')
                    .select('weight_kg, workout_logs!inner(user_id)')
                    .eq('exercise_name', ex)
                    .eq('workout_logs.user_id', userId)
                    .order('weight_kg', { ascending: false })
                    .limit(1);
                  const histMax = Number((histRows?.[0] as { weight_kg?: number } | undefined)?.weight_kg) || 0;
                  if (histMax > 0 && newMax > histMax) {
                    for (const r of prRows) {
                      if (r.exercise_name === ex && Number(r.weight_kg) === newMax) r.is_pr = true;
                    }
                    await supabaseAdmin.from('achievements').insert({
                      user_id: userId,
                      achievement_type: 'pr',
                      title: `Yeni rekor: ${ex.replace(/_/g, ' ')} ${newMax}kg`,
                      description: `Önceki en iyin ${histMax}kg idi — +${Math.round((newMax - histMax) * 10) / 10}kg!`,
                    });
                    // Collected, NOT pushed: feedback[] is positionally aligned
                    // with actions[] (one chip per action) — append to the
                    // workout chip below instead.
                    prNotes.push(`🏋️ Yeni kişisel rekor: ${ex.replace(/_/g, ' ')} ${newMax}kg!`);
                  }
                }
              } catch (e) {
                console.error('[strength_sets] PR detection failed:', (e as Error).message);
              }
              const { error: setsErr } = await supabaseAdmin.from('strength_sets').insert(prRows);
              if (setsErr) console.error('[strength_sets] insert failed:', setsErr.message);
              workoutPrNote = prNotes.join(' ');
            }
          }

          // Post-workout calorie target bump (Spec 7.5)
          // Bump today's remaining calorie allowance by ~50% of burned kcal,
          // so user has flexibility to refuel without overshooting.
          if (caloriesBurned >= 150) {
            const bump = Math.round(caloriesBurned * 0.5);

            // Reflect bump on today's daily_plan so dashboard "kalan kalori" updates
            const { data: todayPlan } = await supabaseAdmin
              .from('daily_plans')
              .select('id, calorie_target_min, calorie_target_max')
              .eq('user_id', userId)
              .eq('date', today)
              .maybeSingle();
            if (todayPlan) {
              await supabaseAdmin
                .from('daily_plans')
                .update({
                  calorie_target_min: (todayPlan.calorie_target_min as number) + Math.round(bump * 0.5),
                  calorie_target_max: (todayPlan.calorie_target_max as number) + bump,
                })
                .eq('id', todayPlan.id);
            }

            feedback.push(`Antrenman kaydedildi (~${caloriesBurned} kcal yakim). Bugun icin +${bump} kcal hareket alani acildi.${workoutPrNote ? ` ${workoutPrNote}` : ''}`);
          } else {
            feedback.push(`Antrenman kaydedildi${workoutPrNote ? `. ${workoutPrNote}` : ''}`);
          }
          break;
        }
        case 'weight_log': {
          const w = action.value as number;
          if (w > 20 && w < 300) {
            await supabaseAdmin.from('daily_metrics').upsert(
              { user_id: userId, date: actionDate, weight_kg: w, water_liters: await waterFor(actionDate), synced: true },
              { onConflict: 'user_id,date' }
            );
            await supabaseAdmin.from('profiles').update({ weight_kg: w, updated_at: new Date().toISOString() }).eq('id', userId);
            // weight_history is the canonical measurement store (export + trend source)
            // but was never written by any code path before (#R1-M2). Record each weigh-in.
            await supabaseAdmin.from('weight_history').upsert({ user_id: userId, weight_kg: w, recorded_at: actionDate }, { onConflict: 'user_id,recorded_at' });
            // T1.19: Check if TDEE recalculation needed
            recalculateTDEEIfNeeded(userId, w).then(() => {}, () => {});

            // Creatine water retention check
            const { data: recentCreatine } = await supabaseAdmin
              .from('supplement_logs')
              .select('id')
              .eq('user_id', userId)
              .or('supplement_name.ilike.%kreatin%,supplement_name.ilike.%creatine%')
              .gte('logged_for_date', new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0])
              .limit(1);
            if (recentCreatine && recentCreatine.length > 0) {
              feedback.push('Tarti kaydedildi (kreatin kullaniyorsun — olasi su tutulumunu goz onunde bulundur)');
            } else {
              feedback.push('Tarti kaydedildi');
            }
          } else {
            // Out-of-range value (parse error) — push a placeholder so feedback[]
            // stays positionally aligned with actions[] (#R2-6).
            feedback.push(null);
          }
          break;
        }
        case 'water_log': {
          const l = action.liters as number;
          if (l > 0) {
            const next = (await waterFor(actionDate)) + l;
            setWaterFor(actionDate, next); // keep running totals so later metric upserts preserve them
            await supabaseAdmin.from('daily_metrics').upsert(
              { user_id: userId, date: actionDate, water_liters: next, synced: true },
              { onConflict: 'user_id,date' }
            );
            feedback.push(`Su +${l}L`);
          } else {
            feedback.push(null); // alignment (#R2-6)
          }
          break;
        }
        case 'sleep_log': {
          const h = action.hours as number;
          if (h > 0 && h < 24) {
            // daily_metrics.sleep_quality CHECK allows only good|ok|bad. The model
            // occasionally emits 'poor'/Turkish synonyms (the profile-field prompt
            // teaches a different vocabulary) — an off-enum value would 23514-reject
            // the WHOLE upsert (sleep_hours included) while we falsely report success.
            const SQ_MAP: Record<string, string> = { poor: 'bad', kotu: 'bad', 'kötü': 'bad', iyi: 'good', orta: 'ok', normal: 'ok' };
            const rawQ = (action.quality as string | undefined)?.toLowerCase();
            const mapped = rawQ ? (SQ_MAP[rawQ] ?? rawQ) : undefined;
            const sleepQuality = mapped && ['good', 'ok', 'bad'].includes(mapped) ? mapped : null; // null is allowed (nullable col)
            const { error: sleepErr } = await supabaseAdmin.from('daily_metrics').upsert(
              { user_id: userId, date: actionDate, sleep_hours: h, sleep_quality: sleepQuality, water_liters: await waterFor(actionDate), synced: true },
              { onConflict: 'user_id,date' }
            );
            if (sleepErr) { console.error('[sleep_log] upsert failed:', sleepErr.message); feedback.push('Uyku kaydi basarisiz'); }
            else feedback.push('Uyku kaydedildi');
          } else {
            feedback.push(null); // alignment (#R2-6)
          }
          break;
        }
        case 'mood_log': {
          // daily_metrics.mood_score CHECK is 1..5. Clamp so an out-of-range value
          // (users say "8/10") doesn't 23514-reject the whole upsert silently.
          const s = Number(action.score);
          const moodScore = Number.isFinite(s) ? Math.min(5, Math.max(1, Math.round(s))) : null;
          if (moodScore === null) { feedback.push(null); break; } // alignment (#R2-6)
          const { error: moodErr } = await supabaseAdmin.from('daily_metrics').upsert(
            { user_id: userId, date: actionDate, mood_score: moodScore, mood_note: action.note as string, water_liters: await waterFor(actionDate), synced: true },
            { onConflict: 'user_id,date' }
          );
          if (moodErr) { console.error('[mood_log] upsert failed:', moodErr.message); feedback.push(null); break; }
          feedback.push('Ruh hali kaydedildi');
          break;
        }
        case 'supplement_log': {
          // supplement_name is NOT NULL — guard the model omitting it, capture the
          // error, and never claim success on failure (#R2-5).
          const suppName = (action.name as string | undefined)?.trim();
          if (!suppName) { feedback.push(null); break; }
          const { error: suppErr } = await supabaseAdmin.from('supplement_logs').insert({
            user_id: userId, supplement_name: suppName,
            amount: action.amount as string, logged_for_date: actionDate,
          });
          if (suppErr) { console.error('[supplement_logs] insert failed:', suppErr.message); feedback.push('Supplement kaydedilemedi'); break; }
          feedback.push('Supplement kaydedildi');
          break;
        }
        case 'commitment': {
          // commitment is NOT NULL — guard + capture error, don't fake success (#R2-5).
          const commitText = (action.text as string | undefined)?.trim();
          if (!commitText) { feedback.push(null); break; }
          const followUp = new Date();
          followUp.setDate(followUp.getDate() + ((action.follow_up_days as number) ?? 1));
          const { error: commitErr } = await supabaseAdmin.from('user_commitments').insert({
            user_id: userId, commitment: commitText,
            follow_up_at: followUp.toISOString(), status: 'pending',
          });
          if (commitErr) { console.error('[user_commitments] insert failed:', commitErr.message); feedback.push(null); break; }
          feedback.push('Taahhut kaydedildi');
          break;
        }
        case 'profile_update': {
          const updates: Record<string, unknown> = {};
          // Core demographics
          if (action.height_cm) updates.height_cm = action.height_cm;
          if (action.weight_kg) {
            updates.weight_kg = action.weight_kg;
            // Mirror into daily_metrics + TDEE check — the model routes plain
            // "85.5 kiloyum" statements here (not weight_log), and without this
            // the weight HISTORY (reports, trend, goal ETA) never got a row
            // from chat-logged weights.
            const wv = Number(action.weight_kg);
            if (Number.isFinite(wv) && wv > 20 && wv < 300) {
              await supabaseAdmin.from('daily_metrics').upsert(
                { user_id: userId, date: actionDate, weight_kg: wv, water_liters: await waterFor(actionDate), synced: true },
                { onConflict: 'user_id,date' }
              );
              recalculateTDEEIfNeeded(userId, wv).then(() => {}, () => {});
            }
          }
          if (action.birth_year) updates.birth_year = action.birth_year;
          if (action.gender) updates.gender = action.gender;
          if (action.display_name) updates.display_name = action.display_name;
          // IF / yeme penceresi (Spec 2.1): the chat previously CONFIRMED IF
          // setup verbally while writing nothing — no if_* field was accepted.
          if (action.if_active !== undefined) updates.if_active = action.if_active === true;
          const HHMM = /^([01]?\d|2[0-3]):[0-5]\d$/;
          if (typeof action.if_eating_start === 'string' && HHMM.test(action.if_eating_start as string)) {
            updates.if_eating_start = action.if_eating_start;
          }
          if (typeof action.if_eating_end === 'string' && HHMM.test(action.if_eating_end as string)) {
            updates.if_eating_end = action.if_eating_end;
          }
          if (typeof action.if_window === 'string') updates.if_window = action.if_window;
          // Menstrual tracking (#R2-H2): previously no chat write path — profile_update
          // silently ignored these, so the spec-described chat flow was non-functional.
          if (action.menstrual_tracking !== undefined) updates.menstrual_tracking = action.menstrual_tracking === true;
          if (typeof action.menstrual_last_period_start === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(action.menstrual_last_period_start as string)) {
            // Guard against a future last-period date (would yield a negative cycle day downstream).
            const d = new Date(action.menstrual_last_period_start as string);
            if (!Number.isNaN(d.getTime()) && d.getTime() <= Date.now()) updates.menstrual_last_period_start = action.menstrual_last_period_start;
          }
          if (typeof action.menstrual_cycle_length === 'number' && action.menstrual_cycle_length >= 20 && action.menstrual_cycle_length <= 45) {
            updates.menstrual_cycle_length = action.menstrual_cycle_length;
          }
          // Micro-goal targets (#R3): water/step targets had no profile_update branch, so a
          // chat-set "günlük su hedefim 3.5 litre" silently dropped while the AI claimed success.
          if (typeof action.water_target_liters === 'number' && action.water_target_liters > 0 && action.water_target_liters <= 10) updates.water_target_liters = action.water_target_liters;
          if (typeof action.step_target === 'number' && action.step_target >= 1000 && action.step_target <= 50000) updates.step_target = Math.round(action.step_target);
          // Schedule & lifestyle
          if (action.occupation) updates.occupation = action.occupation;
          if (action.work_start) updates.work_start = action.work_start;
          if (action.work_end) updates.work_end = action.work_end;
          if (action.sleep_time) updates.sleep_time = action.sleep_time;
          if (action.wake_time) updates.wake_time = action.wake_time;
          if (action.activity_level) updates.activity_level = action.activity_level;
          if (action.meal_count_preference) updates.meal_count_preference = action.meal_count_preference;
          // Nutrition preferences
          if (action.cooking_skill) updates.cooking_skill = action.cooking_skill;
          if (action.budget_level) updates.budget_level = action.budget_level;
          if (action.dietary_restriction) updates.dietary_restriction = action.dietary_restriction;
          if (action.diet_mode) updates.diet_mode = action.diet_mode;
          if (action.eating_out_frequency) updates.eating_out_frequency = action.eating_out_frequency;
          if (action.fastfood_frequency) updates.fastfood_frequency = action.fastfood_frequency;
          if (action.skipped_meals) updates.skipped_meals = action.skipped_meals;
          if (action.night_eating_habit) updates.night_eating_habit = action.night_eating_habit;
          if (action.emotional_eating) updates.emotional_eating = action.emotional_eating;
          if (action.snacking_habit) updates.snacking_habit = action.snacking_habit;
          if (action.caffeine_intake) updates.caffeine_intake = action.caffeine_intake;
          // Kitchen & logistics
          if (action.meal_prep_time) updates.meal_prep_time = action.meal_prep_time;
          if (action.kitchen_equipment) updates.kitchen_equipment = action.kitchen_equipment;
          if (action.household_cooking) updates.household_cooking = action.household_cooking;
          if (action.household_diet_challenge) updates.household_diet_challenge = action.household_diet_challenge;
          // Exercise & training
          if (action.training_experience) updates.training_experience = action.training_experience;
          if (action.training_style) updates.training_style = action.training_style;
          if (action.equipment_access) updates.equipment_access = action.equipment_access;
          if (action.exercise_history) updates.exercise_history = action.exercise_history;
          if (action.preferred_exercises) updates.preferred_exercises = action.preferred_exercises;
          if (action.disliked_exercises) updates.disliked_exercises = action.disliked_exercises;
          if (action.available_training_times) updates.available_training_times = action.available_training_times;
          // Health & wellness
          if (action.stress_level) updates.stress_level = action.stress_level;
          if (action.stress_sources) updates.stress_sources = action.stress_sources;
          if (action.sleep_quality) updates.sleep_quality = action.sleep_quality;
          if (action.digestive_issues) updates.digestive_issues = action.digestive_issues;
          if (action.hormone_conditions) updates.hormone_conditions = action.hormone_conditions;
          if (action.previous_diets) updates.previous_diets = action.previous_diets;
          // Motivation
          if (action.motivation_source) updates.motivation_source = action.motivation_source;
          if (action.biggest_challenge) updates.biggest_challenge = action.biggest_challenge;
          // Body measurements
          if (action.body_fat_pct) updates.body_fat_pct = action.body_fat_pct;
          if (action.waist_cm) updates.waist_cm = action.waist_cm;
          if (action.hip_cm) updates.hip_cm = action.hip_cm;

          // P2: merge disliked_foods into profiles.disliked_foods (JSONB, mig 031). Plan
          // negotiation emits these incrementally, so we append + dedupe by item rather than overwrite.
          if (Array.isArray(action.disliked_foods) && action.disliked_foods.length > 0) {
            const { data: curPref } = await supabaseAdmin.from('profiles').select('disliked_foods').eq('id', userId).maybeSingle();
            const existing = (curPref?.disliked_foods as { item?: string }[] | null) ?? [];
            const seen = new Set(existing.map(d => (d.item ?? '').toLowerCase()));
            const additions = (action.disliked_foods as { item?: string }[]).filter(d => d.item && !seen.has(d.item.toLowerCase()));
            if (additions.length > 0) updates.disliked_foods = [...existing, ...additions];
          }

          // Accumulate this action's sub-messages into ONE feedback entry: the caller
          // maps feedback[i] -> actions[i] positionally (line ~863), so pushing 2
          // (profile + goal) for a single action would shift every later action's chip.
          const pfMessages: string[] = [];
          // Normalize/drop CHECK-constrained enum columns so one off-enum value
          // (e.g. Turkish "orta") can't 23514-fail the whole batch and silently
          // lose every co-submitted field (#7).
          for (const enumField of Object.keys(PROFILE_ENUM_WHITELIST)) {
            if (updates[enumField] !== undefined) {
              const norm = normalizeProfileEnum(enumField, updates[enumField]);
              if (norm === null) delete updates[enumField];
              else updates[enumField] = norm;
            }
          }
          if (Object.keys(updates).length > 0) {
            updates.updated_at = new Date().toISOString();
            const { error: pfErr } = await supabaseAdmin.from('profiles').update(updates).eq('id', userId);
            if (pfErr) console.error('[profile_update] update failed:', pfErr.message);
            else pfMessages.push('Profil güncellendi');
            // #R3/journey: activity_level is usually set on a LATER onboarding card than the
            // identity card that first computed TDEE — checkOnboardingCompletion only computes
            // TDEE once (when onboarding flips), so a later activity change left calorie targets
            // stuck on the sedentary 1.2 multiplier (~30% low). Force a TDEE+ranges recompute.
            if (!pfErr && updates.activity_level !== undefined) {
              const { data: wRow } = await supabaseAdmin.from('profiles').select('weight_kg').eq('id', userId).maybeSingle();
              const wv = wRow?.weight_kg as number | null;
              if (wv) recalculateTDEEIfNeeded(userId, wv, true).then(() => {}, () => {});
            }
          }
          // Goal persistence: save even without target_weight_kg — user may give goal type
          // ("kilo vermek istiyorum") before specifying a target. Upsert on active goal so
          // adding the target later just updates the same row. Uses limit(1) instead of
          // maybeSingle() to survive the legacy "multiple active goals" case before
          // migration 033. A partial unique index now prevents new duplicates.
          if (action.goal_type || action.target_weight_kg) {
            const { data: existingRows } = await supabaseAdmin
              .from('goals')
              .select('id, start_weight_kg, target_weight_kg, target_weeks')
              .eq('user_id', userId)
              .eq('is_active', true)
              .limit(1);
            const existing = existingRows?.[0] ?? null;
            const goalPatch: Record<string, unknown> = {
              user_id: userId,
              is_active: true,
            };
            if (action.target_weight_kg) goalPatch.target_weight_kg = action.target_weight_kg;

            // start_weight_kg: fixed baseline snapshot for progress math (DoD#7).
            // Derive weekly_rate from |start - target| / weeks instead of a 0.5
            // hardcode when both ends are known.
            const { data: goalProfile } = await supabaseAdmin
              .from('profiles').select('weight_kg').eq('id', userId).maybeSingle();
            const currentWeight = (goalProfile?.weight_kg as number | null) ?? null;
            const targetW = (action.target_weight_kg as number | undefined)
              ?? (existing?.target_weight_kg as number | undefined) ?? null;
            const weeks = (existing?.target_weeks as number | undefined) ?? 12;
            const startW = (existing?.start_weight_kg as number | null) ?? currentWeight;
            if (!existing && currentWeight) goalPatch.start_weight_kg = currentWeight;
            else if (existing && !existing.start_weight_kg && currentWeight) goalPatch.start_weight_kg = currentWeight;

            // Whitelist goal_type — a model-emitted profile_update bypasses both the
            // regex safety-net and goal_suggestion's GOAL_TYPE_MAP, so an off-enum
            // value (e.g. 'cut'/'kilo_verme') would 23514-fail the insert (#8).
            // On an EXISTING goal, also DROP a model goal_type that contradicts the
            // weights (#R1-L6: 'maintain'/'gain' emitted on a target-only weight-loss
            // correction) so the correct existing goal_type is preserved.
            const modelGoalType = (action.goal_type && CANONICAL_GOAL_TYPES.has(action.goal_type as string)) ? (action.goal_type as string) : null;
            if (modelGoalType) {
              let consistent = true;
              if (existing && startW && targetW && Math.abs(startW - targetW) > 1) {
                const losing = startW > targetW;
                if (losing && (modelGoalType === 'maintain' || modelGoalType === 'gain_weight')) consistent = false;
                if (!losing && (modelGoalType === 'lose_weight' || modelGoalType === 'maintain')) consistent = false;
              }
              if (consistent) goalPatch.goal_type = modelGoalType;
            } else if (!existing) {
              goalPatch.goal_type = 'lose_weight'; // only set default on brand-new row
            }

            const derivedRate = (startW && targetW && weeks > 0)
              ? Math.round((Math.abs(startW - targetW) / weeks) * 100) / 100
              : null;

            let goalWriteOk = true;
            if (!existing) {
              goalPatch.target_weeks = 12;
              goalPatch.priority = 'sustainable';
              goalPatch.restriction_mode = 'sustainable';
              goalPatch.weekly_rate = derivedRate ?? 0.5;
              const { error: gInsErr } = await supabaseAdmin.from('goals').insert(goalPatch);
              if (gInsErr) { console.error('[profile_update] goal insert failed:', gInsErr.message); goalWriteOk = false; }
            } else {
              if (derivedRate) goalPatch.weekly_rate = derivedRate;
              const { error: gUpdErr } = await supabaseAdmin.from('goals').update(goalPatch).eq('id', existing.id);
              if (gUpdErr) { console.error('[profile_update] goal update failed:', gUpdErr.message); goalWriteOk = false; }
            }
            // Only claim success when the DB actually accepted the write — never tell
            // the user "Hedef belirlendi" while the row was rejected (#8).
            if (goalWriteOk) pfMessages.push(action.target_weight_kg ? 'Hedef belirlendi' : 'Hedef tipi kaydedildi');
          }
          // Exactly one feedback entry for this profile_update action (null = no chip,
          // but keeps feedback[] positionally aligned with actions[]).
          feedback.push(pfMessages.length > 0 ? pfMessages.join('\n') : null);
          break;
        }
        // NOTE: strength logging is handled by the `workout_log` action (it parses
        // action.strength_sets into the strength_sets table). The old dead `strength_log`
        // case (action.sets) was never emitted by any prompt and was removed in cleanup.
        case 'food_preference': {
          // Spec 12.4 chain: allergies/intolerances DECLARED IN CHAT must reach
          // food_preferences — the allergen guardrails read ONLY that table, so
          // without this action a chat-declared allergy never protected anyone.
          const VALID_PREFS = new Set(['love', 'like', 'can_cook', 'dislike', 'never']);
          const VALID_SEV = new Set(['mild', 'moderate', 'severe']);
          const foodName = (action.food_name as string ?? '').trim();
          if (!foodName) { feedback.push(null); break; }
          const rawPref = action.preference as string ?? (action.is_allergen ? 'never' : 'dislike');
          const fpRow: Record<string, unknown> = {
            user_id: userId,
            food_name: foodName.toLocaleLowerCase('tr'),
            preference: VALID_PREFS.has(rawPref) ? rawPref : 'dislike',
            is_allergen: action.is_allergen === true,
          };
          if (action.is_allergen === true) {
            fpRow.allergen_severity = VALID_SEV.has(action.allergen_severity as string)
              ? action.allergen_severity : 'moderate';
          }
          const { error: fpErr } = await supabaseAdmin.from('food_preferences').insert(fpRow);
          if (fpErr) {
            console.error('[food_preference] insert failed:', fpErr.message);
            feedback.push(null);
          } else {
            feedback.push(action.is_allergen === true ? 'Alerjen kaydedildi' : 'Yemek tercihi kaydedildi');
          }
          break;
        }
        case 'health_event': {
          // Spec 2.1/12.2-12.3: surgeries, injuries, chronic conditions told in
          // chat persist to health_events (the injury guardrail reads it).
          const desc = (action.description as string ?? '').trim();
          if (!desc) { feedback.push(null); break; }
          const VALID_EVENTS = new Set(['surgery', 'injury', 'illness', 'condition', 'medication', 'other']);
          const rawEvent = action.event_type as string ?? 'other';
          const { error: heErr } = await supabaseAdmin.from('health_events').insert({
            user_id: userId,
            event_type: VALID_EVENTS.has(rawEvent) ? rawEvent : 'other',
            description: desc,
            event_date: typeof action.event_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(action.event_date as string)
              ? action.event_date : null,
            is_ongoing: action.is_ongoing !== false, // default true: it matters for guardrails
          });
          if (heErr) {
            console.error('[health_event] insert failed:', heErr.message);
            feedback.push(null);
          } else {
            feedback.push('Sağlık bilgisi kaydedildi');
          }
          break;
        }
        case 'save_recipe': {
          // T3.6: Save recipe from AI chat to recipe library. ingredients is jsonb
          // NOT NULL with no default — if the model omits it, default to [] so the
          // insert doesn't 23502-fail, and capture the error so we don't claim
          // "Tarif kaydedildi" when nothing was written (#R2-4).
          const recipe = action as Record<string, unknown>;
          const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
          const { error: recipeErr } = await supabaseAdmin.from('saved_recipes').insert({
            user_id: userId,
            title: recipe.title as string ?? 'Tarif',
            category: recipe.category as string ?? 'dinner',
            ingredients,
            instructions: recipe.instructions as string ?? '',
            total_calories: recipe.calories as number ?? 0,
            total_protein: recipe.protein_g as number ?? 0,
            prep_time_min: recipe.prep_time_min as number ?? 0,
            servings: recipe.servings as number ?? 1,
          });
          if (recipeErr) { console.error('[saved_recipes] insert failed:', recipeErr.message); feedback.push('Tarif kaydedilemedi'); break; }
          feedback.push('Tarif kaydedildi');
          break;
        }
        case 'undo_last': {
          // Spec 5.32: Undo last action - find and reverse most recent log
          const undoType = action.undo_type as string ?? 'meal';
          if (undoType === 'meal') {
            const { data: lastMeal } = await supabaseAdmin.from('meal_logs')
              .select('id').eq('user_id', userId).eq('is_deleted', false)
              .order('logged_at', { ascending: false }).limit(1).maybeSingle();
            if (lastMeal) {
              await supabaseAdmin.from('meal_logs').update({ is_deleted: true, deleted_at: new Date().toISOString() }).eq('id', lastMeal.id);
              feedback.push('Son ogun kaydi silindi');
            }
          } else if (undoType === 'workout') {
            const { data: lastWorkout } = await supabaseAdmin.from('workout_logs')
              .select('id').eq('user_id', userId)
              .order('logged_at', { ascending: false }).limit(1).maybeSingle();
            if (lastWorkout) {
              await supabaseAdmin.from('workout_logs').delete().eq('id', lastWorkout.id);
              feedback.push('Son antrenman kaydi silindi');
            }
          } else if (undoType === 'supplement') {
            const { data: lastSupp } = await supabaseAdmin.from('supplement_logs')
              .select('id').eq('user_id', userId)
              .order('logged_at', { ascending: false }).limit(1).maybeSingle();
            if (lastSupp) {
              await supabaseAdmin.from('supplement_logs').delete().eq('id', lastSupp.id);
              feedback.push('Son supplement kaydi silindi');
            }
          }
          break;
        }
        case 'mvd_activate': {
          // Spec 6.4: Suspend today's plan for Minimum Viable Day
          await supabaseAdmin.from('daily_plans')
            .update({ status: 'mvd_suspended' })
            .eq('user_id', userId).eq('date', today);
          // Schedule next-day follow-up
          const mvdFollowUp = new Date(Date.now() + 86400000);
          mvdFollowUp.setHours(9, 0, 0, 0);
          await supabaseAdmin.from('user_commitments').insert({
            user_id: userId,
            commitment: 'MVD gunu — yarin normal plana don',
            follow_up_at: mvdFollowUp.toISOString(),
            status: 'pending',
          });
          feedback.push('MVD modu aktif — bugun sadece basit hedefler');
          break;
        }
        case 'recovery_plan': {
          // Spec 6.3: Schedule recovery follow-up + distribute excess calories over next 2-3 days
          const recoveryFollowUp = new Date(Date.now() + 86400000);
          recoveryFollowUp.setHours(9, 0, 0, 0);
          await supabaseAdmin.from('user_commitments').insert({
            user_id: userId,
            commitment: 'Kurtarma takibi — dun fazla yedin, bugun nasil gidiyor?',
            follow_up_at: recoveryFollowUp.toISOString(),
            status: 'pending',
          });

          // Spread excess across next 2-3 days
          // excess_kcal passed by AI; if not, compute from today's intake vs target
          let excessKcal = (action.excess_kcal as number | undefined) ?? 0;
          if (excessKcal <= 0) {
            const { data: todayReport } = await supabaseAdmin
              .from('daily_reports')
              .select('calorie_actual')
              .eq('user_id', userId).eq('date', today).maybeSingle();
            const { data: todayPlan } = await supabaseAdmin
              .from('daily_plans')
              .select('calorie_target_max')
              .eq('user_id', userId).eq('date', today).maybeSingle();
            const actual = (todayReport?.calorie_actual as number | null) ?? 0;
            const target = (todayPlan?.calorie_target_max as number | null) ?? 2000;
            excessKcal = Math.max(0, actual - target);
          }

          if (excessKcal >= 200) {
            // Distribute over next 2 days (spec says 2-3, 2 keeps per-day dip reasonable)
            const perDayDip = Math.round(excessKcal / 2);
            const { data: profileFloor } = await supabaseAdmin
              .from('profiles').select('gender').eq('id', userId).maybeSingle();
            const floor = profileFloor?.gender === 'female' ? 1200 : 1400;

            for (let offset = 1; offset <= 2; offset++) {
              const targetDate = shiftDateString(today, offset);
              const { data: futurePlan } = await supabaseAdmin
                .from('daily_plans')
                .select('id, calorie_target_min, calorie_target_max')
                .eq('user_id', userId).eq('date', targetDate).maybeSingle();
              if (futurePlan) {
                const newMin = Math.max(floor, (futurePlan.calorie_target_min as number) - Math.round(perDayDip / 2));
                const newMax = Math.max(floor + 100, (futurePlan.calorie_target_max as number) - perDayDip);
                await supabaseAdmin.from('daily_plans').update({
                  calorie_target_min: newMin,
                  calorie_target_max: newMax,
                }).eq('id', futurePlan.id);
              }
            }
            feedback.push(`Kurtarma plani olusturuldu. ~${excessKcal} kcal fazlayi sonraki 2 gune dagittim (gunluk -${perDayDip} kcal).`);
          } else {
            feedback.push('Kurtarma plani olusturuldu');
          }
          break;
        }
        case 'venue_log': {
          const venueName = action.venue_name as string;
          // Fetch existing venue to merge learned items and increment visit count
          const { data: existingVenue } = await supabaseAdmin
            .from('user_venues')
            .select('learned_items, visit_count')
            .eq('user_id', userId)
            .eq('venue_name', venueName)
            .maybeSingle();

          const existingItems = (existingVenue?.learned_items as { name: string; calories: number; protein_g?: number; confirmed: boolean }[]) ?? [];
          const newItems = (action.items as { name: string; calories: number; protein_g?: number; confirmed?: boolean }[]) ?? [];

          // Merge: update existing items, add new ones
          const mergedItems = [...existingItems];
          for (const item of newItems) {
            const idx = mergedItems.findIndex(m => m.name.toLowerCase() === item.name.toLowerCase());
            if (idx >= 0) {
              mergedItems[idx] = {
                ...mergedItems[idx],
                calories: Math.round((mergedItems[idx].calories + item.calories) / 2),
                protein_g: item.protein_g ?? mergedItems[idx].protein_g,
              };
            } else {
              mergedItems.push({ name: item.name, calories: item.calories, protein_g: item.protein_g, confirmed: item.confirmed ?? false });
            }
          }

          const newVisitCount = (existingVenue?.visit_count ?? 0) + 1;

          await supabaseAdmin.from('user_venues').upsert({
            user_id: userId,
            venue_name: venueName,
            learned_items: mergedItems,
            visit_count: newVisitCount,
          }, { onConflict: 'user_id,venue_name' });
          feedback.push('Mekan kaydedildi');
          break;
        }
        case 'periodic_state_update': {
          const rawState = action.state as string | null;
          // Clearing ("iyileştim") maps none/normal/null to ACTUAL NULLs — the
          // old code wrote the literal string 'none' into periodic_state and the
          // Layer-1 context then rendered "DONEMSEL DURUM: none" forever.
          const CLEARING = !rawState || ['none', 'normal', 'bitti', 'gecti', 'geçti'].includes(rawState);
          // Validate against the known states — model free text must not land
          // in the column (consumers silently no-op on unknown states).
          const VALID_STATES = new Set(['ramadan', 'holiday', 'illness', 'busy_work', 'exam', 'pregnancy', 'breastfeeding', 'injury', 'travel', 'custom']);
          if (!CLEARING && !VALID_STATES.has(rawState as string)) {
            feedback.push(`Donemsel durum taninmadi: ${rawState}`);
            break;
          }
          const newState = CLEARING ? '' : (rawState as string);
          // requiresEndDate states (ramadan etc.) must not persist open-ended —
          // the auto-expiry in ai-proactive only fires when an end date exists.
          const MAX_DURATION: Record<string, number> = { ramadan: 30, illness: 14, holiday: 30, exam: 30, busy_work: 30, travel: 30 };
          const endDate = (action.end_date as string | null)
            ?? (newState && MAX_DURATION[newState] ? shiftDateString(today, MAX_DURATION[newState]) : null);
          const profileUpdates: Record<string, unknown> = CLEARING
            ? { periodic_state: null, periodic_state_start: null, periodic_state_end: null, updated_at: new Date().toISOString() }
            : {
                periodic_state: newState,
                periodic_state_start: today,
                periodic_state_end: endDate,
                updated_at: new Date().toISOString(),
              };

          // Past period memory: look up last occurrence of same state (Spec 9)
          if (newState && !['none', 'normal'].includes(newState)) {
            try {
              const { data: summary } = await supabaseAdmin
                .from('ai_summary').select('seasonal_notes').eq('user_id', userId).maybeSingle();
              const notes = (summary?.seasonal_notes as string) ?? '';
              const regex = new RegExp(`\\[${newState}_\\d{4}\\][^\\n]*`, 'g');
              const matches = notes.match(regex);
              if (matches && matches.length > 0) {
                // Most recent match (last in list)
                feedback.push(`Gecen ${newState} doneminden not: ${matches[matches.length - 1]}`);
              }
            } catch { /* non-critical */ }
          }
          // Auto-pause IF for every IF-incompatible state (config-driven —
          // the old hardcoded trio missed ramadan, which is ifCompatible:false).
          if (newState && !isIFCompatible(newState as PeriodicState)) {
            profileUpdates.if_active = false;
          }
          await supabaseAdmin.from('profiles').update(profileUpdates).eq('id', userId);

          // Auto-pause active challenges on illness/travel/holiday (Spec 6.4)
          const PAUSE_STATES = ['illness', 'travel', 'holiday'];
          if (PAUSE_STATES.includes(newState)) {
            try {
              const { data: activeChallenges } = await supabaseAdmin
                .from('challenges')
                .select('id')
                .eq('user_id', userId)
                .eq('status', 'active');
              if (activeChallenges && activeChallenges.length > 0) {
                const challengeIds = activeChallenges.map((c: { id: string }) => c.id);
                await supabaseAdmin
                  .from('challenges')
                  .update({ status: 'paused', paused_at: new Date().toISOString() })
                  .in('id', challengeIds);
                const stateLabel = newState === 'illness' ? 'Hastalik' : newState === 'travel' ? 'Seyahat' : 'Tatil';
                feedback.push(`${stateLabel} nedeniyle ${activeChallenges.length} aktif challenge duraklatildi.`);
              }
            } catch { /* challenge pause non-critical */ }
          }

          // Auto-resume paused challenges when exiting a pause state
          if (newState === 'none' || newState === 'normal' || !newState) {
            try {
              const { data: pausedChallenges } = await supabaseAdmin
                .from('challenges')
                .select('id')
                .eq('user_id', userId)
                .eq('status', 'paused');
              if (pausedChallenges && pausedChallenges.length > 0) {
                const challengeIds = pausedChallenges.map((c: { id: string }) => c.id);
                await supabaseAdmin
                  .from('challenges')
                  .update({ status: 'active', paused_at: null })
                  .in('id', challengeIds);
                feedback.push(`${pausedChallenges.length} duraklatilmis challenge tekrar aktif.`);
              }
            } catch { /* challenge resume non-critical */ }
          }

          // Write seasonal note to Layer 2
          const { data: existing } = await supabaseAdmin
            .from('ai_summary').select('seasonal_notes').eq('user_id', userId).maybeSingle();
          const currentNotes = (existing?.seasonal_notes as string) ?? '';
          const dateStr = new Date().toISOString().split('T')[0];
          const newNote = CLEARING
            ? `${currentNotes}\n[${dateStr}] donemsel durum sona erdi, normale donuldu`.trim()
            : `${currentNotes}\n[${dateStr}] ${newState} donemi baslatildi${endDate ? ` (bitis: ${endDate})` : ''}`.trim();
          await supabaseAdmin.from('ai_summary').upsert(
            { user_id: userId, seasonal_notes: newNote, updated_at: new Date().toISOString() },
            { onConflict: 'user_id' }
          );
          feedback.push(CLEARING ? 'Donemsel durum kapatildi — normale donuldu' : `Donemsel durum: ${newState}`);
          break;
        }
        case 'plateau_strategy_apply': {
          // Spec 6.5: User approved a plateau-breaking strategy. Mutate today's plan
          // and (conservatively) user's maintenance/rest calorie bands for the next
          // 2 weeks. AI reminds user of start/end — we just store the adjustment.
          const strategyId = action.strategy_id as string;
          const { data: pProfile } = await supabaseAdmin
            .from('profiles').select('calorie_range_rest_min, calorie_range_rest_max, protein_per_kg, weight_kg')
            .eq('id', userId).maybeSingle();
          const curMin = (pProfile?.calorie_range_rest_min as number | null) ?? 1600;
          const curMax = (pProfile?.calorie_range_rest_max as number | null) ?? 2000;
          const curProtein = Math.round(((pProfile?.weight_kg as number | null) ?? 70) * ((pProfile?.protein_per_kg as number | null) ?? 1.8));

          // Local re-implementation of applyPlateauStrategy to avoid importing client service in edge fn
          let newMin = curMin, newMax = curMax, newProtein = curProtein, instructions = '';
          switch (strategyId) {
            case 'calorie_cycle':
              newMin = curMin - 200; newMax = curMax + 200;
              instructions = 'Hafta ici dusuk, hafta sonu yuksek. Ortalama ayni.';
              break;
            case 'refeed':
              instructions = 'Haftada 1 refeed gunu (antrenman gunu), kalori bakim seviyesine cikarilir.';
              break;
            case 'tdee_recalc':
              newMin = Math.round(curMin * 0.95); newMax = Math.round(curMax * 0.95);
              instructions = 'Kalori araligi %5 dusuruldu. 2 hafta izle.';
              break;
            case 'maintenance_break':
              newMin = curMax; newMax = curMax + 300;
              instructions = '2 hafta bakim kalorilerinde ye. Acik yok.';
              break;
            case 'training_change':
              newProtein = curProtein + 5;
              instructions = 'Antrenman programi degisir: farkli split, farkli rep araliklari.';
              break;
            default:
              feedback.push(`Bilinmeyen plateau stratejisi: ${strategyId}`);
              break;
          }

          // Mutate today's daily_plan
          await supabaseAdmin.from('daily_plans').update({
            calorie_target_min: newMin,
            calorie_target_max: newMax,
            protein_target_g: newProtein,
          }).eq('user_id', userId).eq('date', today);

          // Update profile bands for next 2 weeks (refeed/training_change keep bands)
          if (strategyId === 'calorie_cycle' || strategyId === 'tdee_recalc' || strategyId === 'maintenance_break') {
            await supabaseAdmin.from('profiles').update({
              calorie_range_rest_min: newMin,
              calorie_range_rest_max: newMax,
            }).eq('id', userId);
          }

          // Store as ai_summary coaching_note so follow-up context remembers
          await updateLayer2(userId, {
            coaching_notes: `[${today}] Plateau stratejisi: ${strategyId}. ${instructions}`,
          }).then(() => {}, () => {});

          feedback.push(`Plateau stratejisi uygulandi: ${strategyId}. ${instructions}`);
          break;
        }
        case 'maintenance_start': {
          // Spec 6.3: Reverse diet — user reached goal; begin +125 kcal/week transition.
          const { data: pProfile } = await supabaseAdmin
            .from('profiles').select('calorie_range_rest_max, tdee_calculated')
            .eq('id', userId).maybeSingle();
          const startCal = (pProfile?.calorie_range_rest_max as number | null) ?? 1800;
          const tdee = (pProfile?.tdee_calculated as number | null) ?? (startCal + 500);
          const weeksNeeded = Math.max(2, Math.min(4, Math.ceil((tdee - startCal) / 125)));

          await supabaseAdmin.from('profiles').update({
            maintenance_mode: true,
            maintenance_start_date: today,
            periodic_state: 'maintenance',
            periodic_state_start: today,
          }).eq('id', userId);

          await updateLayer2(userId, {
            coaching_notes: `[${today}] Bakim modu basladi. Hedef TDEE ${tdee} kcal, ${weeksNeeded} hafta boyunca haftalik +125 kcal artis.`,
          }).then(() => {}, () => {});

          feedback.push(`Bakim modu aktif. ${weeksNeeded} hafta boyunca haftalik +125 kcal artirma plani — tolerans bandi ±1.5kg.`);
          break;
        }
        case 'mini_cut_start': {
          // Spec 6.3: Maintenance band aşıldı — 2-4 haftalık mini cut
          const weeks = Math.max(2, Math.min(4, (action.weeks as number) ?? 3));
          const { data: pProfile } = await supabaseAdmin
            .from('profiles').select('calorie_range_rest_min, calorie_range_rest_max')
            .eq('id', userId).maybeSingle();
          const curMax = (pProfile?.calorie_range_rest_max as number | null) ?? 2000;
          const cutMin = Math.round(curMax - 400);
          const cutMax = Math.round(curMax - 200);

          await supabaseAdmin.from('profiles').update({
            calorie_range_rest_min: cutMin,
            calorie_range_rest_max: cutMax,
            periodic_state: 'mini_cut',
            periodic_state_start: today,
            periodic_state_end: shiftDateString(today, weeks * 7),
          }).eq('id', userId);

          await supabaseAdmin.from('daily_plans').update({
            calorie_target_min: cutMin,
            calorie_target_max: cutMax,
          }).eq('user_id', userId).eq('date', today);

          feedback.push(`Mini cut basladi: ${weeks} hafta, kalori hedefi ${cutMin}-${cutMax} kcal.`);
          break;
        }
        case 'goal_suggestion': {
          // Spec 6.3: User accepted AI-suggested goal — insert into goals.
          const GOAL_TYPE_MAP: Record<string, string> = {
            kas_kazanim: 'gain_muscle', kilo_verme: 'lose_weight', kilo_alma: 'gain_weight',
            saglik: 'health', kondisyon: 'conditioning', bakim: 'maintain',
          };
          const rawType = action.goal_type as string;
          const targetVal = action.target_value as number | null;
          const targetWeeks = (action.target_weeks as number) ?? 12;

          // Metric micro-goals (water/sleep/steps) are NOT goals-table rows —
          // goals.goal_type now has a CHECK on the 6 canonical types and every
          // consumer (progress math, compatibility matrix) only understands
          // those. Persist the metric on the profile target instead.
          if (rawType === 'water' || rawType === 'steps' || rawType === 'sleep') {
            if (rawType === 'water' && targetVal && targetVal >= 1.5 && targetVal <= 6) {
              await supabaseAdmin.from('profiles').update({ water_target_liters: targetVal }).eq('id', userId);
              feedback.push(`Su hedefi guncellendi: ${targetVal}L/gun.`);
            } else if (rawType === 'steps' && targetVal && targetVal >= 3000 && targetVal <= 30000) {
              await supabaseAdmin.from('profiles').update({ step_target: Math.round(targetVal) }).eq('id', userId);
              feedback.push(`Adim hedefi guncellendi: ${Math.round(targetVal)}/gun.`);
            } else {
              await updateLayer2(userId, { coaching_note: `Hedef onerisi kabul edildi: ${rawType}${targetVal ? ` ${targetVal}` : ''}` }).then(() => {}, () => {});
              feedback.push('Hedef not edildi.');
            }
            break;
          }

          const gType = GOAL_TYPE_MAP[rawType];
          if (!gType) {
            // Unmapped free-text type: don't pass through to the CHECK-constrained column.
            feedback.push(`Hedef tipi taninmadi: ${rawType}`);
            break;
          }
          const hasWeightTarget = gType === 'gain_muscle' || gType === 'lose_weight' || gType === 'gain_weight';

          // start_weight_kg snapshot: progress math needs a FIXED baseline —
          // falling back to current profile weight made progress read ~0% forever.
          const { data: gsProfile } = await supabaseAdmin
            .from('profiles').select('weight_kg').eq('id', userId).maybeSingle();
          const startWeight = (gsProfile?.weight_kg as number | null) ?? null;
          const weeklyRate = (hasWeightTarget && targetVal && startWeight && targetWeeks > 0)
            ? Math.round((Math.abs(startWeight - targetVal) / targetWeeks) * 100) / 100
            : null;

          // Single-active-goal invariant (migration 033): deactivate current goal first.
          await supabaseAdmin.from('goals').update({ is_active: false }).eq('user_id', userId).eq('is_active', true);
          const { error: gsErr } = await supabaseAdmin.from('goals').insert({
            user_id: userId,
            goal_type: gType,
            target_weight_kg: hasWeightTarget ? targetVal : null,
            target_weeks: targetWeeks,
            start_weight_kg: startWeight,
            ...(weeklyRate ? { weekly_rate: weeklyRate } : {}),
            is_active: true,
            created_at: new Date().toISOString(),
          });
          if (gsErr) {
            console.error('[goal_suggestion] insert failed:', gsErr.message);
            feedback.push('Hedef kaydedilemedi, tekrar dene.');
            break;
          }

          feedback.push(`Hedef olusturuldu: ${gType}${targetVal ? ` → ${targetVal}` : ''} (${targetWeeks} hafta).`);
          break;
        }
        default:
          feedback.push(null);
      }
    } catch (err) {
      console.error(`Action failed [${action.type}]:`, (err as Error).message);
      feedback.push(`Kayit basarisiz: ${action.type}`);
    }
  }

  return feedback;
}

/**
 * Spec 5.15: Auto Meal Time Learning
 * Every 7th meal_log for a given meal_type, calculate average time and update ai_summary.learned_meal_times.
 */
async function learnMealTime(userId: string, mealType: string, loggedAt?: string) {
  // Extract current hour:minute
  const now = loggedAt ? new Date(loggedAt) : new Date();
  const currentHour = now.getHours();
  const currentMinute = now.getMinutes();

  // Count how many logs of this meal_type exist
  const { count } = await supabaseAdmin
    .from('meal_logs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('meal_type', mealType)
    .eq('is_deleted', false);

  // Only recalculate every 7th log
  if (!count || count % 7 !== 0) return;

  // Fetch last 7 meal logs of this type to calculate average time
  const { data: recentLogs } = await supabaseAdmin
    .from('meal_logs')
    .select('logged_at')
    .eq('user_id', userId)
    .eq('meal_type', mealType)
    .eq('is_deleted', false)
    .order('logged_at', { ascending: false })
    .limit(7);

  if (!recentLogs || recentLogs.length < 7) return;

  // Calculate average time in minutes from midnight
  let totalMinutes = 0;
  for (const log of recentLogs) {
    const d = new Date(log.logged_at);
    totalMinutes += d.getHours() * 60 + d.getMinutes();
  }
  const avgMinutes = Math.round(totalMinutes / recentLogs.length);
  const avgHour = Math.floor(avgMinutes / 60).toString().padStart(2, '0');
  const avgMin = (avgMinutes % 60).toString().padStart(2, '0');
  const timeStr = `${avgHour}:${avgMin}`;

  // Fetch existing learned_meal_times
  const { data: existing } = await supabaseAdmin
    .from('ai_summary')
    .select('learned_meal_times')
    .eq('user_id', userId)
    .maybeSingle();

  const learnedTimes = (existing?.learned_meal_times as Record<string, string>) ?? {};
  learnedTimes[mealType] = timeStr;

  await supabaseAdmin.from('ai_summary').upsert(
    { user_id: userId, learned_meal_times: learnedTimes, updated_at: new Date().toISOString() },
    { onConflict: 'user_id' }
  );
}

/**
 * Spec 5.34: Caffeine Integration
 * Check if meal items contain caffeine, estimate mg, warn if over 400mg/day or after 15:00.
 */
async function checkCaffeineIntake(
  userId: string,
  items: { name: string; portion: string; calories: number; protein_g: number; carbs_g: number; fat_g: number }[],
  today: string
): Promise<string[]> {
  const caffeineMap: { keywords: string[]; mg: number }[] = [
    { keywords: ['espresso'], mg: 63 },
    { keywords: ['americano', 'latte', 'cappuccino', 'kahve', 'coffee'], mg: 95 },
    { keywords: ['cay', 'tea'], mg: 47 },
    { keywords: ['enerji icecegi', 'enerji', 'red bull', 'monster'], mg: 80 },
    { keywords: ['cola', 'kola'], mg: 35 },
  ];

  let mealCaffeine = 0;
  for (const item of items) {
    const nameLower = item.name.toLowerCase();
    for (const entry of caffeineMap) {
      if (entry.keywords.some(kw => nameLower.includes(kw))) {
        mealCaffeine += entry.mg;
        break; // one match per item
      }
    }
  }

  if (mealCaffeine === 0) return [];

  // Calculate today's total caffeine from all meal_log_items
  const { data: todayLogs } = await supabaseAdmin
    .from('meal_logs')
    .select('id')
    .eq('user_id', userId)
    .eq('logged_for_date', today)
    .eq('is_deleted', false);

  let totalCaffeine = mealCaffeine; // start with current meal
  if (todayLogs && todayLogs.length > 0) {
    const logIds = todayLogs.map((l: { id: string }) => l.id);
    // We need to check previous meals' items for caffeine (excluding the one we just logged)
    const { data: allItems } = await supabaseAdmin
      .from('meal_log_items')
      .select('food_name')
      .in('meal_log_id', logIds);

    if (allItems) {
      for (const existingItem of allItems) {
        const nameLower = (existingItem.food_name as string).toLowerCase();
        for (const entry of caffeineMap) {
          if (entry.keywords.some(kw => nameLower.includes(kw))) {
            totalCaffeine += entry.mg;
            break;
          }
        }
      }
      // We double-counted current meal items since they're already inserted
      // totalCaffeine already includes mealCaffeine, and allItems includes current items
      // so subtract mealCaffeine once (it was counted in both loops)
      // Actually, the current meal's items were already inserted before this runs,
      // so allItems already includes them. We should NOT add mealCaffeine separately.
      totalCaffeine -= mealCaffeine;
    }
  }

  const warnings: string[] = [];
  if (totalCaffeine > 400) {
    warnings.push(`Kafein uyarisi: gunluk limitin (400mg) asildi (toplam: ~${totalCaffeine}mg)`);
  }
  const currentHour = new Date().getHours();
  if (currentHour >= 15) {
    warnings.push('Kafein uyarisi: ogleden sonra kafein uyku kaliteni dusurur');
  }

  // Enhanced: caffeine-sleep correlation from recent data
  if (mealCaffeine > 0) {
    try {
      const twoWeeksAgo = new Date(Date.now() - 14 * 86400000).toISOString().split('T')[0];
      const { data: sleepData } = await supabaseAdmin
        .from('daily_metrics').select('sleep_hours')
        .eq('user_id', userId).gte('date', twoWeeksAgo).not('sleep_hours', 'is', null);
      if (sleepData && sleepData.length >= 7) {
        const avgSleep = sleepData.reduce((s, m) => s + (m.sleep_hours as number), 0) / sleepData.length;
        if (avgSleep < 6 && currentHour >= 14) {
          warnings.push(`Uyku ortaman ${avgSleep.toFixed(1)}sa — kafein azaltmayi dene`);
        }
      }
    } catch { /* non-critical */ }

    // Water adjustment recommendation + actual daily_plans.water_target_liters bump
    if (totalCaffeine >= 200) {
      const additionalLiters = Math.round((totalCaffeine / 100) * 0.15 * 100) / 100;
      if (additionalLiters >= 0.3) {
        // Read today's water target, bump, write back (only bump once per day to avoid stacking)
        const { data: todayPlan } = await supabaseAdmin
          .from('daily_plans')
          .select('id, water_target_liters')
          .eq('user_id', userId)
          .eq('date', today)
          .maybeSingle();
        if (todayPlan) {
          const base = (todayPlan.water_target_liters as number | null) ?? 2.5;
          // Expect a fresh base each morning; if already bumped (>= base+0.25L), don't double-bump
          const { data: caffeineLogged } = await supabaseAdmin
            .from('coaching_messages')
            .select('id')
            .eq('user_id', userId)
            .eq('trigger_type', 'caffeine_water_bump')
            .gte('created_at', `${today}T00:00:00`)
            .limit(1);
          if (!caffeineLogged || caffeineLogged.length === 0) {
            await supabaseAdmin
              .from('daily_plans')
              .update({ water_target_liters: Math.round((base + additionalLiters) * 10) / 10 })
              .eq('id', todayPlan.id);
            await supabaseAdmin.from('coaching_messages').insert({
              user_id: userId,
              trigger_type: 'caffeine_water_bump',
              priority: 'low',
              content: `Kafein icin su hedefi +${additionalLiters}L arttirildi (${base}L → ${Math.round((base + additionalLiters) * 10) / 10}L).`,
            });
            warnings.push(`Kafein yuksek — su hedefini ${Math.round((base + additionalLiters) * 10) / 10}L'ye cikardim.`);
          }
        } else {
          warnings.push(`Kafein icin su hedefine +${additionalLiters}L ekle`);
        }
      }
    }
  }

  return warnings;
}

async function processLayer2Updates(userId: string, updates: Record<string, unknown>) {
  try {
    const { data: existing } = await supabaseAdmin
      .from('ai_summary').select('general_summary, behavioral_patterns, portion_calibration, strength_records, coaching_notes, caffeine_sleep_notes, habit_progress, learned_meal_times, seasonal_notes, alcohol_pattern, social_eating_notes, features_introduced')
      .eq('user_id', userId).maybeSingle();

    const changes: Record<string, unknown> = {};

    if (updates.general_summary_append) {
      const current = (existing?.general_summary as string) ?? '';
      changes.general_summary = current + '\n' + updates.general_summary_append;
    }

    // ─── Memory Lifecycle: Pattern Management ───
    if (updates.new_pattern) {
      const newP = updates.new_pattern as Record<string, unknown>;
      const confidence = (newP.confidence as number) ?? 0.5;

      // Reject low-confidence patterns — store as coaching note instead
      if (confidence < 0.5) {
        const current = (existing?.coaching_notes as string) ?? '';
        const dateStr = new Date().toISOString().split('T')[0];
        changes.coaching_notes = `${current}\n[${dateStr}] Gozlem: ${newP.description ?? ''} (dusuk guven, takip edilecek)`.trim();
      } else {
        const patterns = (existing?.behavioral_patterns as Record<string, unknown>[]) ?? [];

        // Dedup: check if similar pattern already exists
        const existingIdx = patterns.findIndex(p =>
          (p.type as string) === (newP.type as string) &&
          (p.trigger as string) === (newP.trigger as string)
        );

        if (existingIdx >= 0) {
          // Update existing: increment times_observed, refresh last_occurred, update confidence
          const ep = patterns[existingIdx];
          patterns[existingIdx] = {
            ...ep,
            times_observed: ((ep.times_observed as number) ?? 1) + 1,
            last_occurred: new Date().toISOString(),
            confidence: Math.min(1, Math.max(confidence, (ep.confidence as number) ?? 0.5)),
            intervention: (newP.intervention as string) ?? (ep.intervention as string),
            impact: (newP.impact as string) ?? (ep.impact as string) ?? 'medium',
            evidence_count: ((ep.evidence_count as number) ?? 1) + 1,
            status: 'active',
          };
        } else {
          // New pattern: add with lifecycle fields
          patterns.push({
            ...newP,
            first_detected: new Date().toISOString(),
            last_occurred: new Date().toISOString(),
            times_observed: 1,
            evidence_count: 1,
            impact: (newP.impact as string) ?? 'medium',
            status: confidence >= 0.7 ? 'active' : 'candidate',
          });
        }

        // Decay: mark stale patterns as resolved (90+ days without observation)
        const now = Date.now();
        for (const p of patterns) {
          if (p.status !== 'resolved' && p.last_occurred) {
            const daysSince = Math.floor((now - new Date(p.last_occurred as string).getTime()) / 86400000);
            if (daysSince > 90) {
              p.status = 'resolved';
            }
          }
        }

        // Size governance: if too many active patterns, drop lowest-scoring resolved ones
        const MAX_PATTERNS = 20;
        if (patterns.length > MAX_PATTERNS) {
          // Remove resolved patterns first, then lowest confidence candidates
          const resolved = patterns.filter(p => p.status === 'resolved');
          const active = patterns.filter(p => p.status !== 'resolved');
          const kept = [...active];
          if (kept.length < MAX_PATTERNS) {
            // Keep some resolved for reference
            resolved.sort((a, b) => ((b.confidence as number) ?? 0) - ((a.confidence as number) ?? 0));
            kept.push(...resolved.slice(0, MAX_PATTERNS - kept.length));
          }
          changes.behavioral_patterns = kept.slice(0, MAX_PATTERNS);
        } else {
          changes.behavioral_patterns = patterns;
        }
      }
    }

    // ─── Portion calibration with confidence gate + correction count ───
    // Spec 5.23: "user 3+ kez aynı yemeği X gram olarak düzelttiyse, AI sonraki parse'ta X kullanır"
    // New shape: { "pilav": { grams: 200, count: 3, confirmed: true, history: [180, 200, 220] } }
    // Backward-compat: legacy number values read as single-observation estimate.
    if (updates.portion_update) {
      const pu = updates.portion_update as { food: string; user_portion_grams: number; confidence?: number };
      const portionConfidence = pu.confidence ?? 0.7;

      if (portionConfidence >= 0.7) {
        const raw = (existing?.portion_calibration as Record<string, unknown>) ?? {};
        const foodKey = pu.food.toLocaleLowerCase('tr').trim();
        const prior = raw[foodKey];

        type CalEntry = { grams: number; count: number; confirmed: boolean; history: number[] };
        let entry: CalEntry;
        if (typeof prior === 'number') {
          entry = { grams: prior, count: 1, confirmed: false, history: [prior] };
        } else if (prior && typeof prior === 'object') {
          const p = prior as Partial<CalEntry>;
          entry = {
            grams: p.grams ?? pu.user_portion_grams,
            count: p.count ?? 1,
            confirmed: p.confirmed ?? false,
            history: Array.isArray(p.history) ? p.history : [],
          };
        } else {
          entry = { grams: pu.user_portion_grams, count: 0, confirmed: false, history: [] };
        }

        // Append the new observation and recompute avg over last 5
        const nextHistory = [...entry.history, pu.user_portion_grams].slice(-5);
        const avg = Math.round(nextHistory.reduce((s, v) => s + v, 0) / nextHistory.length);
        entry = {
          grams: avg,
          count: entry.count + 1,
          confirmed: entry.count + 1 >= 3,
          history: nextHistory,
        };

        raw[foodKey] = entry;
        changes.portion_calibration = raw;
      }
    }

    if (updates.strength_update) {
      const su = updates.strength_update as { exercise: string; weight_kg: number; reps: number };
      const records = (existing?.strength_records as Record<string, unknown>) ?? {};
      records[su.exercise] = { last_weight: su.weight_kg, last_reps: su.reps };
      changes.strength_records = records;
    }

    if (updates.coaching_note) {
      const current = (existing?.coaching_notes as string) ?? '';
      const dateStr = new Date().toISOString().split('T')[0];
      changes.coaching_notes = `${current}\n[${dateStr}] ${updates.coaching_note}`.trim();
    }

    // KVKK Md.16-17 (Spec 2.3): user-requested deletion/correction of L2 notes.
    // The schema was append-only before — the model SAID "sildim" while nothing
    // could actually remove a line.
    if (typeof updates.remove_coaching_note === 'string' && updates.remove_coaching_note.trim().length >= 3) {
      const needle = (updates.remove_coaching_note as string).toLocaleLowerCase('tr').trim();
      const base = (changes.coaching_notes as string | undefined) ?? (existing?.coaching_notes as string) ?? '';
      const kept = base.split('\n').filter(line => !line.toLocaleLowerCase('tr').includes(needle));
      changes.coaching_notes = kept.join('\n').trim();
    }

    if (updates.resolve_pattern && typeof updates.resolve_pattern === 'object') {
      const rp = updates.resolve_pattern as { type?: string; trigger?: string };
      const patterns = ((changes.behavioral_patterns as Record<string, unknown>[] | undefined)
        ?? (existing?.behavioral_patterns as Record<string, unknown>[] | null)
        ?? []);
      let resolvedAny = false;
      const nextPatterns = patterns.map(p => {
        const typeMatch = rp.type && (p.type as string)?.toLocaleLowerCase('tr').includes(rp.type.toLocaleLowerCase('tr'));
        const trigMatch = rp.trigger && (p.trigger as string)?.toLocaleLowerCase('tr').includes(rp.trigger.toLocaleLowerCase('tr'));
        if (typeMatch || trigMatch) {
          resolvedAny = true;
          return { ...p, status: 'resolved', resolved_at: new Date().toISOString(), resolved_reason: 'user_correction' };
        }
        return p;
      });
      if (resolvedAny) changes.behavioral_patterns = nextPatterns;
    }

    // Spec 5.15: User persona (override)
    if (updates.user_persona) {
      changes.user_persona = updates.user_persona;
    }

    // Spec 5.9: Learned tone preference (override)
    if (updates.learned_tone_preference) {
      changes.learned_tone_preference = updates.learned_tone_preference;
    }

    // Spec 5.31: Nutrition literacy (override)
    if (updates.nutrition_literacy) {
      changes.nutrition_literacy = updates.nutrition_literacy;
    }

    // Spec 5.15: Learned meal times (merge)
    if (updates.learned_meal_times) {
      const existingTimes = (existing?.learned_meal_times as Record<string, string>) ?? {};
      const newTimes = updates.learned_meal_times as Record<string, string>;
      changes.learned_meal_times = { ...existingTimes, ...newTimes };
    }

    // Spec 5.34: Caffeine-sleep notes
    if (updates.caffeine_note) {
      const current = (existing?.caffeine_sleep_notes as string) ?? '';
      changes.caffeine_sleep_notes = current ? `${current}\n${updates.caffeine_note}` : (updates.caffeine_note as string);
    }

    // Spec 5.35: Habit updates (merge)
    if (updates.habit_update) {
      const habits = (existing?.habit_progress as { habit: string; status: string; streak: number }[]) ?? [];
      const hu = updates.habit_update as { habit: string; status: string; streak: number };
      const idx = habits.findIndex(h => h.habit === hu.habit);
      if (idx >= 0) {
        habits[idx] = { ...habits[idx], ...hu };
      } else {
        habits.push(hu);
      }
      changes.habit_progress = habits;
    }

    // A1/A2: alcohol_pattern + social_eating_note are written to their DEDICATED
    // columns below (A1/A2 structured blocks), which buildLayer2/context-builders
    // read. The old coaching_notes duplication here double-wrote the same info
    // (#R2-14) — removed so each signal has one home.

    // A3: Features introduced tracking (Spec 15 — progressive disclosure)
    if (updates.features_introduced) {
      const existing_features = (existing as Record<string, unknown>)?.features_introduced as string[] ?? [];
      const new_features = Array.isArray(updates.features_introduced) ? updates.features_introduced as string[] : [updates.features_introduced as string];
      const merged = [...new Set([...existing_features, ...new_features])];
      changes.features_introduced = merged;
    }

    // Seasonal/periodic note (Spec 9.3)
    if (updates.seasonal_note) {
      const current = (existing?.seasonal_notes as string) ?? '';
      const dateStr = new Date().toISOString().split('T')[0];
      changes.seasonal_notes = `${current}\n[${dateStr}] ${updates.seasonal_note}`.trim();
    }

    // A1: Alcohol pattern. The column is TEXT (read via ->>'alcohol_pattern' and in
    // buildLayer2), so write a clean human-readable STRING — NOT an object, which
    // would be stored as raw JSON and need parse-back everywhere (#R2-13/#R2-14).
    if (updates.alcohol_pattern) {
      if (typeof updates.alcohol_pattern === 'object') {
        const o = updates.alcohol_pattern as { pattern?: string; frequency?: string; impact?: string };
        changes.alcohol_pattern = [
          o.pattern,
          o.frequency && o.frequency !== 'bilinmiyor' && `Siklik: ${o.frequency}`,
          o.impact && o.impact !== 'bilinmiyor' && `Etki: ${o.impact}`,
        ].filter(Boolean).join(' | ') || (o.pattern ?? '');
      } else {
        changes.alcohol_pattern = updates.alcohol_pattern as string;
      }
    }

    // A2: Social eating note — append date-stamped notes
    if (updates.social_eating_note) {
      const current = (existing?.social_eating_notes as string) ?? '';
      const dateStr = new Date().toISOString().split('T')[0];
      changes.social_eating_notes = `${current}\n[${dateStr}] ${updates.social_eating_note}`.trim();
    }

    // A3: Feature introduced — track to prevent re-introducing
    if (updates.feature_introduced) {
      const current = (existing?.features_introduced as string[]) ?? [];
      const newFeature = updates.feature_introduced as string;
      if (!current.includes(newFeature)) {
        changes.features_introduced = [...current, newFeature];
      }
    }

    // Onboarding task completion — intentionally NOT handled here.
    // MASTER_PLAN §4.1: task completion is validated server-side in the main
    // request handler against the task's actual required fields before
    // being written. This block previously wrote the key unvalidated, which
    // caused false positives (card cleared from dashboard even when data
    // wasn't actually persisted). The validated path is now authoritative.
    // The field is read from layer2Updates in the main handler (see
    // `claimedTaskKey` around index.ts:440).

    if (Object.keys(changes).length > 0) {
      await updateLayer2(userId, changes);
      console.log(`[Layer2] Updated fields: ${Object.keys(changes).join(', ')}`);
    }
  } catch (err) {
    console.error('[Layer2] processLayer2Updates failed:', (err as Error).message);
  }
}

// Calorie factor by goal DIRECTION — MUST mirror src/lib/tdee.ts calculateTargets so the
// chat-path TDEE doesn't diverge from onboarding. Sustainable defaults: deficit for weight
// loss, surplus for gain/muscle, maintenance (=TDEE) for maintain/health/conditioning.
// (Bug fix: both TDEE paths previously hardcoded *0.85 for EVERYONE → bulking/maintain users
// were silently put into a weight-loss deficit, ~670 kcal/day in the wrong direction.)
function goalCalorieFactor(goalType: string | null | undefined): number {
  if (goalType === 'lose_weight') return 0.85;
  if (goalType === 'gain_weight' || goalType === 'gain_muscle') return 1.10;
  return 1.0; // maintain / health / conditioning / unknown
}

async function checkOnboardingCompletion(userId: string) {
  const { data } = await supabaseAdmin
    .from('profiles')
    .select('height_cm, weight_kg, birth_year, gender, activity_level, onboarding_completed')
    .eq('id', userId).maybeSingle();

  if (data && !data.onboarding_completed && data.height_cm && data.weight_kg && data.birth_year && data.gender) {
    // Calculate TDEE and save targets (Spec 2.4, T1.18)
    const age = new Date().getFullYear() - data.birth_year;
    const base = 10 * data.weight_kg + 6.25 * data.height_cm - 5 * age;
    const bmr = data.gender === 'male' ? base + 5 : base - 161;
    const multipliers: Record<string, number> = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9 };
    const tdee = Math.round(bmr * (multipliers[data.activity_level ?? 'moderate'] ?? 1.55));

    // Goal-aware target (profiles has no goal_type — read the active goal row).
    const { data: goalRow } = await supabaseAdmin.from('goals').select('goal_type').eq('user_id', userId).eq('is_active', true).limit(1).maybeSingle();
    const targetCal = Math.round(tdee * goalCalorieFactor(goalRow?.goal_type as string | undefined));
    const rangeWidth = Math.round(targetCal * 0.10);
    const trainingMin = Math.max(targetCal - Math.round(rangeWidth / 2), data.gender === 'female' ? 1200 : 1400);
    const trainingMax = targetCal + Math.round(rangeWidth / 2);
    const restMin = Math.max(trainingMin - 250, data.gender === 'female' ? 1200 : 1400);
    const restMax = trainingMax - 250;
    // The 1200/1400 floor lifts the MINs but not the maxes, so a low-TDEE user
    // (small/older/female/sedentary) could get restMin > restMax — an inverted
    // range that corrupts the weekly budget. Clamp each max up to its min, like
    // src/lib/tdee.ts calculateTargets does (#R4-2).
    const safeTrainingMax = Math.max(trainingMax, trainingMin);
    const safeRestMax = Math.max(restMax, restMin);
    const waterTarget = Math.round(data.weight_kg * 0.033 * 10) / 10;
    const weeklyBudget = 4 * Math.round((trainingMin + safeTrainingMax) / 2) + 3 * Math.round((restMin + safeRestMax) / 2);

    // NOTE: protein_target_g is NOT a profiles column (it lives on daily_plans);
    // protein intensity is captured by protein_per_kg. Macro split columns are
    // macro_protein_pct/macro_carb_pct/macro_fat_pct (001:77-79), not macro_pct_*.
    const { error } = await supabaseAdmin.from('profiles').update({
      onboarding_completed: true,
      tdee_calculated: tdee,
      tdee_last_weight: data.weight_kg,
      tdee_last_date: new Date().toISOString().split('T')[0],
      calorie_range_training_min: trainingMin,
      calorie_range_training_max: safeTrainingMax,
      calorie_range_rest_min: restMin,
      calorie_range_rest_max: safeRestMax,
      protein_per_kg: 1.8,
      water_target_liters: waterTarget,
      weekly_calorie_budget: weeklyBudget,
      macro_protein_pct: 30,
      macro_carb_pct: 40,
      macro_fat_pct: 30,
      updated_at: new Date().toISOString(),
    }).eq('id', userId);
    if (error) console.error('[Onboarding] completion update failed:', error.message);
  }
}

/**
 * T1.19: Recalculate TDEE when significant weight change detected.
 * Spec 2.4: Triggers on 2.5+ kg change or 30+ days since last calc.
 */
async function recalculateTDEEIfNeeded(userId: string, currentWeight: number, force = false) {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('height_cm, birth_year, gender, activity_level, tdee_last_weight, tdee_last_date, maintenance_mode, periodic_state')
    .eq('id', userId).maybeSingle();

  if (!profile?.height_cm || !profile?.birth_year || !profile?.gender) return;

  // In maintenance/reverse-diet, ai-proactive OWNS calorie_range_rest_* and
  // weekly_calorie_budget (it ramps them +125 kcal/week). A weight-log recalc must
  // NOT overwrite those with the deficit formula — that erases the ramp (#13). We
  // still refresh the BMR/TDEE baseline + protein/water so they don't go stale.
  const inMaintenance = profile.maintenance_mode === true || profile.periodic_state === 'maintenance';

  const lastWeight = profile.tdee_last_weight as number | null;
  const lastDate = profile.tdee_last_date as string | null;

  // Check if recalculation needed
  let needed = false;
  if (!lastWeight || !lastDate) { needed = true; }
  else if (Math.abs(currentWeight - lastWeight) >= 2.5) { needed = true; }
  else {
    const daysSince = Math.floor((Date.now() - new Date(lastDate).getTime()) / 86400000);
    if (daysSince > 30) needed = true;
  }

  if (!needed && !force) return;

  const age = new Date().getFullYear() - profile.birth_year;
  const base = 10 * currentWeight + 6.25 * profile.height_cm - 5 * age;
  const bmr = profile.gender === 'male' ? base + 5 : base - 161;
  const multipliers: Record<string, number> = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9 };
  const tdee = Math.round(bmr * (multipliers[profile.activity_level ?? 'moderate'] ?? 1.55));

  // Goal-aware target (don't diet a bulking/maintain user on a weight-change recalc).
  const { data: goalRow } = await supabaseAdmin.from('goals').select('goal_type').eq('user_id', userId).eq('is_active', true).limit(1).maybeSingle();
  const targetCal = Math.round(tdee * goalCalorieFactor(goalRow?.goal_type as string | undefined));
  const rangeWidth = Math.round(targetCal * 0.10);
  const trainingMin = Math.max(targetCal - Math.round(rangeWidth / 2), profile.gender === 'female' ? 1200 : 1400);
  const trainingMax = targetCal + Math.round(rangeWidth / 2);
  const restMin = Math.max(trainingMin - 250, profile.gender === 'female' ? 1200 : 1400);
  const restMax = trainingMax - 250;
  // Clamp maxes up to floored mins so a low-TDEE user doesn't get restMin > restMax (#R4-3).
  const safeTrainingMax = Math.max(trainingMax, trainingMin);
  const safeRestMax = Math.max(restMax, restMin);
  const proteinG = Math.round(currentWeight * 1.8);
  const waterTarget = Math.round(currentWeight * 0.033 * 10) / 10;
  const weeklyBudget = 4 * Math.round((trainingMin + safeTrainingMax) / 2) + 3 * Math.round((restMin + safeRestMax) / 2);

  // protein_target_g is not a profiles column (it lives on daily_plans); record
  // protein intent via protein_per_kg (proteinG above derives from this 1.8 factor).
  const profileUpdate: Record<string, unknown> = {
    tdee_calculated: tdee,
    tdee_last_weight: currentWeight,
    tdee_last_date: new Date().toISOString().split('T')[0],
    protein_per_kg: 1.8,
    water_target_liters: waterTarget,
    updated_at: new Date().toISOString(),
  };
  if (!inMaintenance) {
    // Only the non-maintenance path may rewrite the calorie ranges / weekly budget.
    profileUpdate.calorie_range_training_min = trainingMin;
    profileUpdate.calorie_range_training_max = safeTrainingMax;
    profileUpdate.calorie_range_rest_min = restMin;
    profileUpdate.calorie_range_rest_max = safeRestMax;
    profileUpdate.weekly_calorie_budget = weeklyBudget;
  }
  await supabaseAdmin.from('profiles').update(profileUpdate).eq('id', userId);

  // #10: write the previously-dead Layer-2 tdee_notes signal (spec 5.1) so buildLayer2
  // surfaces a real value instead of an empty field.
  await supabaseAdmin.rpc('ai_summary_merge', {
    p_user_id: userId,
    p_patch: { tdee_notes: `Son TDEE ${tdee} kcal @ ${currentWeight.toFixed(1)}kg (${new Date().toISOString().split('T')[0]})` },
  }).then(() => {}, () => {});

  // Notify user so they know targets shifted
  const reason = lastWeight
    ? `Kilon ${lastWeight.toFixed(1)} → ${currentWeight.toFixed(1)}kg degisti`
    : 'İlk TDEE hesaplamasi';
  const content = inMaintenance
    // In maintenance we deliberately didn't touch the ranges (ramp owns them).
    ? `${reason}. Yeni TDEE ${tdee} kcal, protein ${proteinG}g, su ${waterTarget}L. (Bakım dönemi: kalori aralığın korunuyor.)`
    : `${reason}. Yeni TDEE ${tdee} kcal, kalori araligi ${restMin}-${trainingMax} kcal, protein ${proteinG}g, su ${waterTarget}L.`;
  await supabaseAdmin.from('coaching_messages').insert({
    user_id: userId,
    trigger_type: 'tdee_recalculated',
    priority: 'low',
    content,
  }).then(() => {}, () => {});
}
