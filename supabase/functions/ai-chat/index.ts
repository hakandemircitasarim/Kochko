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
import { sanitizeText, detectEmergency, detectEDRisk, checkAllergens, sanitizeUserInput } from '../shared/guardrails.ts';
import { validateMealParse } from '../shared/output-validator.ts';
import { checkRateLimit } from '../shared/rate-limit.ts';
import { validateChatRequest, checkPayloadSize } from '../shared/request-validator.ts';
import { analyzeMessage, getRetrievalPlan } from '../shared/retrieval-planner.ts';
import { buildContextFromPlan } from '../shared/context-builders.ts';
import { selectModel } from '../shared/model-router.ts';
import { BASE_SYSTEM_PROMPT, buildConfidenceNote } from './system-prompt.ts';
import { detectTaskMode, getModeInstructions } from './task-modes.ts';
import {
  detectRepairIntent, handleUndo, buildCorrectionContext,
  shouldDetectPersona, buildPersonaDetectionPrompt, getMessageCount,
  getToneContext, buildKnowledgeSummary, getRepairContext,
} from '../shared/repair-handler.ts';
import { getAllServiceContexts, checkHabitFromChat } from '../shared/service-contexts.ts';

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

    // Prompt injection detection (Spec 5.26)
    let injectionDetected = false;
    if (message) {
      const injection = sanitizeUserInput(message);
      injectionDetected = injection.injectionDetected;
      if (injectionDetected) {
        const rejectMsg = 'Ben Kochko, beslenme ve antrenman kocunum. Bu konuda sana yardimci olamam ama beslenme veya sporla ilgili sorun varsa konusalim.';
        await storeMessages(userId, message, rejectMsg);
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

    // Emergency detection (Spec 5.5)
    if (message) {
      const emergency = detectEmergency(message);
      if (emergency.isEmergency) {
        await storeMessages(userId, message, emergency.message);
        return respond({ message: emergency.message, actions: [], task_mode: 'emergency' });
      }
    }

    // Eating disorder risk detection (Spec 12.5)
    if (message) {
      const edRisk = detectEDRisk(message);
      if (edRisk.isRisk && edRisk.severity === 'high') {
        await storeMessages(userId, message, edRisk.message);
        return respond({ message: edRisk.message, actions: [], task_mode: 'safety' });
      }
      // Medium severity: continue normal flow but AI will see ED_REFERRAL in sanitized output
    }

    // Repair intent detection — BEFORE task mode (Spec 5.32)
    if (message) {
      const repairIntent = detectRepairIntent(message);

      // Handle direct undo requests
      if (repairIntent.type === 'undo') {
        const undoResult = await handleUndo(userId);
        await storeMessages(userId, message, undoResult.response ?? '');
        return respond({ message: undoResult.response, actions: [], task_mode: 'repair' });
      }

      // "Benim hakkımda ne biliyorsun?" handler (Spec 5.18)
      const knowledgePatterns = /benim hakkimda|beni tan[iı]|ne [oö]grendin|ne biliyorsun|beni ne kadar/i;
      if (knowledgePatterns.test(message)) {
        const summary = await buildKnowledgeSummary(userId);
        await storeMessages(userId, message, summary);
        return respond({ message: summary, actions: [], task_mode: 'knowledge' });
      }
    }

    // Check onboarding status
    const { data: profile } = await supabaseAdmin
      .from('profiles').select('onboarding_completed, gender, calorie_range_rest_min, calorie_range_rest_max, calorie_range_training_min, calorie_range_training_max, protein_per_kg, weight_kg')
      .eq('id', userId).maybeSingle();
    const isOnboarding = !profile?.onboarding_completed;

    // Return-flow detection is now handled by service-contexts.ts (richer context with weight, compliance history)

    // Detect task mode (Spec 5.2)
    const taskMode = detectTaskMode(message ?? '', isOnboarding);

    // Analyze message for subtype + risk + retrieval needs (Retrieval Planner v2)
    const analysis = analyzeMessage(message ?? '', taskMode);
    const retrievalPlan = getRetrievalPlan(analysis);

    // Build scoped context based on retrieval plan
    const ctx = await buildContextFromPlan(userId, retrievalPlan, session_id);

    // Assemble system prompt = base + mode instructions + confidence note + persona/tone/repair context
    const modeInstructions = getModeInstructions(taskMode);
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
        const tokens = cleaned.split(/\s+/).filter(t => t.length >= 3).slice(0, 8);

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
              const matched = names.filter(n => tokens.some(t => n.includes(t) || t.includes(n.split(' ')[0] ?? '')));
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
        const todayStr = new Date().toISOString().split('T')[0];
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
      serviceCtx.habits.prompt,        // 1. Habits (active, mastered, streaks, compliance %)
      serviceCtx.progressiveDisclosure,// 2. Progressive disclosure (features to introduce)
      serviceCtx.recovery,             // 3. Recovery (only in recovery mode)
      serviceCtx.eatingOut,            // 5. Eating out (only in eating_out mode)
      serviceCtx.mvd,                  // 6. MVD (only in mvd mode)
      serviceCtx.predictiveRisk.prompt,// 7. Predictive risk alerts
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
    const modelSelection = selectModel(analysis, !!image_base64);
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

    // Regex fallback: always run, even when AI emitted actions, to fill in fields
    // the model might have skipped (target_weight_kg, goal_type, motivation_source
    // are the common misses). Existing action fields take precedence.
    if (message) {
      const regexExtracted = extractProfileFromMessage(message, task_mode_hint as string | undefined);
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

    // Extract Layer 2 updates
    const { cleanMessage: finalMessage, layer2Updates } = extractLayer2Updates(assistantMessage);
    assistantMessage = finalMessage;

    // Plan snapshot + reasoning extraction (MASTER_PLAN §4.4, Phase 2/3).
    // AI in plan_diet/plan_workout modes re-emits a full snapshot every turn.
    // Server persists the snapshot to the current draft row.
    const { cleanMessage: afterSnapshot, snapshot: planSnapshot, parseError: snapshotParseError } = extractPlanSnapshot(assistantMessage);
    assistantMessage = afterSnapshot;
    const { cleanMessage: afterReasoning, reasoning: planReasoning } = extractReasoning(assistantMessage);
    assistantMessage = afterReasoning;

    // <navigate_to> — route hint for daily_log chats (Phase 5).
    const { cleanMessage: afterNav, navigateTo } = extractNavigateTo(assistantMessage);
    assistantMessage = afterNav;

    let persistedPlan: Record<string, unknown> | null = null;
    let planPersistError: string | null = null;
    if (planSnapshot && (task_mode_hint === 'plan_diet' || task_mode_hint === 'plan_workout')) {
      const expectedType = task_mode_hint === 'plan_diet' ? 'diet' : 'workout';
      if (planSnapshot.plan_type === expectedType) {
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
              week_start: (planSnapshot.week_start as string) || new Date().toISOString().split('T')[0],
              plan_data: { ...planSnapshot, version: 1 },
              user_revisions: [],
            })
            .select('id, plan_data')
            .limit(1);
          if (error) planPersistError = error.message;
          else persistedPlan = (inserted?.[0] as { plan_data: Record<string, unknown> })?.plan_data ?? null;
        }
      } else {
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
      const { data: draftRow } = await supabaseAdmin
        .from('weekly_plans')
        .select('id')
        .eq('user_id', userId)
        .eq('plan_type', expectedType)
        .eq('status', 'draft')
        .limit(1);
      const draft = draftRow?.[0];
      if (draft) {
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

    // Execute actions (use target_date for batch entry, T1.17)
    // Source of log: photo > voice (transcribed) > default text/chat
    const inputSource: 'photo' | 'voice' | 'ai_chat' = image_base64 ? 'photo' : audio_base64 ? 'voice' : 'ai_chat';
    const actionFeedback = await executeActions(userId, actions, profile?.gender, target_date, inputSource);

    // A8: Low confidence proactive verification — append confirmation question
    const mealActions = actions.filter((a: { type: string }) => a.type === 'meal_log');
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
              const todayStr = new Date().toISOString().split('T')[0];
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

    // Async: check onboarding completion
    if (isOnboarding && actions.some((a: { type: string }) => a.type === 'profile_update')) {
      checkOnboardingCompletion(userId).catch(() => {});
    }

    const outActions = actions.map((a: { type: string }, i: number) => ({
      type: a.type,
      feedback: actionFeedback[i] ?? null,
    }));
    if (personaJustDetected) {
      outActions.push({
        type: 'persona_detected',
        feedback: personaJustDetected,
      });
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
      navigate_to: navigateTo,
    });
  } catch (err) {
    return respond({ error: (err as Error).message }, 500);
  }
});

