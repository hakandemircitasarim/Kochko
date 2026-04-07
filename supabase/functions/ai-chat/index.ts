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

    const { message, image_base64, target_date, audio_base64, session_id, task_mode_hint } = body;

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

    // GAP 1: Return-flow detection — check how long the user has been silent
    let returnFlowContext = '';
    try {
      // At this point storeMessages hasn't been called yet, so index 0 is the previous message
      const { data: lastMsgs } = await supabaseAdmin
        .from('chat_messages')
        .select('created_at')
        .eq('user_id', userId)
        .eq('role', 'user')
        .order('created_at', { ascending: false })
        .limit(1);
      const prevMsg = lastMsgs && lastMsgs.length > 0 ? lastMsgs[0] : null;
      if (prevMsg) {
        const daysSinceLastChat = (Date.now() - new Date(prevMsg.created_at).getTime()) / 86400000;
        if (daysSinceLastChat >= 180) {
          returnFlowContext = 'KULLANICI 6+ AYDIR SESSIZ. Seni ozledik tonu. Mini re-onboarding: mevcut kilo, hedef, yasam tarzi guncelle.';
        } else if (daysSinceLastChat >= 30) {
          returnFlowContext = 'KULLANICI 1-6 AYDIR SESSIZ. Seni ozledik tonu. Plan %30 hafiflet.';
        } else if (daysSinceLastChat >= 7) {
          returnFlowContext = 'KULLANICI 1-4 HAFTADIR SESSIZ. Gecmis basarilarini referans ver. Ilk 3 gun plan hafiflet (%20).';
        } else if (daysSinceLastChat >= 3) {
          returnFlowContext = "KULLANICI 3-7 GUNDUR SESSIZ. Yargilamadan karsilamla. 'Hos geldin, nereden devam edelim?'";
        }
      }
    } catch { /* non-critical */ }

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

    // D12: Habits context injection — query ai_summary directly
    let habitsCtx = '';
    try {
      const { data: habitSummary } = await supabaseAdmin
        .from('ai_summary').select('habit_progress').eq('user_id', userId).maybeSingle();
      if (habitSummary?.habit_progress) {
        const habits = habitSummary.habit_progress as { habit: string; status: string; streak: number }[];
        const active = habits.filter(h => h.status === 'active');
        const mastered = habits.filter(h => h.status === 'mastered');
        if (active.length > 0 || mastered.length > 0) {
          const hParts: string[] = ['## ALISKANLIK DURUMU'];
          if (active.length > 0) hParts.push(`Aktif: ${active.map(h => `"${h.habit}" (${h.streak} gun seri)`).join(', ')}`);
          if (mastered.length > 0) hParts.push(`Oturtulmus: ${mastered.map(h => h.habit).join(', ')}`);
          const almostMastered = active.find(h => h.streak >= 12 && h.streak < 14);
          if (almostMastered) hParts.push(`"${almostMastered.habit}" 2 gun sonra oturtulmus sayilacak!`);
          habitsCtx = hParts.join('\n');
        }
      }
    } catch { /* non-critical */ }

    const systemPrompt = [
      BASE_SYSTEM_PROMPT,
      modeInstructions,
      confidenceNote,
      toneContext,
      personaPrompt,
      correctionCtx,
      returnFlowContext,
      habitsCtx,
      ctx.layer1 ? `--- KULLANICI HAKKINDA ---\n\n${ctx.layer1}` : '',
      ctx.layer2 ? `--- AI OZETI ---\n\n${ctx.layer2}` : '',
      ctx.layer3 ? `--- SON VERILER ---\n\n${ctx.layer3}` : '',
      repairContext,
      remainingMacrosNote,
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
    if (actions.length === 0 && message) {
      const profileUpdate = extractProfileFromMessage(message);
      if (profileUpdate && Object.keys(profileUpdate).length > 0) {
        actions.push({ type: 'profile_update', ...profileUpdate });
      }
    }

    // Extract Layer 2 updates
    const { cleanMessage: finalMessage, layer2Updates } = extractLayer2Updates(assistantMessage);
    assistantMessage = finalMessage;

    // Execute actions (use target_date for batch entry, T1.17)
    const actionFeedback = await executeActions(userId, actions, profile?.gender, target_date);

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

    return respond({
      message: assistantMessage,
      actions: actions.map((a: { type: string }, i: number) => ({
        type: a.type,
        feedback: actionFeedback[i] ?? null,
      })),
      task_mode: taskMode,
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
function extractProfileFromMessage(msg: string): Record<string, unknown> | null {
  const result: Record<string, unknown> = {};
  const lower = msg.toLocaleLowerCase('tr');

  // Height: "boyum 175", "175 cm", "boy: 180"
  const heightMatch = lower.match(/boy\w*\s*[:=]?\s*(\d{2,3})\s*(cm)?|(\d{2,3})\s*cm/);
  if (heightMatch) {
    const h = parseInt(heightMatch[1] ?? heightMatch[3]);
    if (h >= 100 && h <= 250) result.height_cm = h;
  }

  // Weight: "kilom 72", "72 kg", "72 kiloyum"
  const weightMatch = lower.match(/kilo\w*\s*[:=]?\s*(\d{2,3}(?:\.\d)?)|(\d{2,3}(?:\.\d)?)\s*(kg|kilo)/);
  if (weightMatch) {
    const w = parseFloat(weightMatch[1] ?? weightMatch[2]);
    if (w >= 30 && w <= 300) result.weight_kg = w;
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

  // Gender: "erkeğim", "kadınım"
  if (/erkek|male/.test(lower)) result.gender = 'male';
  else if (/kadin|kadın|female/.test(lower)) result.gender = 'female';

  return Object.keys(result).length > 0 ? result : null;
}

function extractLayer2Updates(text: string): { cleanMessage: string; layer2Updates: Record<string, unknown> | null } {
  let updates: Record<string, unknown> | null = null;
  const match = text.match(/<layer2_update>([\s\S]*?)<\/layer2_update>/);
  if (match) {
    try { updates = JSON.parse(match[1]); } catch { /* ignore */ }
  }
  return { cleanMessage: text.replace(/<layer2_update>[\s\S]*?<\/layer2_update>/, '').trim(), layer2Updates: updates };
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
  targetDate?: string
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
          const items = action.items as { name: string; portion: string; calories: number; protein_g: number; carbs_g: number; fat_g: number }[] | undefined;
          const mealType = action.meal_type as string ?? 'snack';
          const { data: log } = await supabaseAdmin.from('meal_logs').insert({
            user_id: userId, raw_input: action.raw as string ?? '',
            meal_type: mealType,
            input_method: 'ai_chat', logged_for_date: today, synced: true,
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
          await supabaseAdmin.from('workout_logs').insert({
            user_id: userId, raw_input: action.raw as string ?? '',
            workout_type: action.workout_type as string ?? 'mixed',
            duration_min: (action.duration_min as number) ?? 0,
            intensity: action.intensity as string ?? 'moderate',
            calories_burned: (action.calories_burned as number) ?? 0,
            logged_for_date: today, synced: true,
          });
          feedback.push('Antrenman kaydedildi');
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
          if (action.target_weight_kg) {
            await supabaseAdmin.from('goals').insert({
              user_id: userId, goal_type: (action.goal_type as string) ?? 'lose_weight',
              target_weight_kg: action.target_weight_kg as number,
              target_weeks: 12, priority: 'sustainable', restriction_mode: 'sustainable',
              weekly_rate: 0.5, is_active: true,
            });
            feedback.push('Hedef belirlendi');
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
          // Spec 6.3: Schedule recovery follow-up
          const recoveryFollowUp = new Date(Date.now() + 86400000);
          recoveryFollowUp.setHours(9, 0, 0, 0);
          await supabaseAdmin.from('user_commitments').insert({
            user_id: userId,
            commitment: 'Kurtarma takibi — dun fazla yedin, bugun nasil gidiyor?',
            follow_up_at: recoveryFollowUp.toISOString(),
            status: 'pending',
          });
          feedback.push('Kurtarma plani olusturuldu');
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
          // Auto-pause IF if incompatible (illness, pregnancy, breastfeeding)
          if (['illness', 'pregnancy', 'breastfeeding'].includes(newState)) {
            profileUpdates.if_active = false;
          }
          await supabaseAdmin.from('profiles').update(profileUpdates).eq('id', userId);

          // Auto-pause active challenges on illness
          if (newState === 'illness') {
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
                feedback.push('Hastalik nedeniyle aktif challenge\'lar otomatik duraklatildi.');
              }
            } catch { /* challenge pause non-critical */ }
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

    // ─── Portion calibration with confidence gate ───
    if (updates.portion_update) {
      const pu = updates.portion_update as { food: string; user_portion_grams: number; confidence?: number };
      const portionConfidence = pu.confidence ?? 0.7;

      // Only write if confidence >= 0.7
      if (portionConfidence >= 0.7) {
        const cal = (existing?.portion_calibration as Record<string, unknown>) ?? {};
        cal[pu.food] = pu.user_portion_grams;
        changes.portion_calibration = cal;
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

    if (Object.keys(changes).length > 0) {
      await updateLayer2(userId, changes);
    }
  } catch { /* non-critical */ }
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
}