// --- Helper Functions ---

function respond(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
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
  const patterns: RegExp[] = [
    // "Hedef kilonu kaydettim.", "Boyunu kaydettim." (X'ini/ni/nu/u kaydettim)
    /(?:^|(?<=[.!?\n]\s*))[A-Za-zÇĞİÖŞÜçğıöşü][^.!?\n]*?kaydett(?:i|i[mk]|ik)\.?\s*/gi,
    // "Aktivite seviyeni öğrendim.", "Yaşını öğrendim, teşekkürler."
    /(?:^|(?<=[.!?\n]\s*))[A-Za-zÇĞİÖŞÜçğıöşü][^.!?\n]*?öğren(?:di|dim|dik)[^.!?\n]*?(?:\.|,\s*teşekkür[^.!?\n]*?\.)\s*/gi,
    // "Profilini güncelledim."
    /(?:^|(?<=[.!?\n]\s*))[^.!?\n]*?profili[^.!?\n]*?güncell[^.!?\n]*?\.\s*/gi,
    // "Not aldım.", "Not ettim."
    /(?:^|(?<=[.!?\n]\s*))[^.!?\n]*?not\s*(?:aldı[mk]|etti[mk])[^.!?\n]*?\.\s*/gi,
    // "Hedefini anladım."
    /(?:^|(?<=[.!?\n]\s*))[^.!?\n]*?anladı[mk][^.!?\n]*?\.\s*/gi,
    // "Bilgilerini aldım."
    /(?:^|(?<=[.!?\n]\s*))[^.!?\n]*?bilgi(?:leri|ni)[^.!?\n]*?aldı[mk][^.!?\n]*?\.\s*/gi,
  ];
  let out = text;
  for (const p of patterns) out = out.replace(p, '');
  // Collapse excessive whitespace left by removals.
  return out.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

function extractProfileFromMessage(msg: string, taskModeHint?: string): Record<string, unknown> | null {
  const result: Record<string, unknown> = {};
  const lower = msg.toLocaleLowerCase('tr');

  // Context-aware: in the "Hedefini belirle" chat, a bare number reply (30-300)
  // is almost always the target weight — the AI just asked "hedeflediğin kilo?"
  // and the user shorthand-answers. Without this, regex below requires the
  // "hedef" keyword and misses the most common phrasing.
  if (taskModeHint === 'onboarding_goal') {
    const bare = msg.trim();
    if (/^\d{2,3}(?:[.,]\d)?$/.test(bare)) {
      const n = parseFloat(bare.replace(',', '.'));
      if (n >= 30 && n <= 300) result.target_weight_kg = n;
    }
  }

  // Height: "boyum 175", "175 cm", "boy: 180"
  const heightMatch = lower.match(/boy\w*\s*[:=]?\s*(\d{2,3})\s*(cm)?|(\d{2,3})\s*cm/);
  if (heightMatch) {
    const h = parseInt(heightMatch[1] ?? heightMatch[3]);
    if (h >= 100 && h <= 250) result.height_cm = h;
  }

  // Target weight: "hedef kilo 90", "hedef kilom 90", "90 kg hedef" — checked BEFORE
  // plain weight so "hedef kilo 100" isn't misread as current weight.
  const targetMatch = lower.match(/hedef\s*kilo\w*\s*[:=]?\s*(\d{2,3}(?:\.\d)?)|(\d{2,3}(?:\.\d)?)\s*(kg|kilo)\s*hedef/);
  if (targetMatch) {
    const t = parseFloat(targetMatch[1] ?? targetMatch[2]);
    if (t >= 30 && t <= 300) result.target_weight_kg = t;
  }

  // Current weight: "kilom 72", "72 kg", "72 kiloyum" — but not if we just matched it as target.
  // Prefer "mevcut kilo X" disambiguation when both appear in the same line.
  const currentMatch = lower.match(/mevcut\s*kilo\w*\s*[:=]?\s*(\d{2,3}(?:\.\d)?)|kilo\w*\s*[:=]?\s*(\d{2,3}(?:\.\d)?)|(\d{2,3}(?:\.\d)?)\s*(kg|kilo)/);
  if (currentMatch) {
    const w = parseFloat(currentMatch[1] ?? currentMatch[2] ?? currentMatch[3]);
    // Skip if the value matches the target we already extracted, to avoid
    // double-assigning a single number to both fields.
    if (w >= 30 && w <= 300 && result.target_weight_kg !== w) result.weight_kg = w;
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

  // Gender
  if (/erkek|male/.test(lower)) result.gender = 'male';
  else if (/kadin|kadın|female/.test(lower)) result.gender = 'female';

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
  const motivationBits: string[] = [];
  if (/sagl[iı]k/.test(lower)) motivationBits.push('saglik');
  if (/gor[uü]n[uü]m|iyi\s*g[oö]z[uü]k/.test(lower)) motivationBits.push('gorunum');
  if (/enerj/.test(lower)) motivationBits.push('enerji');
  if (/ozguven|özgüven|kendime\s*g[uü]ven/.test(lower)) motivationBits.push('ozguven');
  if (motivationBits.length > 0) result.motivation_source = motivationBits.join('_');

  return Object.keys(result).length > 0 ? result : null;
}

/**
 * Plan snapshot parser — MASTER_PLAN §4.4.
 * Every plan chat turn is expected to re-emit the FULL plan, not a patch.
 * This extracts it, strips the tag from the displayed message, and returns
 * the parsed object so the caller can persist it via plan.service.applySnapshot.
 */
function extractPlanSnapshot(text: string): { cleanMessage: string; snapshot: Record<string, unknown> | null; parseError?: string } {
  const match = text.match(/<plan_snapshot>([\s\S]*?)<\/plan_snapshot>/);
  if (!match) return { cleanMessage: text, snapshot: null };
  let parsed: Record<string, unknown> | null = null;
  let parseError: string | undefined;
  try {
    parsed = JSON.parse(match[1]) as Record<string, unknown>;
  } catch (e) {
    parseError = (e as Error).message;
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
const VALID_NAVIGATE_ROUTES = new Set([
  '/plan/diet', '/plan/workout', '/(tabs)/index', '/(tabs)/chat', '/(tabs)/profile',
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
  // Use provided session_id if valid, otherwise get/create active session
  let sessionId: string | null = null;

  if (externalSessionId) {
    // Verify it belongs to this user
    const { data: existing } = await supabaseAdmin
      .from('chat_sessions')
      .select('id')
      .eq('id', externalSessionId)
      .eq('user_id', userId)
      .maybeSingle();
    if (existing) sessionId = existing.id;
  }

  if (!sessionId) {
    let { data: session } = await supabaseAdmin
      .from('chat_sessions')
      .select('id')
      .eq('user_id', userId)
      .eq('is_active', true)
      .maybeSingle();

    if (!session) {
      const { data: newSession } = await supabaseAdmin
        .from('chat_sessions')
        .insert({ user_id: userId, is_active: true })
        .select('id')
        .maybeSingle();
      session = newSession;
    }
    sessionId = session?.id ?? null;
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

  // Get existing water for today
  const { data: todayMetrics } = await supabaseAdmin
    .from('daily_metrics').select('water_liters').eq('user_id', userId).eq('date', today).maybeSingle();
  const existingWater = todayMetrics?.water_liters ?? 0;

  for (const action of actions) {
    try {
      switch (action.type) {
        case 'meal_log': {
          const items = action.items as { name: string; portion: string; calories: number; protein_g: number; carbs_g: number; fat_g: number; confidence?: number }[] | undefined;
          const mealType = action.meal_type as string ?? 'snack';

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
                feedback.push(`⚠️ ALERJEN UYARISI: ${warns.join(', ')} — yine de kaydedildi`);
              }
            }
          }

          const { data: log } = await supabaseAdmin.from('meal_logs').insert({
            user_id: userId, raw_input: action.raw as string ?? '',
            meal_type: mealType,
            input_method: inputMethod,
            confidence: mealConfidence,
            logged_for_date: today, synced: true,
          }).select('id').maybeSingle();

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

            await supabaseAdmin.from('meal_log_items').insert(
              items.map(i => ({
                meal_log_id: log.id, food_name: i.name, portion_text: i.portion,
                calories: Math.max(0, Math.round(i.calories * multiplier)),
                protein_g: Math.max(0, i.protein_g), carbs_g: Math.max(0, i.carbs_g),
                fat_g: Math.max(0, Math.round(i.fat_g * multiplier)),
                data_source: 'ai_estimate',
                cooking_method: cookingMethod,
              }))
            );
          }

          // --- Auto Meal Time Learning (Spec 5.15) ---
          learnMealTime(userId, mealType, action.logged_at as string | undefined).catch(() => {});

          // --- Caffeine Integration (Spec 5.34) ---
          if (items?.length) {
            const caffeineFeedback = await checkCaffeineIntake(userId, items, today);
            if (caffeineFeedback.length > 0) {
              feedback.push('Ogun kaydedildi');
              for (const cf of caffeineFeedback) feedback.push(cf);
              break;
            }
          }

          // A8: Low confidence proactive verification
          // NOTE: assistantMessage is not in scope here; pass via closure via the outer variable.
          // We check the action's items for suspicious calorie totals.
          if (items?.length) {
            const totalMealCal = items.reduce((s, i) => s + (i.calories ?? 0), 0);
            if (totalMealCal > 1500 || (totalMealCal > 0 && totalMealCal < 50)) {
              feedback.push('NOT: Dusuk guvenli tahmin — kullanicidan dogrulama iste.');
            }
          }

          feedback.push('Ogun kaydedildi');
          break;
        }
        case 'workout_log': {
          const durationMin = (action.duration_min as number) ?? 0;
          const intensity = (action.intensity as string) ?? 'moderate';
          const workoutType = (action.workout_type as string) ?? 'mixed';

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

          await supabaseAdmin.from('workout_logs').insert({
            user_id: userId, raw_input: action.raw as string ?? '',
            workout_type: workoutType,
            duration_min: durationMin,
            intensity,
            calories_burned: caloriesBurned,
            logged_for_date: today, synced: true,
          });

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

            feedback.push(`Antrenman kaydedildi (~${caloriesBurned} kcal yakim). Bugun icin +${bump} kcal hareket alani acildi.`);
          } else {
            feedback.push('Antrenman kaydedildi');
          }
          break;
        }
        case 'weight_log': {
          const w = action.value as number;
          if (w > 20 && w < 300) {
            await supabaseAdmin.from('daily_metrics').upsert(
              { user_id: userId, date: today, weight_kg: w, water_liters: existingWater, synced: true },
              { onConflict: 'user_id,date' }
            );
            await supabaseAdmin.from('profiles').update({ weight_kg: w, updated_at: new Date().toISOString() }).eq('id', userId);
            // T1.19: Check if TDEE recalculation needed
            recalculateTDEEIfNeeded(userId, w).catch(() => {});

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
          }
          break;
        }
        case 'water_log': {
          const l = action.liters as number;
          if (l > 0) {
            await supabaseAdmin.from('daily_metrics').upsert(
              { user_id: userId, date: today, water_liters: existingWater + l, synced: true },
              { onConflict: 'user_id,date' }
            );
            feedback.push(`Su +${l}L`);
          }
          break;
        }
        case 'sleep_log': {
          const h = action.hours as number;
          if (h > 0 && h < 24) {
            await supabaseAdmin.from('daily_metrics').upsert(
              { user_id: userId, date: today, sleep_hours: h, sleep_quality: action.quality as string, water_liters: existingWater, synced: true },
              { onConflict: 'user_id,date' }
            );
            feedback.push('Uyku kaydedildi');
          }
          break;
        }
        case 'mood_log': {
          await supabaseAdmin.from('daily_metrics').upsert(
            { user_id: userId, date: today, mood_score: action.score as number, mood_note: action.note as string, water_liters: existingWater, synced: true },
            { onConflict: 'user_id,date' }
          );
          feedback.push('Ruh hali kaydedildi');
          break;
        }
        case 'supplement_log': {
          await supabaseAdmin.from('supplement_logs').insert({
            user_id: userId, supplement_name: action.name as string,
            amount: action.amount as string, logged_for_date: today,
          });
          feedback.push('Supplement kaydedildi');
          break;
        }
        case 'commitment': {
          const followUp = new Date();
          followUp.setDate(followUp.getDate() + ((action.follow_up_days as number) ?? 1));
          await supabaseAdmin.from('user_commitments').insert({
            user_id: userId, commitment: action.text as string,
            follow_up_at: followUp.toISOString(), status: 'pending',
          });
          feedback.push('Taahhut kaydedildi');
          break;
        }
        case 'profile_update': {
          const updates: Record<string, unknown> = {};
          // Core demographics
          if (action.height_cm) updates.height_cm = action.height_cm;
          if (action.weight_kg) updates.weight_kg = action.weight_kg;
          if (action.birth_year) updates.birth_year = action.birth_year;
          if (action.gender) updates.gender = action.gender;
          if (action.display_name) updates.display_name = action.display_name;
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

          if (Object.keys(updates).length > 0) {
            updates.updated_at = new Date().toISOString();
            await supabaseAdmin.from('profiles').update(updates).eq('id', userId);
            feedback.push('Profil güncellendi');
          }
          // Goal persistence: save even without target_weight_kg — user may give goal type
          // ("kilo vermek istiyorum") before specifying a target. Upsert on active goal so
          // adding the target later just updates the same row. Uses limit(1) instead of
          // maybeSingle() to survive the legacy "multiple active goals" case before
          // migration 033. A partial unique index now prevents new duplicates.
          if (action.goal_type || action.target_weight_kg) {
            const { data: existingRows } = await supabaseAdmin
              .from('goals')
              .select('id')
              .eq('user_id', userId)
              .eq('is_active', true)
              .limit(1);
            const existing = existingRows?.[0] ?? null;
            const goalPatch: Record<string, unknown> = {
              user_id: userId,
              is_active: true,
            };
            if (action.goal_type) goalPatch.goal_type = action.goal_type;
            else if (!existing) goalPatch.goal_type = 'lose_weight'; // only set default on brand-new row
            if (action.target_weight_kg) goalPatch.target_weight_kg = action.target_weight_kg;
            if (!existing) {
              goalPatch.target_weeks = 12;
              goalPatch.priority = 'sustainable';
              goalPatch.restriction_mode = 'sustainable';
              goalPatch.weekly_rate = 0.5;
              await supabaseAdmin.from('goals').insert(goalPatch);
            } else {
              await supabaseAdmin.from('goals').update(goalPatch).eq('id', existing.id);
            }
            feedback.push(action.target_weight_kg ? 'Hedef belirlendi' : 'Hedef tipi kaydedildi');
          }
          break;
        }
        case 'strength_log': {
          // T3.24: Parse strength sets from chat (e.g., "bench press 4x8 70kg")
          // First create a workout_log, then attach strength_sets to it
          const sets = action.sets as { exercise: string; set_number: number; reps: number; weight_kg: number }[] | undefined;
          if (sets?.length) {
            const { data: wlog } = await supabaseAdmin.from('workout_logs').insert({
              user_id: userId, raw_input: action.raw as string ?? 'strength',
              workout_type: 'strength', duration_min: sets.length * 3,
              intensity: 'moderate', logged_for_date: today,
            }).select('id').maybeSingle();
            if (wlog?.id) {
              await supabaseAdmin.from('strength_sets').insert(
                sets.map(s => ({
                  workout_log_id: wlog.id, exercise_name: s.exercise,
                  set_number: s.set_number, reps: s.reps, weight_kg: s.weight_kg,
                }))
              );
            }
            feedback.push(`Guc kaydi: ${sets.length} set kaydedildi`);
          }
          break;
        }
        case 'save_recipe': {
          // T3.6: Save recipe from AI chat to recipe library
          const recipe = action as Record<string, unknown>;
          await supabaseAdmin.from('saved_recipes').insert({
            user_id: userId,
            title: recipe.title as string ?? 'Tarif',
            category: recipe.category as string ?? 'dinner',
            ingredients: recipe.ingredients,
            instructions: recipe.instructions as string ?? '',
            total_calories: recipe.calories as number ?? 0,
            total_protein: recipe.protein_g as number ?? 0,
            prep_time_min: recipe.prep_time_min as number ?? 0,
            servings: recipe.servings as number ?? 1,
          });
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
              const targetDate = new Date(Date.now() + offset * 86400000).toISOString().split('T')[0];
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
          const newState = action.state as string;
          const endDate = action.end_date as string | null;
          const profileUpdates: Record<string, unknown> = {
            periodic_state: newState,
            periodic_state_start: new Date().toISOString().split('T')[0],
            periodic_state_end: endDate ?? null,
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
          // Auto-pause IF if incompatible (illness, pregnancy, breastfeeding)
          if (['illness', 'pregnancy', 'breastfeeding'].includes(newState)) {
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
          const newNote = `${currentNotes}\n[${dateStr}] ${newState} donemi baslatildi${endDate ? ` (bitis: ${endDate})` : ''}`.trim();
          await supabaseAdmin.from('ai_summary').upsert(
            { user_id: userId, seasonal_notes: newNote, updated_at: new Date().toISOString() },
            { onConflict: 'user_id' }
          );
          feedback.push(`Donemsel durum: ${newState}`);
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
          }).catch(() => {});

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
          }).catch(() => {});

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
            periodic_state_end: new Date(Date.now() + weeks * 7 * 86400000).toISOString().split('T')[0],
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
          const gType = action.goal_type as string;
          const targetVal = action.target_value as number | null;
          const targetWeeks = (action.target_weeks as number) ?? 12;

          await supabaseAdmin.from('goals').insert({
            user_id: userId,
            goal_type: gType,
            target_weight_kg: gType === 'kas_kazanim' || gType === 'kilo_verme' ? targetVal : null,
            target_weeks: targetWeeks,
            is_active: true,
            created_at: new Date().toISOString(),
          });

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
            .eq('trigger', 'caffeine_water_bump')
            .gte('created_at', `${today}T00:00:00`)
            .limit(1);
          if (!caffeineLogged || caffeineLogged.length === 0) {
            await supabaseAdmin
              .from('daily_plans')
              .update({ water_target_liters: Math.round((base + additionalLiters) * 10) / 10 })
              .eq('id', todayPlan.id);
            await supabaseAdmin.from('coaching_messages').insert({
              user_id: userId,
              trigger: 'caffeine_water_bump',
              priority: 'low',
              message: `Kafein icin su hedefi +${additionalLiters}L arttirildi (${base}L → ${Math.round((base + additionalLiters) * 10) / 10}L).`,
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

    // A1: Alcohol pattern (Spec 3.1 — previously silently dropped)
    if (updates.alcohol_pattern) {
      const current = (existing?.coaching_notes as string) ?? '';
      const dateStr = new Date().toISOString().split('T')[0];
      changes.coaching_notes = `${current}\n[${dateStr}] Alkol kalıbı: ${updates.alcohol_pattern}`.trim();
    }

    // A2: Social eating note (Spec 7.4 — previously silently dropped)
    if (updates.social_eating_note) {
      const current = (existing?.coaching_notes as string) ?? '';
      const dateStr = new Date().toISOString().split('T')[0];
      changes.coaching_notes = `${current}\n[${dateStr}] Sosyal yeme: ${updates.social_eating_note}`.trim();
    }

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

    // A1: Alcohol pattern — structured format { pattern, frequency, impact }
    if (updates.alcohol_pattern) {
      if (typeof updates.alcohol_pattern === 'object') {
        changes.alcohol_pattern = updates.alcohol_pattern;
      } else {
        changes.alcohol_pattern = {
          pattern: updates.alcohol_pattern as string,
          frequency: 'bilinmiyor',
          impact: 'bilinmiyor',
        };
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

    // Default sustainable deficit targets
    const targetCal = Math.round(tdee * 0.85);
    const rangeWidth = Math.round(targetCal * 0.10);
    const trainingMin = Math.max(targetCal - Math.round(rangeWidth / 2), data.gender === 'female' ? 1200 : 1400);
    const trainingMax = targetCal + Math.round(rangeWidth / 2);
    const restMin = Math.max(trainingMin - 250, data.gender === 'female' ? 1200 : 1400);
    const restMax = trainingMax - 250;
    const proteinG = Math.round(data.weight_kg * 1.8);
    const waterTarget = Math.round(data.weight_kg * 0.033 * 10) / 10;
    const weeklyBudget = 4 * Math.round((trainingMin + trainingMax) / 2) + 3 * Math.round((restMin + restMax) / 2);

    await supabaseAdmin.from('profiles').update({
      onboarding_completed: true,
      tdee_calculated: tdee,
      tdee_last_weight: data.weight_kg,
      tdee_last_date: new Date().toISOString().split('T')[0],
      calorie_range_training_min: trainingMin,
      calorie_range_training_max: trainingMax,
      calorie_range_rest_min: restMin,
      calorie_range_rest_max: restMax,
      protein_target_g: proteinG,
      protein_per_kg: 1.8,
      water_target_liters: waterTarget,
      weekly_calorie_budget: weeklyBudget,
      macro_pct_protein: 30,
      macro_pct_carb: 40,
      macro_pct_fat: 30,
      updated_at: new Date().toISOString(),
    }).eq('id', userId);
  }
}

/**
 * T1.19: Recalculate TDEE when significant weight change detected.
 * Spec 2.4: Triggers on 2.5+ kg change or 30+ days since last calc.
 */
async function recalculateTDEEIfNeeded(userId: string, currentWeight: number) {
  const { data: profile } = await supabaseAdmin
    .from('profiles')
    .select('height_cm, birth_year, gender, activity_level, tdee_last_weight, tdee_last_date')
    .eq('id', userId).maybeSingle();

  if (!profile?.height_cm || !profile?.birth_year || !profile?.gender) return;

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

  if (!needed) return;

  const age = new Date().getFullYear() - profile.birth_year;
  const base = 10 * currentWeight + 6.25 * profile.height_cm - 5 * age;
  const bmr = profile.gender === 'male' ? base + 5 : base - 161;
  const multipliers: Record<string, number> = { sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very_active: 1.9 };
  const tdee = Math.round(bmr * (multipliers[profile.activity_level ?? 'moderate'] ?? 1.55));

  const targetCal = Math.round(tdee * 0.85);
  const rangeWidth = Math.round(targetCal * 0.10);
  const trainingMin = Math.max(targetCal - Math.round(rangeWidth / 2), profile.gender === 'female' ? 1200 : 1400);
  const trainingMax = targetCal + Math.round(rangeWidth / 2);
  const restMin = Math.max(trainingMin - 250, profile.gender === 'female' ? 1200 : 1400);
  const restMax = trainingMax - 250;
  const proteinG = Math.round(currentWeight * 1.8);
  const waterTarget = Math.round(currentWeight * 0.033 * 10) / 10;
  const weeklyBudget = 4 * Math.round((trainingMin + trainingMax) / 2) + 3 * Math.round((restMin + restMax) / 2);

  await supabaseAdmin.from('profiles').update({
    tdee_calculated: tdee,
    tdee_last_weight: currentWeight,
    tdee_last_date: new Date().toISOString().split('T')[0],
    calorie_range_training_min: trainingMin,
    calorie_range_training_max: trainingMax,
    calorie_range_rest_min: restMin,
    calorie_range_rest_max: restMax,
    protein_target_g: proteinG,
    water_target_liters: waterTarget,
    weekly_calorie_budget: weeklyBudget,
    updated_at: new Date().toISOString(),
  }).eq('id', userId);

  // Notify user so they know targets shifted
  const reason = lastWeight
    ? `Kilon ${lastWeight.toFixed(1)} → ${currentWeight.toFixed(1)}kg degisti`
    : 'İlk TDEE hesaplamasi';
  await supabaseAdmin.from('coaching_messages').insert({
    user_id: userId,
    trigger: 'tdee_recalculated',
    priority: 'low',
    message: `${reason}. Yeni TDEE ${tdee} kcal, kalori araligi ${restMin}-${trainingMax} kcal, protein ${proteinG}g, su ${waterTarget}L.`,
  }).catch(() => {});
}
