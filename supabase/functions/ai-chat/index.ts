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
import type { UsageReceipt } from '../shared/openai.ts';
import { supabaseAdmin, getUserId } from '../shared/supabase-admin.ts';
import { updateLayer2, appendBehavioralPatterns } from '../shared/memory.ts';
import { sanitizeText, detectEmergency, detectCrisis, detectEDRisk, checkAllergens, extractDeclaredAllergens, ALLERGEN_FOODS, foodMatchKey, sanitizeUserInput, extractInjuredBodyParts, findInjuryConflictsInText, filterExercisesByInjury } from '../shared/guardrails.ts';
import { computeItemNutrition } from '../shared/food-reference.ts';
import { isMemoryMirrorIntent, buildMemoryMirror } from '../shared/memory-mirror.ts';
import { writeTurnLog } from '../shared/turn-log.ts';
import { validateMealParse } from '../shared/output-validator.ts';
import { checkRateLimit, reserveRateLimitSlot } from '../shared/rate-limit.ts';
import { validateChatRequest, checkPayloadSize } from '../shared/request-validator.ts';
import { analyzeMessage, getRetrievalPlan } from '../shared/retrieval-planner.ts';
import { buildContextFromPlan } from '../shared/context-builders.ts';
import { selectModel } from '../shared/model-router.ts';
import { BASE_SYSTEM_PROMPT, PHOTO_ANALYSIS_PROMPT, PERIODIC_STATE_PROMPT, CYCLE_PROMPT, RETURN_FLOW_PROMPT, buildConfidenceNote } from './system-prompt.ts';
import { detectTaskMode, getModeInstructions, type TaskMode } from './task-modes.ts';
import {
  detectRepairIntent, handleUndo, undoTypeForPhrase, buildCorrectionContext,
  shouldDetectPersona, buildPersonaDetectionPrompt, getMessageCount,
  getToneContext, buildKnowledgeSummary, getRepairContext,
} from '../shared/repair-handler.ts';
import { getAllServiceContexts, checkHabitFromChat, getSituationalSnapshot } from '../shared/service-contexts.ts';
import { projectDailyPlanRows, type DietPlanData, type WorkoutPlanData } from '../shared/plan-projection.ts';
import { resolveTargetCalories, computeCalorieBand, bmrMifflin, tdeeFrom } from '../shared/targets.ts';
import { getCalorieFloor } from '../shared/clinical-rules.ts';
import { extractLifeEvent } from '../shared/life-events.ts';
import { syncConstraint, deactivateConstraints, syncInjuryFromText, resolveInjuryConstraints, getActiveConstraints } from '../shared/constraints.ts';
import { getEffectiveDateForUser, shiftDateString } from '../shared/day-boundary.ts';
import { isIFCompatible, type PeriodicState } from '../shared/periodic-config.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

// FIX (audit AI-MDL-01/AI-MDL-02): route the Whisper STT call through the same provider
// config knobs as shared/openai.ts + ai-extractor — OPENAI_BASE_URL + a dedicated
// KOCHKO_MODEL_STT model — so a backend swap (OpenRouter/Azure/self-host) is one secret set
// instead of a hardcoded 'whisper-1'/'api.openai.com' that the gateway may not serve. Wrap
// the fetch in an AbortController so a hung upstream returns a clean error instead of an
// indefinite spinner (the edge wall-clock would otherwise kill the whole function).
const OPENAI_BASE_URL = (Deno.env.get('OPENAI_BASE_URL') ?? 'https://api.openai.com/v1').replace(/\/+$/, '');
const STT_MODEL = Deno.env.get('KOCHKO_MODEL_STT') || 'whisper-1';
const STT_TIMEOUT_MS = 45_000;
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs = STT_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // FIX (audit AI-MDL-05): declared at handler scope so the catch can RELEASE an orphaned
  // rate-limit reservation. The reservation inserts the user chat_messages row before the LLM
  // call; if generation then throws, the final storeMessages (which would have appended the
  // assistant reply) never runs — without this cleanup the lone reserved user row would persist
  // and permanently burn a daily-cap slot for a turn the user never got an answer to.
  let reservedUserMessageId: string | null = null;
  // #arch step 4: handler-scope so the catch can mark THIS request's journal claim failed (letting
  // a retry reclaim + reprocess instead of polling a dead in_flight row until the lease expires).
  let journalUserId = '';
  let journalKey = '';

  try {
    // T1.10: Request validation
    const sizeCheck = checkPayloadSize(req.headers.get('content-length'));
    if (!sizeCheck.valid) return respond({ error: sizeCheck.error }, 413);

    const userId = await getUserId(req);
    const body = await req.json();

    const validation = validateChatRequest(body);
    if (!validation.valid) return respond({ error: validation.error }, 400);

    const { message, image_base64, target_date: target_date_raw, audio_base64, session_id, task_mode_hint, client_timezone, plan_type, user_approved, draft_id, idempotency_key } = body;

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
      // FIX (audit AI-MDL-01): env-driven STT model + base URL (was hardcoded whisper-1/OpenAI).
      formData.append('model', STT_MODEL);
      let whisperRes: Response;
      try {
        // FIX (audit AI-MDL-02): timeout-wrapped — a hung gateway no longer hangs the function.
        whisperRes = await fetchWithTimeout(`${OPENAI_BASE_URL}/audio/transcriptions`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${Deno.env.get('OPENAI_API_KEY')}` },
          body: formData,
        });
      } catch (sttErr) {
        const isAbort = (sttErr as Error)?.name === 'AbortError';
        return respond({ error: isAbort ? 'Ses çözümleme zaman aşımına uğradı, tekrar dener misin?' : 'Transcription failed' }, isAbort ? 504 : 500);
      }
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
    // #live-L6/L7: a MEDIUM-severity ED signal ("kendimi aç bırakıyorum", "çok şişmanım",
    // sub-floor calorie + rapid-loss intent) must still surface the professional-support
    // referral (Spec 12.5/5.6). It previously hit a dead comment and was dropped. We hoist
    // it so coaching continues (soft tone) but the referral is appended to the final reply.
    let edMediumReferral: string | null = null;
    if (message) {
      // FIX (audit AI-ORC-04): persistence MUST NOT gate an acute-safety reply.
      // storeMessages throws SESSION_NOT_FOUND (fail-closed on a deleted/stale
      // session_id — KVKK reset or closeSession race) or on a transient
      // chat_messages insert error. In the safety branches that throw would
      // unwind to the outer catch and return 404/500, so a user in acute crisis
      // would NEVER get the 112 / professional-help referral. Best-effort the
      // history write and ALWAYS return the safety response.
      const safeStore = async (
        u: string, m: string, a: string, mode: string, sid?: string,
      ): Promise<void> => {
        try {
          await storeMessages(u, m, a, mode, undefined, undefined, undefined, sid);
        } catch (storeErr) {
          console.error('[ai-chat] safety-branch storeMessages failed (response still returned):', storeErr);
        }
      };
      const emergency = detectEmergency(message);
      if (emergency.isEmergency) {
        await safeStore(userId, message, emergency.message, 'emergency', session_id);
        return respond({ message: emergency.message, actions: [], task_mode: 'emergency' });
      }
      // Self-harm / suicide crisis — MUST run before the ED check so a suicidal
      // message gets the acute crisis response (112 + professional help), never
      // the milder eating-disorder dietitian referral (#R1-C2).
      const crisis = detectCrisis(message);
      if (crisis.isCrisis) {
        await safeStore(userId, message, crisis.message, 'safety', session_id);
        return respond({ message: crisis.message, actions: [], task_mode: 'safety' });
      }
      const edRisk = detectEDRisk(message);
      if (edRisk.isRisk && edRisk.severity === 'high') {
        await safeStore(userId, message, edRisk.message, 'safety', session_id);
        return respond({ message: edRisk.message, actions: [], task_mode: 'safety' });
      }
      // Medium severity: keep coaching but ensure the referral reaches the user (appended
      // to the reply below). Deterministic — does not depend on the LLM remembering to add it.
      if (edRisk.isRisk && edRisk.severity === 'medium') edMediumReferral = edRisk.message;
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

    // #arch L7 (MemoryMirror): when the user asks what the coach knows about them, answer with the
    // EXACT stored beliefs (deterministic, never an LLM paraphrase that could hallucinate a fact) +
    // an invitation to correct anything wrong. The glass-box: the user always sees, and outranks,
    // what's in the coach's active filter. Existing correction handlers are the write path.
    if (message && isMemoryMirrorIntent(message)) {
      try {
        const mirror = await buildMemoryMirror(userId);
        await storeMessages(userId, message, mirror, 'coaching', undefined, undefined, undefined, session_id);
        return respond({ message: mirror, actions: [], task_mode: 'coaching' });
      } catch (e) {
        console.error('[memory_mirror] build failed, falling through to LLM:', (e as Error).message);
      }
    }

    // #arch step 4 (request journal / audit finding 9): make this logical send execute EXACTLY
    // ONCE. The client retries with the SAME idempotency_key on its 20s timeout while attempt 1
    // keeps running server-side. The first caller becomes the OWNER; a concurrent retry WAITS for
    // the owner to commit and REPLAYS its exact response — no 2nd LLM call, no divergent second
    // reply, no duplicate chat_messages/ai_turn_log. Deterministic short-circuits above (emergency/
    // crisis/injection/mirror) are cheap + idempotent, so they intentionally skip the journal.
    const idemKey = typeof idempotency_key === 'string' && idempotency_key ? idempotency_key : '';
    if (idemKey) {
      const claim = await claimOrAwaitRequest(userId, idemKey);
      if (claim.mode === 'replay') {
        console.log('[request_journal] replaying committed response', { key: idemKey });
        return respond(claim.envelope);
      }
      journalUserId = userId; journalKey = idemKey; // we own it — the catch releases it on failure
    }
    // #arch step 4: commit the exact response into the journal on EVERY owner success return, so a
    // still-in-flight retry replays THIS instead of re-processing (double meal-log / double KVKK
    // deletion / double undo). No-op when there's no idempotency_key.
    const commitAndRespond = async (data: unknown, status = 200): Promise<Response> => {
      if (journalKey) { await commitRequestEnvelope(journalUserId, journalKey, data); journalKey = ''; }
      return respond(data, status);
    };

    // Rate limiting (Spec 16.4)
    const preliminaryTaskMode = message ? detectTaskMode(message, false) : 'coaching';
    const isRecordParse = preliminaryTaskMode === 'register';
    const rateLimit = await checkRateLimit(userId, isRecordParse);
    if (!rateLimit.allowed) {
      if (idemKey) await failRequest(userId, idemKey); // release the claim so a later real turn isn't stuck polling
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
        // FIX (audit AI-EXT-05): constrain the undo to the type the matched phrase implied
        // ('son öğünü sil' → meal only) so a type-specific request can't delete the newest
        // row of a DIFFERENT type (e.g. hard-deleting a workout when the user meant a meal).
        const intendedType = undoTypeForPhrase(repairIntent.matchedPhrase);
        const undoResult = await handleUndo(userId, intendedType);
        await storeMessages(userId, message, undoResult.response ?? '', undefined, undefined, undefined, undefined, session_id);
        return await commitAndRespond({ message: undoResult.response, actions: [], task_mode: 'repair' });
      }

      // "Benim hakkımda ne biliyorsun?" handler (Spec 5.18)
      const knowledgePatterns = /benim hakkimda|beni tan[iı]|ne [oö]grendin|ne biliyorsun|beni ne kadar/i;
      if (knowledgePatterns.test(message)) {
        const summary = await buildKnowledgeSummary(userId);
        await storeMessages(userId, message, summary, undefined, undefined, undefined, undefined, session_id);
        return await commitAndRespond({ message: summary, actions: [], task_mode: 'knowledge' });
      }

      // #live-L18: KVKK Md.7/17 erasure. A full-account-deletion or "beni unut / hafızanı
      // sıfırla" request previously had NO handler — the model freely (and FALSELY) confirmed
      // a deletion that never happened (compliance + trust failure). Handle deterministically:
      // memory-reset clears ai_summary; full-deletion ALSO schedules the reversible 30-day
      // account-deletion grace (mirrors privacy.service.requestAccountDeletion) + audit, and
      // points the user to Settings to confirm/cancel. Never claim a deletion we didn't do.
      const mDel = message.toLocaleLowerCase('tr');
      // Intent-based (NOT adjacency-based): an erase verb anywhere + a strong account/data/memory
      // target anywhere. Adjacency regexes missed the natural phrasing "KVKK kapsamında tüm
      // verilerimi KALICI OLARAK sil" (#live-L18 verify). Bare "bilgi/kayıt" is excluded so a
      // correction/undo ("az önce verdiğim bilgiyi sil") doesn't misfire (it's handled above).
      const eraseVerb = /(sil|unut|sıfırla|sifirla)/.test(mDel);
      const eraseTarget = /(verilerim|verimi|tüm ver|tum ver|hesab|kvkk|unutulma|beni unut|hafıza|hafiza)/.test(mDel);
      const wantsErase = eraseVerb && eraseTarget;
      const isQuestion = /nasıl|nasil|\?|m[ıiuü]s[ıiuü]n|mümkün mü|mumkun mu|olur mu|misin/.test(mDel);
      if (wantsErase && !isQuestion) {
        const fullDeletion = /(hesab|tüm ver|tum ver|verilerimi|verimi|kvkk|kalıcı|kalici)/.test(mDel);
        try {
          // Always reset coaching memory on any erase intent (bounded, clearly requested).
          await supabaseAdmin.from('ai_summary').delete().eq('user_id', userId);
          await supabaseAdmin.from('audit_logs').insert({
            user_id: userId,
            event_type: fullDeletion ? 'account_delete_request' : 'memory_reset',
            description: fullDeletion ? 'KVKK chat-initiated account deletion request (30-day grace)' : 'KVKK chat-initiated coach-memory reset',
          });
          let kvkkMsg: string;
          let kvkkNav: string | null = null;
          if (fullDeletion) {
            await supabaseAdmin.from('profiles')
              .update({ deletion_requested_at: new Date().toISOString(), updated_at: new Date().toISOString() })
              .eq('id', userId);
            kvkkMsg = 'KVKK kapsamında veri silme talebini başlattım ve koç hafızamı sıfırladım. Hesabın ve tüm verilerin 30 gün içinde kalıcı olarak silinecek. Fikrini değiştirirsen bu süre içinde Ayarlar > Hesap ve Güvenlik ekranından talebi iptal edebilirsin.';
            kvkkNav = '/settings/account-security';
          } else {
            kvkkMsg = 'Hakkında tuttuğum tüm koç hafızasını (notlar, çıkarımlar, alışkanlık özetleri) sildim. Bundan sonra seni yeniden tanımaya başlayacağım. Hesabını tamamen silmek istersen "tüm verilerimi sil" diyebilir ya da Ayarlar > Hesap ve Güvenlik ekranını kullanabilirsin.';
          }
          await storeMessages(userId, message, kvkkMsg, 'kvkk', undefined, undefined, undefined, session_id);
          return await commitAndRespond({ message: kvkkMsg, actions: [], task_mode: 'kvkk', navigate_to: kvkkNav });
        } catch (e) {
          console.error('[kvkk_erase] failed:', (e as Error).message);
          // fall through to normal flow rather than falsely confirming a deletion
        }
      }
    }

    // Check onboarding status
    const { data: profile } = await supabaseAdmin
      .from('profiles').select('onboarding_completed, gender, calorie_range_rest_min, calorie_range_rest_max, calorie_range_training_min, calorie_range_training_max, protein_per_kg, weight_kg, home_timezone, active_timezone, day_boundary_hour, periodic_state, menstrual_tracking')
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

    // FIX (audit AI-ORC-05): validate the client-supplied target_date server-side.
    // validateChatRequest never checks it, so an absurd-but-valid date ('3026-01-01',
    // '1900-01-01') would be written silently and a malformed string ('2026-13-99')
    // would reach the date column and 23xxx-fail the action. Require ISO YYYY-MM-DD,
    // reject NaN, and clamp to the same window philosophy as the days_ago backdater:
    // never in the future (relative to the user's effective day) and at most 30 days
    // back (the regex/days_ago backdate ceiling is 7; 30 leaves headroom for explicit
    // client backfill without allowing arbitrary historical rewrites). Out-of-window or
    // malformed values fall back to effectiveToday.
    let target_date: string | undefined;
    if (typeof target_date_raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(target_date_raw)) {
      const parsed = new Date(`${target_date_raw}T00:00:00Z`);
      // Reject NaN AND round-trip mismatches (e.g. '2026-13-99' / '2026-02-31' that
      // Date silently rolls over into a different valid date).
      if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().split('T')[0] === target_date_raw) {
        const minDate = shiftDateString(effectiveToday, -30);
        if (target_date_raw <= effectiveToday && target_date_raw >= minDate) {
          target_date = target_date_raw;
        }
        // else: out of window — leave undefined so it falls back to effectiveToday.
      }
    }

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
    // FIX (audit AI-HIGH): use effectiveMode, not taskMode. detectTaskMode can never produce
    // daily_log/plan_diet/plan_workout, so passing taskMode left getRetrievalPlan's rich
    // branches for those three modes UNREACHABLE — post-onboarding daily logging and plan
    // negotiation silently fell back to a narrow coaching plan. effectiveMode honors the
    // client hint; for every non-hint call effectiveMode === taskMode (no behavior change).
    const analysis = analyzeMessage(message ?? '', effectiveMode);
    const retrievalPlan = getRetrievalPlan(analysis);

    // Build scoped context based on retrieval plan.
    // #live-L9: scope Layer-4 transcript to the user's CURRENT session even on no-session_id
    // calls (quick-log/barcode). Without an id, buildLayer4Scoped loaded the newest messages
    // across ALL sessions, bleeding an unrelated old conversation into context. Resolve the
    // effective session the SAME way storeMessages will (body id if present, else active session).
    let effectiveSessionId: string | undefined = (session_id as string | undefined) ?? undefined;
    if (!effectiveSessionId) {
      const { data: activeSession } = await supabaseAdmin
        .from('chat_sessions').select('id').eq('user_id', userId).eq('is_active', true).maybeSingle();
      if (activeSession) effectiveSessionId = activeSession.id as string;
    }
    const ctx = await buildContextFromPlan(userId, retrievalPlan, effectiveSessionId);

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
    // #organism: the ALWAYS-ON situational snapshot ("who is this person right now") is fetched
    // for EVERY turn regardless of task mode, so the coach never feels amnesiac on a thin
    // register/mood turn. Runs in parallel with the mode-scoped service contexts.
    const [serviceCtx, situationalSnapshot] = await Promise.all([
      getAllServiceContexts(userId, taskMode, {
        message: message ?? '',
        clientTimezone: client_timezone as string | undefined,
        // FIX (audit AI/HIGH day-boundary): pass the already-computed user-effective "today" so
        // recovery/eating-out/MVD contexts share ONE day definition (no redundant profile query,
        // no UTC off-by-one vs the rest of the request).
        effectiveToday,
      }),
      getSituationalSnapshot(userId, effectiveToday),
    ]);

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
      // #arch step 9 (token budget): situational guidance blocks are included ONLY when their
      // signal is present, instead of shipping ~870 dead tokens on every ordinary turn. Each gate
      // is the EXACT condition under which the block is actionable, so behavior is unchanged:
      image_base64 ? PHOTO_ANALYSIS_PROMPT : '',                                   // photo protocol — only with an image (~320 tok)
      profile?.periodic_state ? PERIODIC_STATE_PROMPT : '',                         // per-state detail — only with an active period (~550 tok)
      (profile?.gender === 'female' && profile?.menstrual_tracking) ? CYCLE_PROMPT : '', // cycle coaching — only when tracking (~180 tok)
      serviceCtx.returnFlow ? RETURN_FLOW_PROMPT : '',                              // return-flow tone — only when returning (~140 tok)
      // Task card instructions come right after BASE so they are prominent — they override
      // default onboarding-mode ambition and keep the session narrowly scoped.
      taskCardCtx,
      modeInstructions,
      // #organism: always-on situational snapshot — placed high so it frames EVERY response with
      // "who this person is right now", even on thin register/mood turns. This is what makes the
      // coach feel like it truly knows you and responds to the moment, not a generic bot.
      situationalSnapshot,
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

    // FIX (audit AI-MDL-05): RESERVE the daily-cap slot atomically (insert-then-check) right
    // before the expensive LLM call. The line-198 checkRateLimit is only a READ — under
    // concurrency N parallel turns all read the same stale count and pass the cap together,
    // because the user's chat_messages row isn't written until the END (storeMessages). Here we
    // insert the user row FIRST, then re-count, so concurrent turns see each other and the cap
    // actually holds. The reserved row id is reused by the final storeMessages (it appends only
    // the assistant reply) so we never insert a second user row. Premium/onboarding (remaining
    // === -1) callers still reserve a row but are never blocked, which is correct + harmless.
    // Skip for photo-only turns with no text (message is null) — nothing to reserve as text;
    // the final storeMessages stores the '[foto]' placeholder as before.
    if (message?.trim()) {
      const reservation = await reserveRateLimitSlot(
        userId,
        message,
        taskMode,
        effectiveSessionId ?? null,
        isRecordParse,
      );
      if (!reservation.allowed) {
        if (journalKey) { await failRequest(journalUserId, journalKey); journalKey = ''; } // reject → release claim
        return respond({
          message: reservation.message,
          actions: [],
          task_mode: 'rate_limited',
          rate_limited: true,
          remaining: 0,
        }, 200);
      }
      reservedUserMessageId = reservation.reservedMessageId;
    }

    // Call OpenAI (Spec 5.27: temperature by mode, model router for tier selection)
    const modelSelection = selectModel(analysis, !!image_base64, effectiveMode);
    const temperature = TEMPERATURE[taskMode] ?? 0.5;

    // #arch S2: STRUCTURED-ENVELOPE output. The model now returns {"reply":"...","actions":[...]}
    // so the ACTIONS are a reliable first-class field instead of a free-text <actions> tag the
    // model dropped/malformed often enough to need ~15 injection nets. `reply` still carries the
    // coach's prose PLUS any control blocks (<simulation>/<plan_snapshot>/<reasoning>/…), so the
    // client + history (which scrape those tags from the message text) are UNCHANGED. Falls back
    // to the legacy prose+regex path whenever the model returns non-envelope content.
    // #arch step 5: capture the turn's usage receipt (model served, tokens, latency, fallback).
    let turnReceipt: UsageReceipt | null = null;
    const rawModelOut = await chatCompletion<string>(
      gptMessages as { role: 'system' | 'user' | 'assistant'; content: string | unknown[] }[],
      { model: modelSelection.model, temperature, maxTokens: modelSelection.maxTokens, jsonRaw: true, onReceipt: (r) => { turnReceipt = r; } }
    );
    let assistantMessage: string;
    let actions: Record<string, unknown>[];
    let envelope: { reply?: unknown; actions?: unknown } | null = null;
    try {
      const parsed = JSON.parse(rawModelOut);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && ('reply' in parsed || 'actions' in parsed)) {
        envelope = parsed as { reply?: unknown; actions?: unknown };
      }
    } catch { /* not JSON — prose fallback below */ }
    if (envelope) {
      assistantMessage = typeof envelope.reply === 'string' ? envelope.reply : '';
      actions = Array.isArray(envelope.actions) ? envelope.actions as Record<string, unknown>[] : [];
      // Defensive: a model may STILL embed <actions> tags inside reply — harvest + strip them.
      const emb = extractActions(assistantMessage);
      assistantMessage = emb.cleanMessage;
      if (emb.actions.length) actions = actions.concat(emb.actions);
    } else {
      const ex = extractActions(rawModelOut);
      assistantMessage = ex.cleanMessage;
      actions = ex.actions;
    }

    // Guardrail: sanitize medical language (Spec 12.3)
    const { clean } = sanitizeText(assistantMessage);
    assistantMessage = clean;

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

    // FIX (audit #1 CRITICAL — weight-corruption, layer 2): the MODEL itself may emit a
    // profile_update.weight_kg derived from an exercise weight, which the regex guard above
    // cannot catch. Validate any weight_kg about to be written: drop it when the user message
    // carries exercise context but no explicit bodyweight cue, or when the value is outside the
    // plausible human range (30–300 kg). This makes weight_kg writes safe on EVERY path.
    {
      // FIX (audit regression — extractActions now parses MULTIPLE <actions> blocks → there can be
      // >1 profile_update). Validate weight_kg on EVERY profile_update, back-to-front for safe splice.
      const lo = (message ?? '').toLocaleLowerCase('tr');
      const exerciseCtx = /(bench|press|squat|deadlift|curl|lat\b|biceps|triceps|halter|dumbbell|barbell|set\b|tekrar|\brep\b|kaldir|kaldır|antren|egzersiz|\d+\s*[x×]\s*\d+)/.test(lo);
      const bodyweightCue = /(kilom|kiloyum|tartil|tartıl|mevcut\s*kilo|vücut\s*ağırlığ|vucut\s*agirlig|kg\s*(oldum|geldim|düştüm|dustum|çıktım|ciktim))/.test(lo);
      for (let pi = actions.length - 1; pi >= 0; pi--) {
        if (actions[pi].type !== 'profile_update') continue;
        const pa = actions[pi] as Record<string, unknown>;
        if (pa.weight_kg == null) continue;
        const w = Number(pa.weight_kg);
        if ((exerciseCtx && !bodyweightCue) || !(w >= 30 && w <= 300)) {
          console.warn('[weight_guard] dropped ambiguous/implausible weight_kg', { weight_kg: pa.weight_kg, mode: effectiveMode });
          delete pa.weight_kg;
          if (Object.keys(pa).filter(k => k !== 'type').length === 0) actions.splice(pi, 1);
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
    // #organism: fire in ANY mode, not just register/daily_log. A real meal report ("pasta
    // yedim") buried in an emotional message routes to recovery/coaching and the meal was
    // silently DROPPED — the coach attuned but forgot to log. looksLikeMealReport is past-tense
    // so hypotheticals ("yersem") are excluded; simulation mode is skipped (what-if projections).
    if (message
      && looksLikeMealReport(message)
      && !actions.some(a => a.type === 'meal_log')
      && effectiveMode !== 'simulation') {
      console.warn('[meal_safety_net] meal intent, no meal_log action — attempting forced extraction', { mode: effectiveMode });
      const forcedAction = await forceMealLogAction(userId, message, modelSelection.model);
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
      && effectiveMode !== 'simulation') { // #organism: capture the workout in any mode, not just register
      console.warn('[workout_safety_net] workout intent, no workout_log action — attempting forced extraction');
      const forcedWorkout = await forceWorkoutLogAction(userId, message, modelSelection.model);
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
    // NOT mode-gated (#live-L14): "85 oldum" routes to 'coaching', so a register-only
    // gate dropped it. The strong-body-verb + !exerciseCtx + !goalCtx + 30-300 clamp guards
    // keep it from misfiring on exercise weights or goal/target statements.
    if (message
      && !actions.some(a => a.type === 'weight_log')
      && !actions.some(a => a.type === 'profile_update' && (a as Record<string, unknown>).weight_kg !== undefined)) {
      const mW = message.toLocaleLowerCase('tr');
      const exerciseCtx = /(bench|press|squat|deadlift|curl|lunge|set|\d+\s*tekrar|tekrar\s*\d|\brep\b|kaldir|kaldır|\d+\s*x\s*\d+|x\d)/.test(mW);
      // Strong body-weight verbs: the number IS the user's current weight.
      const strongBodyIntent = /(geldim|oldum|tartild|tartıld|tart[ıi]m|kiloyum|kilodayim|kilodayım|kiloya dust|kiloya düşt)/.test(mW);
      const bodyIntent = strongBodyIntent || /sabah/.test(mW);
      // GOAL/target statements ("hedefim 80 kiloya inmek") are NOT a weigh-in.
      const goalCtx = /(hedef|inmek ist|olmak ist|ula[sş]mak|vermek ist|atmak ist)/.test(mW);
      if (!exerciseCtx && !goalCtx && bodyIntent) {
        // Unit present (kg / standalone "kilo"), OR a unitless number when a strong
        // body-weight verb is present ("85 oldum", "86.5 kiloyum" where "kilo" has no
        // word boundary so the unit regex can't see it).
        let wm = mW.match(/\b(\d{2,3}(?:[.,]\d)?)\s*(?:kg|kilo)\b/);
        if (!wm && strongBodyIntent) wm = mW.match(/\b(\d{2,3}(?:[.,]\d)?)\b/);
        if (wm) {
          const w = parseFloat(wm[1].replace(',', '.'));
          if (w >= 30 && w <= 300) { actions.push({ type: 'weight_log', value: w }); console.warn('[weight_safety_net] weight_log injected', { w }); }
        }
      }
    }

    // Sleep-log safety net — deterministic (#R1-H4): "7 saat uyudum". #organism: any mode
    // (the "N saat uyku" regex is specific enough to be safe outside register).
    if (message
      && !actions.some(a => a.type === 'sleep_log')
      && effectiveMode !== 'simulation') {
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
    // #organism: any mode (the "su iç" + quantity regex is specific enough to be safe).
    if (message
      && !actions.some(a => a.type === 'water_log')
      && effectiveMode !== 'simulation') {
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

    // Mood-log safety net — deterministic (#live-L13): subjective feeling reports
    // ("bugün kendimi enerjik hissediyorum") are the one daily metric the model reliably
    // under-emits and that had NO backstop, so mood was silently lost. NOT mode-gated
    // (feeling statements route to 'coaching'); guarded against advice/questions.
    if (message
      && !actions.some(a => a.type === 'mood_log')) {
      const mM = message.toLocaleLowerCase('tr');
      const feelingIntent = /(hissediyorum|ruh halim|ruh hâlim|moralim|keyfim|kendimi .{0,25}hissed|modum|motivasyonum yüksek|motivasyonum düşük)/.test(mM);
      const isQuestion = /\?|nas[ıi]l hissed|hisset(meli|sem|me)|olur mu|\bm[ıiuü] y[ıiuü]m\b/.test(mM);
      if (feelingIntent && !isQuestion) {
        let score: number | null = null;
        const num = mM.match(/(\d{1,2})\s*\/\s*(5|10)/); // "ruh halim 4/5" / "moralim 8/10"
        if (num) { const v = parseInt(num[1]); score = num[2] === '10' ? Math.round(v / 2) : v; }
        if (score === null) {
          const positive = /(harika|mükemmel|mukemmel|çok iyi|cok iyi|enerjik|mutlu|keyifli|huzurlu|iyi hissed|formda|motive|pozitif|neşeli|nese)/.test(mM);
          const negative = /(kötü|kotu|berbat|üzgün|uzgun|mutsuz|yorgun|bitkin|bunal|stresli|moralim bozuk|isteksiz|halsiz|depres|kaygı|kaygi|gergin)/.test(mM);
          const neutral = /(idare eder|normal|fena de[gğ]il|ortalama|so so)/.test(mM);
          if (positive && !negative) score = /(harika|mükemmel|mukemmel|çok iyi|cok iyi)/.test(mM) ? 5 : 4;
          else if (negative && !positive) score = /(berbat|çok kötü|cok kotu|depres|bitkin)/.test(mM) ? 1 : 2;
          else if (neutral) score = 3;
        }
        if (score !== null && score >= 1 && score <= 5) {
          actions.push({ type: 'mood_log', score, note: message });
          console.warn('[mood_safety_net] mood_log injected', { score });
        }
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

    // Allergy/preference RETRACTION net — deterministic (#memory reversal). The coach explicitly
    // promises "alerjin geçtiyse söyle, güncelleyeyim", but there was NO removal path: allergen
    // rows were permanent and every plan excluded the food forever. Detects "X alerjim geçti /
    // yanlışmış / kalmadı / yok artık" and emits a clear action the handler uses to DELETE the row.
    if (message) {
      const mRet = message.toLocaleLowerCase('tr');
      // Proximity-based (a filler word can sit between): "alerjim ASLINDA geçti", "alerjim ÇOK ŞÜKÜR
      // düzeldi". A retraction keyword within ~25 chars of the allergy word, either order.
      const retractCue = /(alerj\w*|intolerans\w*)[^.!?]{0,25}(geçti|gecti|kalmadı|kalmadi|düzeldi|duzeldi|yokmuş|yokmus|yok art|iyileşti|iyilesti|bitti|yanlış|yanlis|aslında yok|aslinda yok)|(geçti|gecti|kalmadı|kalmadi|düzeldi|duzeldi|yanlış|yanlis|iyileşti|iyilesti)[^.!?]{0,20}(alerj|intolerans)/;
      if (retractCue.test(mRet) && /(alerj|intolerans)/.test(mRet)) {
        // The model frequently RE-EMITS a food_preference on a retraction (re-creating the very
        // allergen being cleared, as seen live). Strip any model food_preference this turn so the
        // clear isn't immediately undone, then inject the clear (NOT gated on their absence).
        for (let i = actions.length - 1; i >= 0; i--) {
          if ((actions[i] as Record<string, unknown>).type === 'food_preference') actions.splice(i, 1);
        }
        const declared = extractDeclaredAllergens(message); // canonical dict hits (süt→laktoz)
        const foods = new Set<string>(declared.map(f => f.toLocaleLowerCase('tr')));
        const m = mRet.match(/([a-zçğıöşü]{3,})\s+(?:alerji|intolerans)/); // single-noun ("çilek alerjim geçti")
        if (m && m[1]) foods.add(m[1].replace(/(ndan|nden|tan|ten|dan|den)$/, ''));
        for (const f of foods) if (f.length >= 3) actions.push({ type: 'food_preference', food_name: f, clear: true, is_allergen: false });
        if (foods.size > 0) console.warn('[allergy_retract_net] clear injected', { foods: [...foods] });
      }
    }

    // Dislike safety net — deterministic (#memory, Spec 5.10/5.12): "brokoli sevmiyorum",
    // "sütü sevmem", "balıktan hoşlanmıyorum", "kekten nefret ederim". Mirror of the allergy
    // net for SOFT preferences: previously a plain dislike was NEVER persisted (the model
    // skipped the food_preference action), so it never reached plan generation OR the
    // contradiction engine — asymmetric with allergens. This writes it as a non-allergen
    // dislike so later plans avoid it AND getConflictContext can flag "hani X sevmiyordun?".
    // Gated on no food_preference already present (an allergy statement isn't a plain dislike).
    if (message && !actions.some(a => (a as Record<string, unknown>).type === 'food_preference')) {
      const mDis = message.toLocaleLowerCase('tr');
      // Not a positive statement ("seviyorum", "bayılıyorum") and not an allergy (handled above).
      // The cue can be a whole word ("sevmiyorum") or a stem ("nefret ed", "hoşlanm", "tiksin").
      // NOTE: "sevmediğim" is deliberately EXCLUDED — "sevmediğim şeyleri koyma" (don't add
      // things I dislike) is a generic instruction, not a new declaration, and it captured the
      // preceding verb ("öner") as a phantom food. Real declarations use the forms below.
      const CUE_RE = /(sevmiyorum|sevmiyom|sevmem|hoşlanmıyorum|hoslanmiyorum|hoşlanmam|hoslanmam|nefret ed|iğren|igren|tiksin|hazzetm|hazetm|haz etm|yiyemiyorum|midem kaldır|midem kaldir|beğenmiyorum|begenmiyorum)/;
      const cueM = mDis.match(CUE_RE);
      if (cueM && cueM.index !== undefined && !/(alerj|intolerans)/.test(mDis)) {
        // Walk backwards from the cue over the preceding words, skipping adverbs/fillers
        // ("hiç", "pek", "çok", "artık"...) so "brokoliyi HİÇ sevmiyorum" still yields "brokoli".
        const before = mDis.slice(0, cueM.index).replace(/[^a-zçğıöşü\s]/g, ' ').trim();
        const words = before.split(/\s+/).filter(Boolean);
        // Non-food fillers/adverbs/pronouns to skip or reject.
        const SKIP = new Set(['hiç', 'hic', 'pek', 'çok', 'cok', 'artık', 'artik', 'de', 'da', 'ki', 'zerre', 'katiyen', 'asla', 'hiçbir', 'hicbir', 'bir', 'o', 'şu', 'su', 'bu', 'şunu', 'sunu', 'artik', 'gerçekten', 'gercekten', 'valla', 'ya', 'açıkçası', 'acikcasi', 'genelde', 'genellikle', 'sanırım', 'sanirim',
          // Gerund/infinitive verbs that sit between the food and the cue ("sütü İÇMEYİ sevmiyorum",
          // "balık YEMEYİ sevmem") — skip them so the real food noun two words back is picked.
          'içmeyi', 'icmeyi', 'içmek', 'icmek', 'yemeyi', 'yemek', 'yemeği', 'yemegi', 'yemesini', 'içmesini', 'icmesini', 'kullanmayı', 'kullanmayi', 'yapmayı', 'yapmayi', 'tüketmeyi', 'tuketmeyi']);
        const NONFOOD = new Set(['sen', 'seni', 'onu', 'bunu', 'beni', 'kendimi', 'kendini', 'spor', 'sporu', 'uygulama', 'uygulamayı', 'uygulamayi', 'egzersiz', 'egzersizi', 'antrenman', 'antrenmani', 'antrenmanı', 'kilo', 'kiloyu', 'diyet', 'diyeti', 'insan', 'insanları', 'insanlari', 'sabah', 'akşam', 'aksam', 'işi', 'isi', 'işimi', 'seyahat', 'yolculuk', 'kimseyi', 'onları', 'onlari',
          // Generic nouns/verbs that must never be stored as a "food" (guards phantom rows like
          // the "öner" captured from "...öner, sevmediğim şeyleri koyma").
          'öner', 'oner', 'şey', 'sey', 'şeyi', 'seyi', 'şeyler', 'seyler', 'şeyleri', 'seyleri', 'besin', 'besini', 'besinler', 'besinleri', 'yiyecek', 'yiyeceği', 'yiyecekler', 'yiyecekleri', 'gıda', 'gida', 'gıdayı', 'gidayi', 'yemekleri', 'yemeği', 'yemegi', 'bişey', 'bisey', 'birşey', 'birsey', 'hiçbirşey', 'hicbirsey', 'şunları', 'sunlari', 'bunları', 'bunlari', 'onları', 'yiyeceklerimi']);
        const VERBISH = /(mişim|mışım|muşum|müşüm|iyorum|ıyorum|uyorum|üyorum|erim|arım|ırım|irim|urum|ürüm|mek|mak|meyi|mayı)$/;
        let food: string | undefined;
        for (let i = words.length - 1; i >= 0; i--) {
          const w = words[i];
          if (SKIP.has(w) || VERBISH.test(w)) continue;
          food = w; break;
        }
        // GENTLE stem for storage: strip ONLY the unambiguous ablative (-dan/-den/-tan/-ten/
        // -ndan/-nden) so "balıktan"→"balık", "kekten"→"kek". Deliberately DON'T strip accusative
        // -yı/-yi (would turn short "çayı"→"ça" and drop it) or a bare vowel (would corrupt
        // "brokoli"→"brokol"): the contradiction MATCHER re-normalises BOTH sides at read time, so
        // a still-inflected stored form ("sütü", "brokoliyi") matches "süt"/"brokoli" logs anyway.
        if (food) food = food.replace(/(ndan|nden|tan|ten|dan|den)$/, '');
        if (food && food.length >= 3 && !SKIP.has(food) && !NONFOOD.has(food)) {
          actions.push({ type: 'food_preference', food_name: food, preference: 'dislike', is_allergen: false });
          console.warn('[dislike_safety_net] food_preference injected', { food });
        }
      }
    }

    // Preference REVERSAL / LIKE net — deterministic (#memory, Spec 5.12: "learning from
    // corrections"). The coach actively invites "artık seviyorum de, güncelleyeyim", but the model
    // rarely emits the positive food_preference action, so the old dislike row (and its
    // contradiction nag) would live forever. Detects "artık X seviyorum", "X sevmeye başladım",
    // "X'e bayılıyorum" and writes preference=like; the handler then DELETES the stale dislike.
    if (message && !actions.some(a => (a as Record<string, unknown>).type === 'food_preference')) {
      const mLik = message.toLocaleLowerCase('tr');
      const LIKE_CUE = /(seviyorum|sevmeye başla|sevmeye basla|sever oldum|bayılıyorum|bayiliyorum|çok severim|cok severim|sevdim artık|sevdim artik|artık yiyorum|artik yiyorum|artık içiyorum|artik iciyorum)/;
      const cueM = mLik.match(LIKE_CUE);
      // Require a "change of mind" signal so we don't fire on every "X seviyorum" (esp. "seni
      // seviyorum") — a reversal implies "artık/artended/fikrim değişti" or an existing dislike.
      const reversalHint = /(artık|artik|fikrim değiş|fikrim degis|fikrim değişti|fikrim degisti|değişti|degisti|sever oldum|başladım|basladim|meğer|meger)/.test(mLik);
      if (cueM && cueM.index !== undefined && reversalHint && !/(alerj|intolerans)/.test(mLik)) {
        const before = mLik.slice(0, cueM.index).replace(/[^a-zçğıöşü\s]/g, ' ').trim();
        const words = before.split(/\s+/).filter(Boolean);
        const SKIP2 = new Set(['artık', 'artik', 'çok', 'cok', 'de', 'da', 'ki', 'aslında', 'aslinda', 'galiba', 'sanırım', 'sanirim', 'bir', 'o', 'şu', 'su', 'bu', 'gerçekten', 'gercekten', 'valla', 'ya', 'açıkçası', 'acikcasi', 'meğer', 'meger', 'içmeyi', 'icmeyi', 'yemeyi', 'yemek', 'içmek', 'fikrim', 'yiyorum', 'içiyorum', 'iciyorum']);
        const NONFOOD2 = new Set(['sen', 'seni', 'onu', 'bunu', 'beni', 'kendimi', 'kendini', 'spor', 'sporu', 'egzersiz', 'antrenman', 'kilo', 'diyet', 'hayat', 'hayatı', 'seyahat', 'işimi', 'isimi', 'şey', 'sey', 'şeyi', 'seyi', 'her', 'herşey', 'hersey']);
        // Reject verb forms that can sit before the cue ("meğer yumurtayı SEVERMİŞİM, artık
        // yiyorum") — a food noun never ends in these conjugation suffixes.
        const VERBISH = /(mişim|mışım|muşum|müşüm|iyorum|ıyorum|uyorum|üyorum|erim|arım|ırım|irim|urum|ürüm|mek|mak|meyi|mayı)$/;
        let food: string | undefined;
        for (let i = words.length - 1; i >= 0; i--) { const w = words[i]; if (SKIP2.has(w) || VERBISH.test(w)) continue; food = w; break; }
        if (food) food = food.replace(/(ndan|nden|tan|ten|dan|den)$/, '');
        if (food && food.length >= 3 && !SKIP2.has(food) && !NONFOOD2.has(food) && !VERBISH.test(food)) {
          actions.push({ type: 'food_preference', food_name: food, preference: 'like', is_allergen: false });
          console.warn('[like_reversal_net] food_preference injected', { food });
        }
      }
    }

    // Injury safety net — deterministic (#R1-M5): "belimde fıtık var", "dizim ağrıyor".
    // The injury guardrail reads ONLY health_events; the model skips the health_event
    // action often enough that a chat-declared injury would otherwise protect nobody.
    // Fires only when an injury CUE word co-occurs with a recognised body part.
    if (message && !actions.some(a => (a as Record<string, unknown>).type === 'health_event')) {
      const mInj = message.toLocaleLowerCase('tr');
      // A RECOVERY statement ("belim iyileşti", "dizim düzeldi", "ağrım geçti") must NOT create a
      // fresh injury row (it contains "ağrı" and would otherwise re-flag the part) — it resolves.
      const healCue = /(iyileş|iyilest|iyilesti|düzeldi|duzeldi|toparla|geçti art|gecti art|ağrım geçti|agrim gecti|ağrı kalmadı|agri kalmadi|ağrı yok art|agri yok art|artık ağrımıyor|artik agrimiyor|şikayetim kalmadı|sikayetim kalmadi|iyiyim art)/.test(mInj);
      const injuryCue = !healCue && /(sakat|incin|burkul|fitik|fıtık|agri|ağrı|agriy|ağrıy|tutuldu|zorlan|kirec|kireç|menisk|ameliyat|koptu|zedele|yirtild|yırtıld|ağrim|agrim|sorunum var)/.test(mInj);
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

    // Injury RESOLUTION net — deterministic (#memory reversal). health_events was INSERT-only, so
    // "belim iyileşti / dizim düzeldi" never cleared is_ongoing and filterExercisesByInjury kept
    // stripping those movements from every plan forever. Detect a heal cue + a healed body part and
    // emit a resolve action the handler uses to UPDATE the matching ongoing rows to is_ongoing=false.
    if (message && !actions.some(a => (a as Record<string, unknown>).type === 'health_event' || (a as Record<string, unknown>).type === 'health_event_resolve')) {
      const mHeal = message.toLocaleLowerCase('tr');
      const healCue = /(iyileş|iyilest|iyilesti|düzeldi|duzeldi|toparla|geçti|gecti|ağrım geçti|agrim gecti|ağrı kalmadı|agri kalmadi|ağrı yok|agri yok|artık ağrımıyor|artik agrimiyor|şikayetim kalmadı|sikayetim kalmadi|iyiyim art|eski(den|si) gibi)/.test(mHeal);
      const parts = healCue ? extractInjuredBodyParts([message]) : [];
      if (parts.length > 0) {
        actions.push({ type: 'health_event_resolve', body_parts: parts, description: message.slice(0, 200) });
        console.warn('[injury_resolve_net] resolve injected', { parts });
      }
    }

    // Life-event capture net — the #organism continuity feature. A dated motivating event
    // ("3 hafta sonra kardeşimin düğünü var", "15 temmuzda tatil") is persisted to life_events so
    // the coach carries it as a COUNTDOWN across turns AND new sessions and ties the plan to it —
    // instead of forgetting it the moment the chat ends (the "different-GPT-chat-every-time" feel).
    if (message && !actions.some(a => (a as Record<string, unknown>).type === 'life_event')) {
      const le = extractLifeEvent(message, effectiveToday);
      if (le) {
        actions.push({ type: 'life_event', title: le.title, event_type: le.event_type, event_date: le.event_date, note: message.slice(0, 200) });
        console.warn('[life_event_net] captured', le);
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
      // #live-L15: cover Turkish venue-shop nouns with their case suffixes (kebapçıda/
      // dönerciye/pideciden/lokantasında) via the stem, and decouple "dışarıda" from
      // "yedim" (the words are rarely adjacent: "dışarıda kebapçıda yemek yedim").
      const SHOP_TYPES: { re: RegExp; name: string }[] = [
        { re: /(kebapç|kebapc)/, name: 'Kebapçı' },
        { re: /(dönerc|donerc)/, name: 'Dönerci' },
        { re: /(pideci|pidecis)/, name: 'Pideci' },
        { re: /(lahmacun)/, name: 'Lahmacuncu' },
        { re: /(köfteci|kofteci)/, name: 'Köfteci' },
        { re: /(çiğköfteci|cigkofteci|çiğ köfteci)/, name: 'Çiğköfteci' },
        { re: /(pizzac|pizza)/, name: 'Pizzacı' },
        { re: /(restoran|lokanta)/, name: 'Restoran' },
        { re: /(kafeterya|kafede|\bkafe\b|cafe)/, name: 'Kafe' },
      ];
      const shop = SHOP_TYPES.find(s => s.re.test(mVen));
      const eatingOut = /(d[ıi][şs]ar[ıi]da|dışarıda)/.test(mVen) && /(yedim|yemek|ye(d|t)|akşam yemeği|öğle yemeği)/.test(mVen);
      if (visited && (brand || shop || eatingOut)) {
        const venueName = brand
          ? brand.replace(/\b\w/g, (c) => c.toUpperCase())
          : (shop ? shop.name : 'Restoran');
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
      const forcedGoal = await forceGoalAction(userId, message, modelSelection.model);
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

    // <simulation> — "şunu yesem ne olur?" projection block. Parse it into a structured
    // `simulation` response field, but KEEP the block in the message: the client renders the
    // SimulationCard via parseSimulationData(message) on BOTH live and history paths and strips
    // it from the displayed text itself. (FIX audit regression: stripping server-side removed the
    // card AND lost it on history reload since the stored message would no longer carry the block.)
    const { simulation } = extractSimulation(assistantMessage);

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
          { model: modelSelection.model, temperature: 0.2, maxTokens: 8000, onReceipt: (r) => { writeTurnLog(userId, 'ai-chat', 'plan_regen', r).then(() => {}, () => {}); } },
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
        // #arch L1 (step 1b): UNION the typed SAFETY SPINE with legacy food_preferences.
        const [{ data: prefRows }, spineAllergensSnap] = await Promise.all([
          supabaseAdmin.from('food_preferences').select('food_name')
            .eq('user_id', userId).eq('is_allergen', true),
          getActiveConstraints(userId, ['allergen', 'intolerance']),
        ]);
        const allergens = [...new Set([
          ...(prefRows ?? []).map((p: { food_name: string }) => p.food_name),
          ...spineAllergensSnap.map((c) => c.subject),
        ].filter(Boolean))];
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
                { model: modelSelection.model, temperature: 0.2, maxTokens: 8000, onReceipt: (r) => { writeTurnLog(userId, 'ai-chat', 'plan_regen', r).then(() => {}, () => {}); } },
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
      } else if (expectedType === 'workout') {
        // Spec 12.2/15.7: code-enforced INJURY filter for chat-generated workout plans —
        // symmetric with the diet allergen branch above and with ai-plan/index.ts:617.
        // Without this, the chat coach could persist→activate→project a plan with
        // exercises that load an injured joint (squat/koşu/deadlift...). The diet path
        // was hardened (#journey-H); the workout path was the missing twin.
        // #arch L1 (step 1b): typed body_parts from the SAFETY SPINE UNIONed with legacy free text.
        const [{ data: injRows }, spineInjSnap] = await Promise.all([
          supabaseAdmin.from('health_events').select('description')
            .eq('user_id', userId).eq('is_ongoing', true),
          getActiveConstraints(userId, ['injury']),
        ]);
        const injuredSet = new Set<string>(extractInjuredBodyParts((injRows ?? []).map((r: { description: string }) => r.description ?? '')));
        for (const c of spineInjSnap) for (const bp of (c.body_parts ?? [])) if (bp) injuredSet.add(bp);
        const injuredParts = [...injuredSet];
        if (injuredParts.length > 0) {
          const scanInjury = (snap: Record<string, unknown>): string[] => {
            const out: string[] = [];
            for (const d of (snap.days as Array<Record<string, unknown>> | undefined) ?? []) {
              if (d.rest_day) continue;
              const names = ((d.exercises as Array<{ name?: string }> | undefined) ?? []).map(e => e.name ?? '');
              const { excluded } = filterExercisesByInjury(names, injuredParts);
              if (excluded.length > 0) out.push(...excluded.map(e => `${d.day_label ?? ''}: ${e.exercise}`));
            }
            return out;
          };
          let conflicts = scanInjury(planSnapshot);
          if (conflicts.length > 0) {
            // Force ONE exclusion regen (mirror the allergen recovery), so the model
            // can rebuild a coherent program around the injury rather than us leaving holes.
            console.warn('[plan_snapshot] injury conflict — forcing exclusion regen', { count: conflicts.length, injuredParts });
            try {
              const partsTr = injuredParts.join(', ');
              const forcedRaw = await chatCompletion<string>(
                [
                  ...(gptMessages as { role: 'system' | 'user' | 'assistant'; content: string | unknown[] }[]),
                  { role: 'user', content: `Onceki program kullanicinin SAKATLIGINI zorlayan egzersizler iceriyordu (etkilenen bolge: ${partsTr}). Bu KESIN YASAK. O bolgeyi yukleyen tum hareketleri (ornegin diz icin squat/lunge/leg press/kosu/ziplama; bel icin deadlift/good morning) plandan TAMAMEN cikar, yerine guvenli alternatif (izolasyon, yuzme, ust vucut, hafif kardiyo) koy. SIMDI yalnizca gecerli ve TAM bir <plan_snapshot>...</plan_snapshot> uret: 7 gun (day_index 0-6), her aktif gunde exercises dolu, HICBIR gunde sakat bolgeyi yukleyen hareket olmasin. "...", kisaltma, markdown KULLANMA.` },
                ],
                { model: modelSelection.model, temperature: 0.2, maxTokens: 8000, onReceipt: (r) => { writeTurnLog(userId, 'ai-chat', 'plan_regen', r).then(() => {}, () => {}); } },
              );
              const retry = extractPlanSnapshot(forcedRaw);
              if (retry.snapshot && snapshotUsable(retry.snapshot) && scanInjury(retry.snapshot).length === 0) {
                planSnapshot = retry.snapshot;
                conflicts = [];
                console.warn('[plan_snapshot] injury exclusion regen clean — using regenerated plan');
              }
            } catch (e) {
              console.error('[plan_snapshot] injury regen threw', (e as Error).message);
            }
            // Final safety net: if the regen still loads the injury, DROP the offending
            // exercises in-place so we NEVER persist an injury-loading move. The user still
            // gets a usable plan (fail-safe), matching ai-plan's drop-and-note behavior.
            if (conflicts.length > 0) {
              const dropped: string[] = [];
              for (const d of (planSnapshot.days as Array<Record<string, unknown>> | undefined) ?? []) {
                if (d.rest_day || !Array.isArray(d.exercises)) continue;
                const names = (d.exercises as Array<{ name?: string }>).map(e => e.name ?? '');
                const { safe, excluded } = filterExercisesByInjury(names, injuredParts);
                if (excluded.length > 0) {
                  const safeSet = new Set(safe);
                  d.exercises = (d.exercises as Array<{ name?: string }>).filter(e => safeSet.has(e.name ?? ''));
                  dropped.push(...excluded.map(e => e.exercise));
                }
              }
              if (dropped.length > 0) {
                (planSnapshot as Record<string, unknown>)._injury_excluded = [...new Set(dropped)];
                const note = `Sakatlik nedeniyle cikarilan egzersizler: ${[...new Set(dropped)].join(', ')}. Yerine guvenli alternatif oneriyoruz.`;
                planSnapshot.reasoning = `${(planSnapshot.reasoning as string) ?? ''} ${note}`.trim();
              }
            }
          }
        }
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
          return await commitAndRespond({
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
        // #arch L1 (step 1b): UNION the typed SAFETY SPINE with legacy food_preferences.
        const [{ data: prefRows }, spineAllergensSnap] = await Promise.all([
          supabaseAdmin.from('food_preferences').select('food_name')
            .eq('user_id', userId).eq('is_allergen', true),
          getActiveConstraints(userId, ['allergen', 'intolerance']),
        ]);
        const allergens = [...new Set([
          ...(prefRows ?? []).map((p: { food_name: string }) => p.food_name),
          ...spineAllergensSnap.map((c) => c.subject),
        ].filter(Boolean))];
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

      // FIX (audit AI-ORC-02/HIGH): re-run the INJURY guardrail on the WORKOUT draft
      // before promoting — symmetric with the allergen re-scan above. A draft may
      // predate an injury the user declared afterward; without this, approving a
      // stale workout draft promotes→activates→projects exercises that load the
      // injured joint. Mirrors the generation-time injury scan (filterExercisesByInjury).
      if (draft && expectedType === 'workout') {
        // #arch L1 (step 1b): typed body_parts from the SAFETY SPINE UNIONed with legacy free text.
        const [{ data: injRows }, spineInjSnap] = await Promise.all([
          supabaseAdmin.from('health_events').select('description')
            .eq('user_id', userId).eq('is_ongoing', true),
          getActiveConstraints(userId, ['injury']),
        ]);
        const injuredSet = new Set<string>(extractInjuredBodyParts((injRows ?? []).map((r: { description: string }) => r.description ?? '')));
        for (const c of spineInjSnap) for (const bp of (c.body_parts ?? [])) if (bp) injuredSet.add(bp);
        const injuredParts = [...injuredSet];
        if (injuredParts.length > 0) {
          const days = (draft.plan_data?.days as Array<Record<string, unknown>> | undefined) ?? [];
          const conflicts: string[] = [];
          for (const d of days) {
            if (d.rest_day) continue;
            const names = ((d.exercises as Array<{ name?: string }> | undefined) ?? []).map(e => e.name ?? '');
            const { excluded } = filterExercisesByInjury(names, injuredParts);
            if (excluded.length > 0) conflicts.push(...excluded.map(e => `${d.day_label ?? ''}: ${e.exercise}`));
          }
          if (conflicts.length > 0) {
            planPersistError = `injury_violation: ${conflicts.slice(0, 3).join('; ')}`;
            console.warn('[approve] blocked by injury guardrail', { count: conflicts.length, injuredParts });
          }
        }
      }

      if (draft && !planPersistError) {
        // FIX (audit DB/HIGH — atomic archive→promote): single SECURITY DEFINER RPC
        // transaction (migration 057 promote_weekly_plan). Archive-of-old + promote-of-draft
        // can no longer half-fail and leave 0 active plans or an orphaned archived row.
        // Snapshot profile/goal for drift detection BEFORE promotion (passed into the RPC).
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
        // FIX (audit DB-PRM-01): atomically CONSUME the free-tier plan slot BEFORE promoting, so two
        // concurrent approvals can't both pass the lifetime cap (the old pre-check read + post-promote
        // increment was a lost-update). Premium is uncapped. The RPC row-locks profiles, re-checks the
        // per-type cap and increments in one tx; false ⇒ cap already used (this concurrent attempt lost).
        if (!gateActive) {
          const { data: slotOk, error: slotErr } = await supabaseAdmin.rpc('consume_free_plan_slot', { p_user: userId, p_plan_type: expectedType });
          if (slotErr || slotOk !== true) planPersistError = 'free_quota_used';
        }
        const { data: activatedId, error: promoteErr } = planPersistError
          ? { data: null, error: null }
          : await supabaseAdmin.rpc('promote_weekly_plan', {
              p_user: userId,
              p_plan_type: expectedType,
              p_draft_id: draft.id,
              p_snapshot: approval_snapshot,
            });
        if (planPersistError) {
          // free_quota_used (or a prior error) — the slot was not granted; do NOT promote.
        } else if (promoteErr) {
          console.warn('[approve] atomic promote failed', promoteErr);
          planPersistError = `promote failed: ${promoteErr.message}`;
        } else {
          planApproved = activatedId ? { id: activatedId as string } : null;
            // plans_used_free was already incremented atomically by consume_free_plan_slot above.

            // ROOT FIX (Option A): project the now-active weekly_plans snapshot(s) into
            // daily_plans so the dashboard/context/reports (which only read daily_plans)
            // actually see the chat-created plan. BEST-EFFORT: any failure here must NOT
            // block the already-successful approval or change the response.
            try {
              // a. Fetch BOTH active plans (the just-approved one is one of them).
              const { data: activePlans } = await supabaseAdmin
                .from('weekly_plans')
                .select('plan_type, plan_subtype, plan_data, week_start')
                .eq('user_id', userId)
                .eq('status', 'active');
              // FIX (audit regression — migration 055): after weekly_menu isolation a user can have
              // TWO active diet rows (core: plan_subtype NULL, legacy menu: plan_subtype='weekly_menu').
              // Project ONLY the chat-approved core diet — picking the flat-array weekly_menu row would
              // make isUsableDietShape reject it and silently drop the real diet projection.
              const dietRow = (activePlans ?? []).find((p: { plan_type: string; plan_subtype?: string | null }) => p.plan_type === 'diet' && p.plan_subtype !== 'weekly_menu') as
                | { plan_type: string; plan_data: DietPlanData; week_start: string }
                | undefined;
              const workoutRow = (activePlans ?? []).find((p: { plan_type: string; plan_subtype?: string | null }) => p.plan_type === 'workout' && p.plan_subtype !== 'weekly_menu') as
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
                // FIX (audit DB/HIGH — atomic projection via RPC, migration 057/058):
                // delete-range + insert run in ONE transaction so a failed insert can never
                // leave the week with zero daily_plans rows (empty "kalan kalori" dashboard).
                const { error: projErr2 } = await supabaseAdmin.rpc('project_daily_plans', {
                  p_user: userId,
                  p_lower: lowerBound,
                  p_end: weekEnd,
                  p_rows: writeRows,
                });
                if (projErr2) {
                  console.error('[approve][projection] atomic projection failed', projErr2);
                } else {
                  console.log(`[approve][projection] wrote ${writeRows.length} daily_plans rows (${lowerBound}..${weekEnd})`);
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
    const actionFeedback = await executeActions(userId, actions, profile?.gender, (target_date as string | undefined) ?? effectiveToday, inputSource, idempotency_key as string | undefined);

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
      // #arch (audit output-scan-gap): the plan <reasoning> block is stripped from the reply and
      // returned separately as plan_reasoning, so a food/exercise rationale there (e.g. "peanut
      // butter for protein" to a peanut-allergic user) reached the user UN-scanned. Scan the
      // reasoning too — detection runs over the combined text; warnings still append to the reply.
      const scanText = planReasoning ? `${assistantMessage}\n${planReasoning}` : assistantMessage;
      // #arch L1 (step 1b): the output-side safety scan reads the typed SAFETY SPINE
      // (user_constraints), UNIONed with the legacy stores so nothing un-migrated slips through.
      const [{ data: allergenRows }, { data: injuryRows }, spineAllergens, spineInjuries] = await Promise.all([
        supabaseAdmin.from('food_preferences').select('food_name').eq('user_id', userId).eq('is_allergen', true),
        supabaseAdmin.from('health_events').select('description').eq('user_id', userId).eq('is_ongoing', true),
        getActiveConstraints(userId, ['allergen', 'intolerance']),
        getActiveConstraints(userId, ['injury']),
      ]);
      const allergens = [...new Set([
        ...(allergenRows ?? []).map((r: { food_name: string }) => r.food_name),
        ...spineAllergens.map((c) => c.subject),
      ].filter(Boolean))];
      // #live-L4: ALWAYS run the allergen scan (never skip on a blanket /alerj/ substring).
      // The model can write an "(alerjisi yoksa)" disclaimer while STILL recommending the
      // banned food — that conditional is dangerous, not a decline. Suppress the warning
      // ONLY when every matched allergen food sits next to a real DECLINE phrase
      // (önermiyorum/kaçın/yerine...). "yoksa" and bare "alerji" do NOT count as a decline.
      const DECLINE = /(önermiyor|onermiyor|öneremem|oneremem|kaçın|kacin|içermez|icermez|yerine|uygun değil|uygun degil|uzak dur|tüketme|tuketme|çıkar|cikar|eklemedim|kullanmad|hariç|haric|kullanma)/;
      if (allergens.length > 0) {
        const scan = checkAllergens(scanText, allergens);
        if (!scan.passed) {
          const lowerReply = scanText.toLocaleLowerCase('tr');
          // Resolve displayed name via the SAME category expansion checkAllergens uses so a
          // category allergen ("deniz ürünleri") triggered by a member food ("somon") is
          // named correctly instead of the literal "alerjen" (#R1-L5).
          const matched = allergens.filter(a => {
            const aName = a.toLocaleLowerCase('tr');
            const tokens = [aName, ...((ALLERGEN_FOODS as Record<string, string[]>)[aName] ?? [])];
            return tokens.some(t => t.length >= 3 && lowerReply.includes(t));
          });
          // FIX (audit AI/HIGH — allergen exit-warning false-negative): the warning was
          // suppressed if ANY token's FIRST occurrence sat next to a decline phrase. That let a
          // 2nd (actually-recommended) mention of the allergen — or an unrelated nearby decline
          // word — wrongly silence the warning. Fail-safe: an allergen is "addressed" ONLY if
          // EVERY occurrence of EVERY present token sits next to a decline phrase.
          const addressed = matched.length > 0 && matched.every(a => {
            const aName = a.toLocaleLowerCase('tr');
            const tokens = [aName, ...((ALLERGEN_FOODS as Record<string, string[]>)[aName] ?? [])].filter(t => t.length >= 3);
            return tokens.every(t => {
              let from = 0;
              let i = lowerReply.indexOf(t, from);
              while (i >= 0) {
                if (!DECLINE.test(lowerReply.slice(Math.max(0, i - 50), i + t.length + 50))) return false;
                from = i + t.length;
                i = lowerReply.indexOf(t, from);
              }
              return true;
            });
          });
          if (!addressed) {
            const names = matched.length > 0 ? matched.join(', ') : 'alerjen';
            assistantMessage += `\n\n⚠️ Dikkat: profilinde ${names} alerjisi kayıtlı — yukarıdaki öneri buna uygun olmayabilir. Sana uygun bir alternatif isteyebilirsin.`;
          }
        }
      }
      const injuredSet = new Set<string>(extractInjuredBodyParts((injuryRows ?? []).map((r: { description: string }) => r.description)));
      for (const c of spineInjuries) for (const bp of (c.body_parts ?? [])) if (bp) injuredSet.add(bp);
      const injuredParts = [...injuredSet];
      if (injuredParts.length > 0) {
        const conflicts = findInjuryConflictsInText(scanText, injuredParts);
        if (conflicts.length > 0) {
          // Same logic: warn unless EVERY conflicting movement sits next to a decline/
          // alternative phrase. A blanket "sakatl" mention is not a decline (#live-L4).
          const lowerReply = scanText.toLocaleLowerCase('tr');
          const INJ_DECLINE = /(yerine|kaçın|kacin|önermiyor|onermiyor|öneremem|yapma|alternatif|uzak dur|uygun değil|uygun degil|çıkar|cikar|atla)/;
          // FIX (audit AI/HIGH — same first-occurrence false-negative as allergens): a movement
          // is "addressed" only if EVERY occurrence sits next to a decline/alternative phrase.
          const addressed = conflicts.every(c => {
            const t = c.toLocaleLowerCase('tr');
            if (!t) return true; // defensive: empty token would make indexOf('') loop forever
            let i = lowerReply.indexOf(t);
            if (i < 0) return false;
            let from = 0;
            i = lowerReply.indexOf(t, from);
            while (i >= 0) {
              if (!INJ_DECLINE.test(lowerReply.slice(Math.max(0, i - 50), i + t.length + 50))) return false;
              from = i + t.length;
              i = lowerReply.indexOf(t, from);
            }
            return true;
          });
          if (!addressed) {
            assistantMessage += `\n\n⚠️ Not: kayıtlı sakatlığın nedeniyle ${conflicts.join(', ')} hareket(ler)i senin için riskli olabilir. İstersen sakatlık-dostu bir alternatif programlayalım.`;
          }
        }
      }

      // Deterministic CONTRADICTION surfacing (#memory, Spec 5.10) — the "hani X sevmiyordun?"
      // behaviour. getConflictContext already detected that the user LOGGED a food they earlier
      // disliked (or is allergic to) and put a "## CELISKILER" block in the prompt, but in
      // register/terse mode the model often just logs the calories and drops the note. Mirror the
      // allergen/injury nets: if the alert fired and the reply doesn't already raise it, append it.
      const conflictStr = serviceCtx?.conflicts ?? '';
      if (conflictStr) {
        const lowerReply = assistantMessage.toLocaleLowerCase('tr');
        // Only count it "already raised" if the reply SPECIFICALLY calls out the contradiction —
        // NOT the generic "sevmediğin besinleri içermiyor" (that's a relative clause, not a callout,
        // and was false-suppressing the nudge). Require the past-habit callout phrasing.
        const alreadyRaised = /(hani\s|sevmiyordun|sevmezdin|fikrin mi deg|fikrin mi değ|canın mı çek|canin mi cek|çelişki|celiski)/.test(lowerReply);
        // ALERJEN CELISKISI (user logged an allergen food) — urgent, always surface.
        const allergenHits = [...conflictStr.matchAll(/ALERJEN CELISKISI: "([^"]+)" alerjenin var/g)].map(m => m[1]);
        if (allergenHits.length > 0 && !/(alerj|intolerans)/.test(lowerReply)) {
          assistantMessage += `\n\n⚠️ Bir saniye — profilinde ${[...new Set(allergenHits)].join(', ')} alerjin/intoleransın kayıtlı ama şimdi bunu içeren bir şey girdin. İyi misin? Alerjin geçtiyse ya da yanlış kaydettiysem söyle, güncelleyeyim.`;
        }
        // SEVMEME CELISKISI (user logged a disliked food) — gentle nudge.
        const dislikeHits = [...conflictStr.matchAll(/SEVMEME CELISKISI: Kullanici daha once "([^"]+)"/g)].map(m => m[1]);
        if (dislikeHits.length > 0 && !alreadyRaised) {
          const names = [...new Set(dislikeHits)].join(', ');
          assistantMessage += `\n\nBu arada — hani ${names} sevmiyordun? 🙂 Canın mı çekti yoksa fikrin mi değişti? Fikrin değiştiyse "artık seviyorum" de, tercihini güncelleyeyim.`;
        }
        // KISITLAMA / DIYET-MODU / ALKOL CELISKISI (user logged food violating a stored
        // restriction/diet-mode/no-alcohol stance) — the same register-mode drop risk. Surface
        // once, gently, only if the reply doesn't already raise it.
        const raisedRestriction = /(hani|kısıtlama|kisitlama|vejetaryen|vegan|helal|keto|karbonhidrat|içmiyordun|icmiyordun|alkol)/.test(lowerReply);
        if (!raisedRestriction) {
          const restrHits = [...conflictStr.matchAll(/KISITLAMA CELISKISI: Kullanici "([^"]+)" olarak kayitli ama simdi "([^"]+)" girdi/g)];
          if (restrHits.length > 0) {
            assistantMessage += `\n\nUfak bir hatırlatma — "${restrHits[0][1]}" olarak kayıtlısın ama ${restrHits[0][2]} girdin. Kısıtlaman değiştiyse söyle, güncelleyeyim; yoksa uygun bir alternatif bulalım.`;
          }
          const dietHits = [...conflictStr.matchAll(/DIYET-MODU CELISKISI: "([^"]+)" modundasin ama "([^"]+)"/g)];
          if (restrHits.length === 0 && dietHits.length > 0) {
            assistantMessage += `\n\nBu arada — ${dietHits[0][1]} modundasın ama ${dietHits[0][2]} girdin. Bir kerelik mi, yoksa modu gözden mi geçirelim?`;
          }
          const alcHits = [...conflictStr.matchAll(/ALKOL CELISKISI: Kullanici alkol almadigini belirtmisti ama "([^"]+)" girdi/g)];
          if (alcHits.length > 0) {
            assistantMessage += `\n\nHer şey yolunda mı? Alkol almadığını söylemiştin ama ${alcHits[0][1]} girdin — yargılamıyorum, sadece kontrol ediyorum. 🙂`;
          }
        }
        // KAFEIN + IF-PENCERE CELISKISI — softer nudges the terse register mode may drop.
        const caffHits = [...conflictStr.matchAll(/KAFEIN CELISKISI: Kullanici kafein tuketmedigini belirtmisti ama "([^"]+)" girdi/g)];
        if (caffHits.length > 0 && !/(kafein|kahve içmiyor|kahve icmiyor)/.test(lowerReply)) {
          assistantMessage += `\n\nUfak not — kafein tüketmediğini söylemiştin ama ${caffHits[0][1]} girdin. Ara sıra mı, yoksa alışkanlığın mı değişti? 🙂`;
        }
        const ifHits = [...conflictStr.matchAll(/IF-PENCERE CELISKISI: Yeme penceren ([0-9:]+-[0-9:]+)/g)];
        if (ifHits.length > 0 && !/(pencere|oruç|oruc|if )/.test(lowerReply)) {
          assistantMessage += `\n\nBu arada — yeme pencereni (${ifHits[0][1]}) biraz aşmış olabilirsin. Arada bir olur, kendini sıkma; ama düzenini korumak istersen not düşeyim dedim. 🙂`;
        }
        // SAKATLIK CELISKISI (user logged an exercise loading an on-file injury) — safety nudge.
        const injHits = [...conflictStr.matchAll(/SAKATLIK CELISKISI: Kullanici "([^"]+)" yapmis ama kayitli sakatligi \(([^)]+)\)/g)];
        if (injHits.length > 0 && !/(sakatlı|sakatli|iyileşti mi|iyilesti mi|ağrı yaptı|agri yapti|dikkatli ol)/.test(lowerReply)) {
          assistantMessage += `\n\n⚠️ Dikkat — ${injHits[0][1]} yaptığını yazdın ama kayıtlı ${injHits[0][2]} sakatlığın bu hareketi zorlayabilir. Ağrı yaptı mı? İyileştiyse "iyileşti" de, kaydını güncelleyeyim; yoksa daha güvenli bir alternatif bulalım.`;
        }
      }
    } catch (e) {
      console.error('[output_safety_scan] failed:', (e as Error).message);
    }

    // #live-L6: surface the medium-severity ED professional-support referral deterministically
    // (don't trust the LLM to include it). Skip if the reply already points to a professional.
    if (edMediumReferral && !/(diyetisyen|psikolog|profesyonel destek|uzman)/i.test(assistantMessage)) {
      assistantMessage += '\n\n' + edMediumReferral;
    }

    // Store messages with token count and model version (Spec 5.25)
    const tokenEstimate = Math.round((message?.length ?? 0) / 3.5) + Math.round(assistantMessage.length / 3.5);
    // FIX (audit AI-MDL-05): pass the reserved user-row id so storeMessages appends ONLY the
    // assistant reply (and backfills the user row's task_mode) instead of inserting a SECOND
    // user row. When null (photo-only / reservation-insert fallback) it inserts both rows as before.
    await storeMessages(userId, message ?? '[foto]', assistantMessage, taskMode, modelSelection.model, tokenEstimate, actions, session_id, reservedUserMessageId);
    // FIX (audit AI-MDL-05): the turn is now persisted (assistant reply appended to the reserved
    // row's conversation). Clear the handle so a throw in the post-store steps below does NOT
    // make the catch release an already-answered, legitimately-counted message.
    reservedUserMessageId = null;

    // #arch step 5: write the append-only turn ledger (fail-loud, never breaks the turn). Captures
    // the served model / tokens / latency / fallback (from the openai.ts receipt) plus the code-side
    // guard verdict, so cost, silent model-downgrades, and safety-net firings are finally observable.
    try {
      const guardVerdict = edMediumReferral ? 'ed_referral'
        : /alerjin?\/intolerans|alerjisi kayıtlı|alerjin\/intoleransın/i.test(assistantMessage) ? 'allergen_warned'
        : /sakatlığın nedeniyle|sakatlığın bu hareketi/i.test(assistantMessage) ? 'injury_warned'
        : 'clean';
      const rc = turnReceipt as UsageReceipt | null;
      const { error: ledgerErr } = await supabaseAdmin.from('ai_turn_log').insert({
        user_id: userId,
        function_name: 'ai-chat',
        system_mode: taskMode,
        model_requested: rc?.modelRequested ?? modelSelection.model,
        model_served: rc?.modelServed ?? modelSelection.model,
        prompt_tokens: rc?.promptTokens ?? 0,
        completion_tokens: rc?.completionTokens ?? 0,
        total_tokens: rc?.totalTokens ?? 0,
        latency_ms: rc?.latencyMs ?? 0,
        finish_reason: rc?.finishReason ?? null,
        fallback_reason: rc?.fallbackReason ?? null,
        attempts: rc?.attempts ?? 1,
        guard_verdict: guardVerdict,
      });
      if (ledgerErr) console.error('[ai_turn_log] insert failed:', ledgerErr.message);
    } catch (e) { console.error('[ai_turn_log] write threw:', (e as Error).message); }

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

    const responseData = {
      message: assistantMessage,
      actions: outActions,
      task_mode: taskMode,
      task_completion: validatedCompletion,
      plan_snapshot: persistedPlan,
      plan_reasoning: planReasoning,
      plan_persist_error: planPersistError,
      plan_approved: planApproved,
      navigate_to: finalNavigateTo,
      simulation,
      // FIX (audit UX-CHT-05/UX-PRM-02/UX-PRM-05): surface the SERVER's authoritative
      // remaining-message count on EVERY successful send so the client badge tracks the
      // real daily quota instead of a divergent local counter (which skipped photo/log/chip
      // sends and counted record-parses the server exempts). -1 means unlimited/exempt
      // (premium, onboarding, or record-parse) — the client treats that as "don't show".
      remaining: rateLimit.remaining,
    };
    // #arch step 4: commit the exact response so a still-in-flight retry replays THIS, not a re-run.
    return await commitAndRespond(responseData);
  } catch (err) {
    const msg = (err as Error).message;
    console.error('[ai-chat] unhandled error:', err); // full detail stays server-side
    // FIX (audit AI-MDL-05): generation/processing threw AFTER we reserved (inserted) the user
    // row but BEFORE the assistant reply was stored. Release the orphaned reservation so a failed
    // turn doesn't permanently consume a daily-cap slot (mirrors the pre-fix behavior where a
    // failed send stored no rows and thus burned no quota).
    if (reservedUserMessageId) {
      await supabaseAdmin.from('chat_messages').delete().eq('id', reservedUserMessageId).then(() => {}, () => {});
      reservedUserMessageId = null;
    }
    // #arch step 4: release the journal claim so a retry reclaims + reprocesses (not stuck polling).
    if (journalKey) { await failRequest(journalUserId, journalKey); journalKey = ''; }
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

// ── Request journal (target-arch step 4 / audit finding 9) ─────────────────────────────────────
// The client retries a send with the SAME idempotency_key on its 20s timeout while the first
// attempt keeps running server-side. These helpers make a logical send execute EXACTLY ONCE:
// the first caller becomes the owner; a concurrent retry WAITS for the owner to commit and REPLAYS
// its stored response (no 2nd LLM call, no duplicate chat_messages/ai_turn_log). Replaces the old
// late in-executeActions UNIQUE guard, which only stopped double ACTION writes.
const REQUEST_LEASE_MS = 90_000;
type ClaimResult = { mode: 'owner' } | { mode: 'replay'; envelope: unknown };

async function claimOrAwaitRequest(userId: string, key: string): Promise<ClaimResult> {
  // Try to become the owner via a UNIQUE insert.
  const { error: insErr } = await supabaseAdmin.from('processed_chat_requests').insert({
    user_id: userId, idempotency_key: key, state: 'in_flight',
    lease_expires_at: new Date(Date.now() + REQUEST_LEASE_MS).toISOString(),
  });
  if (!insErr) return { mode: 'owner' };
  // Conflict — another attempt owns/owned this key. Poll (bounded, under the client's 20s attempt
  // timeout) for it to commit, then replay its exact answer.
  for (let i = 0; i < 22; i++) {
    const { data: row } = await supabaseAdmin.from('processed_chat_requests')
      .select('state, response_envelope, lease_expires_at')
      .eq('user_id', userId).eq('idempotency_key', key).maybeSingle();
    if (!row) break; // vanished — reclaim
    if (row.state === 'committed' && row.response_envelope) return { mode: 'replay', envelope: row.response_envelope };
    if (row.state === 'failed') break; // original failed — reclaim
    if (row.lease_expires_at && new Date(row.lease_expires_at as string).getTime() < Date.now()) break; // stale — reclaim
    await new Promise((r) => setTimeout(r, 800));
  }
  // Owner is stuck / failed / gone: reclaim the lease and process ourselves (best-effort).
  await supabaseAdmin.from('processed_chat_requests').update({
    state: 'in_flight', lease_expires_at: new Date(Date.now() + REQUEST_LEASE_MS).toISOString(), updated_at: new Date().toISOString(),
  }).eq('user_id', userId).eq('idempotency_key', key);
  return { mode: 'owner' };
}

async function commitRequestEnvelope(userId: string, key: string, envelope: unknown): Promise<void> {
  try {
    await supabaseAdmin.from('processed_chat_requests').update({
      state: 'committed', response_envelope: envelope, committed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('user_id', userId).eq('idempotency_key', key);
  } catch (e) { console.warn('[request_journal] commit failed', (e as Error).message); }
}

async function failRequest(userId: string, key: string): Promise<void> {
  try {
    await supabaseAdmin.from('processed_chat_requests').update({ state: 'failed', updated_at: new Date().toISOString() })
      .eq('user_id', userId).eq('idempotency_key', key).eq('state', 'in_flight');
  } catch { /* best-effort */ }
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
  const actions: Record<string, unknown>[] = [];
  // FIX (audit AI-HIGH): parse ALL <actions> blocks, not just the first. The model
  // intermittently emits a second block (e.g. profile_update then meal_log); previously
  // only the first was parsed AND the non-global replace left the second block leaking
  // verbatim into the user-facing reply.
  for (const m of text.matchAll(/<actions>([\s\S]*?)<\/actions>/g)) {
    try {
      const parsed = JSON.parse(m[1]);
      if (Array.isArray(parsed)) actions.push(...parsed);
      else actions.push(parsed);
    } catch { /* ignore unparseable block */ }
  }
  return { cleanMessage: text.replace(/<actions>[\s\S]*?<\/actions>/g, '').trim(), actions };
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
  const ate = /\b(yedim|yedik|yemistim|yemiştim|ictim|icmistim|atistirdim|tukettim|kahvalti yaptim|yuttum|kemirdim|mideye indirdim|kacamak yaptim|kaçamak yaptım|yiyip bitirdim)\b/.test(m)
    || /\b(içtim|içmiştim|atıştırdım|tükettim)\b/.test(m)
    // "paketi/kutuyu/tabağı/dilimi bitirdim" = ate it (container/portion + bitir), so "işi
    // bitirdim" (finished work) never matches.
    || /(paket|kutu|tabak|tabağ|kase|kâse|dilim|porsiyon|bardak|kavanoz|torba)[a-zçğıöşü]*\s*(?:[a-zçğıöşü]+\s+){0,3}bitir/.test(m);
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
  userId: string,
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
    let rc: UsageReceipt | null = null;
    raw = await chatCompletion<string>(
      [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: message },
      ],
      { model, temperature: 0.2, maxTokens: 600, onReceipt: (r) => { rc = r; } },
    );
    writeTurnLog(userId, 'ai-chat', 'force_meal_extract', rc).then(() => {}, () => {});
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
  userId: string,
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
    let rc: UsageReceipt | null = null;
    raw = await chatCompletion<string>(
      [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: message },
      ],
      { model, temperature: 0.2, maxTokens: 500, onReceipt: (r) => { rc = r; } },
    );
    writeTurnLog(userId, 'ai-chat', 'force_workout_extract', rc).then(() => {}, () => {});
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
  userId: string,
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
    let rc: UsageReceipt | null = null;
    raw = await chatCompletion<string>(
      [
        { role: 'system', content: systemInstruction },
        { role: 'user', content: message },
      ],
      { model, temperature: 0.1, maxTokens: 200, onReceipt: (r) => { rc = r; } },
    );
    writeTurnLog(userId, 'ai-chat', 'force_goal_extract', rc).then(() => {}, () => {});
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
    // FIX (audit #1 CRITICAL — weight-corruption): even in onboarding/full extraction, a bare
    // "NN kg" inside an EXERCISE statement ("4x8 bench press 70kg") was misread as bodyweight
    // and silently overwrote profiles.weight_kg, corrupting TDEE/calorie/protein targets.
    // Skip the current-weight extraction entirely when the message carries exercise context,
    // mirroring the target-weight guard above. An unambiguous bodyweight statement ("kilom 72")
    // has no exercise tokens, so it still persists.
    const exerciseCtx = /(bench|press|squat|deadlift|curl|lat\b|biceps|triceps|halter|dumbbell|barbell|set\b|tekrar|\brep\b|kaldir|kaldır|antren|egzersiz|\d+\s*[x×]\s*\d+)/.test(lower);
    // #R3-net: the bare "NN kg/kilo" alternative must require the unit to END at a word
    // boundary, else "kilo" matches the PREFIX of "kilom" in "boyum 182 kilom 88" and the
    // leftmost match grabs the HEIGHT (182) as weight. The "kilo\w* NN" alt (2nd) then
    // correctly captures the real weight (88) that FOLLOWS "kilom". (kiloyum listed
    // explicitly so "88 kiloyum" still matches despite the suffix.)
    const currentMatch = exerciseCtx ? null : lower.match(/mevcut\s*kilo\w*\s*[:=]?\s*(\d{2,3}(?:\.\d)?)|kilo\w*\s*[:=]?\s*(\d{2,3}(?:\.\d)?)|(\d{2,3}(?:\.\d)?)\s*(?:kg|kiloyum|kilo)\b/);
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
  for (const day of (snap.days as Array<Record<string, unknown>> | undefined) ?? []) {
    const meals = (day.meals as Array<Record<string, unknown>> | undefined) ?? [];
    if (meals.length === 0) continue;
    const daySum = meals.reduce((s, m) => s + (Number(m.total_kcal) || 0), 0);
    // Rescale meals/items toward the day target ONLY when the meal sum drifts >12% and the
    // target is valid (under-fill correction, #R2-H3). Skipping this when already on-target
    // is correct — but the day-rollup recompute below must still run.
    if (Number.isFinite(tgt) && tgt > 0 && daySum > 0 && Math.abs(daySum - tgt) / tgt > 0.12) {
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
    // #live-L3: ALWAYS recompute the day rollup from its (possibly rescaled) meals so the
    // snapshot is internally consistent (day.total_* == sum(meals.total_*)). The LLM emitted
    // day totals undershooting the meal sum by 25-45%; they were stored + rendered verbatim
    // (FullPlanModal/PlanPreviewCard). Only overwrite when the meal sum is meaningful so a
    // day whose meals carry no per-meal totals isn't zeroed.
    const sumBy = (key: string) => Math.round(meals.reduce((s, m) => s + (Number(m[key]) || 0), 0));
    const kcalSum = sumBy('total_kcal');
    if (kcalSum > 0) {
      day.total_kcal = kcalSum;
      day.total_protein = sumBy('total_protein');
      day.total_carbs = sumBy('total_carbs');
      day.total_fat = sumBy('total_fat');
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

// FIX (audit AI/HIGH): <simulation> had no server-side extractor, so the raw JSON
// block leaked through `message` to any consumer that doesn't strip it itself (older
// clients, future readers). Mirror extractNavigateTo: parse the block, validate it
// against the client SimulationData shape, STRIP it from the user-facing message
// (global — the prompt only emits one, but be defensive against duplicates), and
// surface the parsed object as a separate response field. simulation mode is
// projection-only (no persistence), so there is nothing to write — just clean + carry.
interface SimulationBlock {
  foodName: string;
  calories: number;
  remaining: number;
  weeklyImpact: string;
}

function extractSimulation(text: string): { cleanMessage: string; simulation: SimulationBlock | null } {
  const match = text.match(/<simulation>([\s\S]*?)<\/simulation>/);
  if (!match) return { cleanMessage: text, simulation: null };
  let parsed: SimulationBlock | null = null;
  try {
    const obj = JSON.parse(match[1]);
    if (obj && typeof obj.foodName === 'string' && typeof obj.calories === 'number'
      && typeof obj.remaining === 'number' && typeof obj.weeklyImpact === 'string') {
      parsed = obj as SimulationBlock;
    }
  } catch { /* malformed JSON, drop silently — never surface raw block to the user */ }
  return {
    cleanMessage: text.replace(/<simulation>[\s\S]*?<\/simulation>/g, '').trim(),
    simulation: parsed,
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

async function storeMessages(userId: string, userMsg: string, assistantMsg: string, taskMode?: string, modelUsed?: string, tokenCount?: number, executedActions?: Record<string, unknown>[], externalSessionId?: string, reservedUserMessageId?: string | null) {
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

  // FIX (audit AI-MDL-05): when the user row was already inserted up-front as a rate-limit
  // RESERVATION, do NOT insert a second user row — append only the assistant reply, and backfill
  // the reserved row's session_id/task_mode so it shares the conversation we just resolved.
  if (reservedUserMessageId) {
    const patch: Record<string, unknown> = {};
    if (sessionId) patch.session_id = sessionId;
    if (taskMode) patch.task_mode = taskMode;
    if (Object.keys(patch).length > 0) {
      await supabaseAdmin.from('chat_messages').update(patch).eq('id', reservedUserMessageId);
    }
    await supabaseAdmin.from('chat_messages').insert({
      user_id: userId, session_id: sessionId, role: 'assistant', content: assistantMsg,
      task_mode: taskMode, model_version: modelUsed ?? null,
      token_count: tokenCount ?? null,
      actions_executed: executedActions?.length ? executedActions.map(a => ({ type: a.type })) : null,
    });
  } else {
    await supabaseAdmin.from('chat_messages').insert([
      { user_id: userId, session_id: sessionId, role: 'user', content: userMsg, task_mode: taskMode },
      {
        user_id: userId, session_id: sessionId, role: 'assistant', content: assistantMsg,
        task_mode: taskMode, model_version: modelUsed ?? null,
        token_count: tokenCount ?? null,
        actions_executed: executedActions?.length ? executedActions.map(a => ({ type: a.type })) : null,
      },
    ]);
  }

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
  inputMethod: 'text' | 'photo' | 'barcode' | 'voice' | 'template' | 'ai_chat' = 'ai_chat',
  idempotencyKey?: string,
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

  // #arch step 4: idempotency is now owned by the REQUEST JOURNAL at the handler entry
  // (claimOrAwaitRequest) — a concurrent retry never reaches executeActions (it replays the owner's
  // committed response instead), so only the single owner runs the loop and actions apply exactly
  // once. The old late UNIQUE-insert guard here is retired (re-claiming would collide with the
  // handler's own in_flight row and wrongly skip every action). idempotencyKey kept for signature
  // compatibility.
  void idempotencyKey;

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
            // #arch L1 (step 1b): UNION the typed SAFETY SPINE with legacy food_preferences.
            const [{ data: legacyAllg }, spineAllg] = await Promise.all([
              supabaseAdmin.from('food_preferences').select('food_name, allergen_severity')
                .eq('user_id', userId).eq('is_allergen', true),
              getActiveConstraints(userId, ['allergen', 'intolerance']),
            ]);
            const allgMap = new Map<string, string | undefined>();
            for (const a of (legacyAllg ?? []) as Array<{ food_name: string; allergen_severity?: string }>) {
              if (a.food_name) allgMap.set(a.food_name, a.allergen_severity);
            }
            for (const c of spineAllg) if (c.subject) allgMap.set(c.subject, c.severity ?? undefined);
            const allergens = [...allgMap.entries()].map(([food_name, allergen_severity]) => ({ food_name, allergen_severity }));
            if (allergens && allergens.length > 0) {
              // FIX (audit AI-ORC-03/HIGH): use checkAllergens (category→member expansion
              // via ALLERGEN_FOODS) instead of a naive substring match. The old `.includes`
              // missed category allergens — a "deniz ürünleri" allergen never fired for a
              // logged member food like "somon"/"karides". checkAllergens expands the category.
              const itemText = items.map(i => (i.name ?? '')).join(' ');
              const matched = (allergens as Array<{ food_name: string; allergen_severity?: string }>).filter(
                a => !checkAllergens(itemText, [a.food_name]).passed
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

          // #live-L2: item-overlap de-dupe. When the user says "1 muz daha yedim", the model
          // often RESTATES the whole meal-so-far (yumurta+ekmek+süt+muz) as a fresh meal_log,
          // double-counting the already-logged items (+83% overcount). The exact-text guard
          // above misses it because the restated text differs. Drop items that already exist
          // in a recent same-day same-meal-type meal so only genuinely-new items are inserted.
          let mealItems = items;
          if (items?.length) {
            const { data: recent } = await supabaseAdmin
              .from('meal_logs').select('id')
              .eq('user_id', userId).eq('meal_type', mealType).eq('logged_for_date', actionDate)
              .eq('is_deleted', false)
              .gte('logged_at', new Date(Date.now() - 15 * 60 * 1000).toISOString())
              .order('logged_at', { ascending: false }).limit(1);
            const recentId = recent?.[0]?.id as string | undefined;
            if (recentId) {
              const { data: exItems } = await supabaseAdmin
                .from('meal_log_items').select('food_name').eq('meal_log_id', recentId);
              const existingNames = new Set((exItems ?? []).map((r: { food_name: string }) => (r.food_name ?? '').toLocaleLowerCase('tr').trim()));
              if (existingNames.size > 0) {
                const filtered = items.filter(i => !existingNames.has((i.name ?? '').toLocaleLowerCase('tr').trim()));
                if (filtered.length < items.length) {
                  // A restate was detected (≥1 item already logged recently).
                  if (filtered.length === 0) { feedback.push(null); break; } // nothing new — full restate
                  mealItems = filtered; // insert only the genuinely-new items
                }
              }
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

          if (log && mealItems?.length) {
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

            // FIX (audit AI-ORC-01/EXT-04/INT-03/HIGH): sanitize via the (previously imported-
            // but-unused) validateMealParse so NaN/string/undefined macros become finite numbers
            // and macro–calorie inconsistency is corrected. Then clamp to each column's REAL
            // range: calories smallint [0,32767]; protein/carbs/fat numeric(5,1) [0,9999.9].
            // Before this, Math.max(0, NaN)=NaN and a >9999.9 macro 22003-failed the WHOLE
            // meal_log_items insert → the meal showed "saved" with ZERO items.
            const safeItems = ((validateMealParse({ items: mealItems }).corrected?.items) as typeof mealItems | undefined) ?? mealItems;
            const clampInt = (v: number, max: number) => Math.min(max, Math.max(0, Math.round(Number.isFinite(v) ? v : 0)));
            const clampDec = (v: number, max: number) => Math.min(max, Math.max(0, Math.round((Number.isFinite(v) ? v : 0) * 10) / 10));
            // #arch step 7: GROUND each item against the deterministic food reference. Every logged
            // meal's macros were hallucinated fresh by the model, and those per-item errors
            // accumulate into the deficit ledger the whole coaching arc optimises. When the food
            // resolves, code computes kcal=grams×per100g from canonical data and OVERRIDES the
            // model's numbers (data_source='reference'); unresolved items keep the model estimate
            // (data_source='ai_estimate') so their uncertainty stays visible rather than laundered.
            let groundedCount = 0;
            const rows = safeItems.map(i => {
              const grounded = computeItemNutrition(i.name ?? '', i.portion ?? '');
              if (grounded) groundedCount++;
              const cal = grounded ? grounded.calories : i.calories;
              const pro = grounded ? grounded.protein_g : i.protein_g;
              const carb = grounded ? grounded.carbs_g : i.carbs_g;
              const fat = grounded ? grounded.fat_g : i.fat_g;
              return {
                meal_log_id: log.id, food_name: i.name ?? 'Yiyecek', portion_text: i.portion ?? '1 porsiyon',
                // Cooking multiplier still applies on top of the canonical base (fried/steamed…).
                calories: clampInt(cal * multiplier, 32767),
                protein_g: clampDec(pro, 9999.9),
                carbs_g: clampDec(carb, 9999.9),
                fat_g: clampDec(fat * multiplier, 9999.9),
                data_source: grounded ? 'reference' : 'ai_estimate',
              };
            });
            const { error: itemsErr } = await supabaseAdmin.from('meal_log_items').insert(rows);
            if (groundedCount > 0) console.log(`[meal_log] grounded ${groundedCount}/${rows.length} items against food-reference`);
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
          if (mealItems?.length) {
            const caffeineFeedback = await checkCaffeineIntake(userId, mealItems, today);
            for (const cf of caffeineFeedback) mealFeedback.push(cf);
          }

          // A8: Low confidence proactive verification
          // NOTE: assistantMessage is not in scope here; pass via closure via the outer variable.
          // We check the action's items for suspicious calorie totals.
          if (mealItems?.length) {
            const totalMealCal = mealItems.reduce((s, i) => s + (i.calories ?? 0), 0);
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
            // weight_history is the canonical measurement store (export + trend source)
            // but was never written by any code path before (#R1-M2). Record each weigh-in.
            await supabaseAdmin.from('weight_history').upsert({ user_id: userId, weight_kg: w, recorded_at: actionDate }, { onConflict: 'user_id,recorded_at' });
            // FIX (audit AI-INT-04): only the CURRENT-day weight is the live weight.
            // A backdated weigh-in ("geçen hafta 95 kiloydum", days_ago set) must record
            // history but must NOT overwrite profiles.weight_kg or trigger a TDEE recalc —
            // otherwise an old weight clobbers the real current one and re-derives BMR/TDEE
            // and every calorie range from a stale value.
            if (actionDate === today) {
              await supabaseAdmin.from('profiles').update({ weight_kg: w, updated_at: new Date().toISOString() }).eq('id', userId);
              // T1.19: Check if TDEE recalculation needed
              recalculateTDEEIfNeeded(userId, w).then(() => {}, () => {});
            }

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
          // #memory: maintain a DISTINCT supplement-routine note so the coach knows the stack.
          // ai_summary.supplement_notes was a read-into-prompt-but-never-written dead column; this
          // gives it a cheap, deterministic writer (append the name only if not already present).
          try {
            const { data: sumRow } = await supabaseAdmin.from('ai_summary').select('supplement_notes').eq('user_id', userId).maybeSingle();
            const cur = (sumRow?.supplement_notes as string | null) ?? '';
            if (!cur.toLocaleLowerCase('tr').split(/,\s*/).includes(suppName.toLocaleLowerCase('tr'))) {
              const merged = [cur, suppName].filter(Boolean).join(', ').slice(0, 500);
              await supabaseAdmin.rpc('ai_summary_merge', { p_user_id: userId, p_patch: { supplement_notes: merged } });
            }
          } catch (e) { console.warn('[supplement_notes] note update skipped:', (e as Error).message); }
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
              // #live-S6: weight_history is the canonical measurement store (KVKK export +
              // trend/ETA source). The weight_log handler writes it; this profile_update
              // path (the most common chat weigh-in, "85.5 kiloyum") must mirror it or the
              // weigh-in is missing from the export and any weight_history-based reader.
              await supabaseAdmin.from('weight_history').upsert(
                { user_id: userId, weight_kg: wv, recorded_at: actionDate },
                { onConflict: 'user_id,recorded_at' }
              );
              // FIX (audit AI-INT-04): only a CURRENT-day weigh-in is the live weight.
              // A backdated profile_update weight (days_ago set, "geçen hafta 95 kiloydum")
              // must record history but must NOT overwrite profiles.weight_kg or recalc TDEE,
              // or an old weight clobbers the real current one and re-derives every calorie
              // range from a stale value. Mirrors the system-prompt/regex-backdater intent
              // that excludes weight from backdating.
              if (actionDate === today) {
                updates.weight_kg = action.weight_kg;
                recalculateTDEEIfNeeded(userId, wv).then(() => {}, () => {});
              }
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
          let tdeeRecalced = false; // guard so activity + goal changes don't recompute TDEE twice
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
            // #arch L1: mirror a dietary restriction into the typed safety spine.
            if (!pfErr && typeof updates.dietary_restriction === 'string' && updates.dietary_restriction) {
              await syncConstraint(userId, { kind: 'dietary', subject: updates.dietary_restriction as string, note: updates.dietary_restriction as string });
            }
            // #arch L1 (audit spine-drift): mirror declared medical conditions (digestive — reflü/
            // IBS/gastrit; hormonal — PCOS/tiroid/insülin direnci) into the safety spine as
            // kind='condition' so guardrails and the MemoryMirror see them, not just profiles.
            if (!pfErr && typeof updates.digestive_issues === 'string' && updates.digestive_issues) {
              await syncConstraint(userId, { kind: 'condition', subject: updates.digestive_issues as string, note: updates.digestive_issues as string });
            }
            if (!pfErr && typeof updates.hormone_conditions === 'string' && updates.hormone_conditions) {
              await syncConstraint(userId, { kind: 'condition', subject: updates.hormone_conditions as string, note: updates.hormone_conditions as string });
            }
            // #R3/journey: activity_level is usually set on a LATER onboarding card than the
            // identity card that first computed TDEE — checkOnboardingCompletion only computes
            // TDEE once (when onboarding flips), so a later activity change left calorie targets
            // stuck on the sedentary 1.2 multiplier (~30% low). Force a TDEE+ranges recompute.
            if (!pfErr && updates.activity_level !== undefined) {
              const { data: wRow } = await supabaseAdmin.from('profiles').select('weight_kg').eq('id', userId).maybeSingle();
              const wv = wRow?.weight_kg as number | null;
              if (wv) { tdeeRecalced = true; recalculateTDEEIfNeeded(userId, wv, true).then(() => {}, () => {}); }
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
            let clearWeightTarget = false;
            if (modelGoalType) {
              let consistent = true;
              if (existing && startW && targetW && Math.abs(startW - targetW) > 1) {
                const losing = startW > targetW;
                if (losing && (modelGoalType === 'maintain' || modelGoalType === 'gain_weight')) consistent = false;
                if (!losing && (modelGoalType === 'lose_weight' || modelGoalType === 'maintain')) consistent = false;
              }
              if (consistent) {
                goalPatch.goal_type = modelGoalType;
                // #live-L12: switching an EXISTING goal to a non-weight type (gain_muscle/maintain)
                // without a NEW target must clear the stale target_weight_kg + weekly_rate — else a
                // muscle-gain goal keeps the old weight-LOSS target (e.g. 80kg) and chat context +
                // reports tell the user to drop weight. Mirrors goal_suggestion's null-target path.
                if (existing && (modelGoalType === 'gain_muscle' || modelGoalType === 'maintain') && !action.target_weight_kg) {
                  clearWeightTarget = true;
                }
              }
            } else if (!existing) {
              goalPatch.goal_type = 'lose_weight'; // only set default on brand-new row
            }

            const derivedRate = (startW && targetW && weeks > 0 && !clearWeightTarget)
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
              if (clearWeightTarget) { goalPatch.target_weight_kg = null; goalPatch.weekly_rate = null; }
              else if (derivedRate) goalPatch.weekly_rate = derivedRate;
              const { error: gUpdErr } = await supabaseAdmin.from('goals').update(goalPatch).eq('id', existing.id);
              if (gUpdErr) { console.error('[profile_update] goal update failed:', gUpdErr.message); goalWriteOk = false; }
            }
            // Only claim success when the DB actually accepted the write — never tell
            // the user "Hedef belirlendi" while the row was rejected (#8).
            if (goalWriteOk) pfMessages.push(action.target_weight_kg ? 'Hedef belirlendi' : 'Hedef tipi kaydedildi');
            // #live-L1: the goal's deficit/surplus factor only enters calorie ranges via
            // recalculateTDEEIfNeeded (goal-aware). When a user states their goal AFTER the
            // identity card (the natural order), checkOnboardingCompletion already ran goal-less
            // (factor 1.0 = maintenance), so a "kilo vermek" user was left on maintenance calories.
            // Recompute now that the goal row exists/changed. (activity_level path above does the same.)
            if (goalWriteOk && !tdeeRecalced && currentWeight) {
              tdeeRecalced = true;
              recalculateTDEEIfNeeded(userId, currentWeight as number, true).then(() => {}, () => {});
            }
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
          // #memory RETRACTION: clear:true DELETEs every matching food_preferences row (allergen
          // OR dislike) — the retraction path the coach promises. Match by foodMatchKey so "süt
          // alerjim geçti" clears a row stored as "laktoz"/"sut"/"sütü". Also prune disliked_foods.
          if ((action as Record<string, unknown>).clear === true) {
            const clearKey = foodMatchKey(foodName);
            const { data: allRows } = await supabaseAdmin
              .from('food_preferences').select('food_name').eq('user_id', userId);
            const toDrop = (allRows ?? []).filter((r: { food_name: string }) => foodMatchKey(r.food_name) === clearKey);
            for (const r of toDrop) {
              await supabaseAdmin.from('food_preferences').delete().eq('user_id', userId).eq('food_name', r.food_name);
            }
            const { data: prof } = await supabaseAdmin.from('profiles').select('disliked_foods').eq('id', userId).maybeSingle();
            const df = (prof?.disliked_foods as { item?: string }[] | null) ?? [];
            const kept = df.filter(it => !it?.item || foodMatchKey(it.item) !== clearKey);
            if (kept.length !== df.length) await supabaseAdmin.from('profiles').update({ disliked_foods: kept }).eq('id', userId);
            // #arch L1: retraction also deactivates the typed allergen constraint whose subject
            // key matches (the retract net emits clear for both the canonical + single-noun form).
            const activeAllergens = await getActiveConstraints(userId, ['allergen']);
            for (const ac of activeAllergens) {
              if (foodMatchKey(ac.subject) === clearKey) await deactivateConstraints(userId, 'allergen', { subject: ac.subject });
            }
            console.warn('[food_preference] cleared', { food: foodName, dropped: toDrop.length });
            feedback.push(toDrop.length > 0 || kept.length !== df.length ? 'Kayıt temizlendi' : null);
            break;
          }
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
          // UPSERT on the (user_id, food_name) unique key — a plain insert would 23505
          // when escalating an already-known food (e.g. user earlier said "çileği sevmiyorum"
          // then later "çilek alerjim var"): the allergy/severity would be silently dropped and
          // the allergen guardrails (which read is_allergen) would never see it. Mirrors the
          // client path (settings/food-preferences.tsx). #safety
          const { error: fpErr } = await supabaseAdmin
            .from('food_preferences')
            .upsert(fpRow, { onConflict: 'user_id,food_name' });
          if (fpErr) {
            console.error('[food_preference] upsert failed:', fpErr.message);
            feedback.push(null);
          } else {
            // #memory (Spec 5.12): a POSITIVE preference is a REVERSAL — clear any stale
            // non-allergen dislike/never rows for the SAME food so the contradiction engine
            // stops nagging and plans stop excluding it. The stored dislike may be under a
            // different inflected name ("süt" vs the new "sütü"), so match by foodMatchKey, not
            // string equality. NEVER touch allergen rows here (safety > a casual "artık severim").
            if (!fpRow.is_allergen && (rawPref === 'like' || rawPref === 'love' || rawPref === 'can_cook')) {
              const newKey = foodMatchKey(foodName);
              const { data: existing } = await supabaseAdmin
                .from('food_preferences').select('food_name')
                .eq('user_id', userId).eq('is_allergen', false).in('preference', ['dislike', 'never']);
              const stale = (existing ?? []).filter((r: { food_name: string }) =>
                foodMatchKey(r.food_name) === newKey && r.food_name.toLocaleLowerCase('tr') !== (fpRow.food_name as string));
              for (const r of stale) {
                await supabaseAdmin.from('food_preferences')
                  .delete().eq('user_id', userId).eq('food_name', r.food_name);
                console.warn('[food_preference] reversal: cleared stale dislike', { was: r.food_name, now: fpRow.food_name });
              }
              // Also prune the same food from the JSONB profiles.disliked_foods mirror.
              const { data: prof } = await supabaseAdmin.from('profiles').select('disliked_foods').eq('id', userId).maybeSingle();
              const df = (prof?.disliked_foods as { item?: string }[] | null) ?? [];
              const kept = df.filter(it => !it?.item || foodMatchKey(it.item) !== newKey);
              if (kept.length !== df.length) {
                await supabaseAdmin.from('profiles').update({ disliked_foods: kept }).eq('id', userId);
              }
            }
            // #arch L1: mirror allergens into the typed safety spine (user_constraints).
            if (action.is_allergen === true) {
              await syncConstraint(userId, { kind: 'allergen', subject: foodName, severity: (fpRow.allergen_severity as 'mild'|'moderate'|'severe') ?? 'moderate', note: foodName });
            }
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
            // #arch L1: mirror ongoing injuries/conditions into the typed safety spine with
            // extracted body_parts (surgeries are past events → not ongoing constraints).
            const ev = VALID_EVENTS.has(rawEvent) ? rawEvent : 'other';
            if (action.is_ongoing !== false && (ev === 'injury' || ev === 'condition' || ev === 'medication')) {
              await syncInjuryFromText(userId, desc, ev as 'injury' | 'condition' | 'medication');
            }
            feedback.push('Sağlık bilgisi kaydedildi');
          }
          break;
        }
        case 'life_event': {
          // #organism: persist a dated motivating event so the coach remembers it across sessions.
          const leTitle = (action.title as string ?? '').trim();
          const leDate = action.event_date as string;
          if (!leTitle || !leDate || !/^\d{4}-\d{2}-\d{2}$/.test(leDate)) { feedback.push(null); break; }
          const leType = (action.event_type as string) ?? 'other';
          // Dedup: same type within ±10 days already stored → skip (avoids re-logging on re-mention).
          const { data: existingLE } = await supabaseAdmin.from('life_events')
            .select('event_date').eq('user_id', userId).eq('is_active', true).eq('event_type', leType);
          const near = (existingLE ?? []).some((e: { event_date: string }) =>
            Math.abs(Date.parse(`${e.event_date}T00:00:00Z`) - Date.parse(`${leDate}T00:00:00Z`)) < 10 * 86400000);
          if (near) { feedback.push(null); break; }
          const { error: leErr } = await supabaseAdmin.from('life_events').insert({
            user_id: userId, title: leTitle.slice(0, 80), event_type: leType,
            event_date: leDate, note: (action.note as string ?? '').slice(0, 200),
          });
          if (leErr) { console.error('[life_event] insert failed:', leErr.message); feedback.push(null); }
          else feedback.push(`Aklımda: ${leTitle} (${leDate}) — o güne çalışırız 💪`);
          break;
        }
        case 'health_event_resolve': {
          // #memory RETRACTION: an injury healed. UPDATE the matching ongoing rows to
          // is_ongoing=false so filterExercisesByInjury / the injury guardrail / plan-gen stop
          // treating it as active. Match by body part (the same extractor the injury net uses).
          const healedParts = new Set((action.body_parts as string[] | undefined) ?? []);
          if (healedParts.size === 0) { feedback.push(null); break; }
          const { data: ongoing } = await supabaseAdmin
            .from('health_events').select('id, description')
            .eq('user_id', userId).eq('is_ongoing', true);
          let resolved = 0;
          for (const row of (ongoing ?? []) as { id: string; description: string }[]) {
            const rowParts = extractInjuredBodyParts([row.description ?? '']);
            if (rowParts.some((p) => healedParts.has(p))) {
              const { error: upErr } = await supabaseAdmin.from('health_events')
                .update({ is_ongoing: false }).eq('id', row.id);
              if (!upErr) resolved++;
            }
          }
          // #arch L1: also deactivate the typed injury constraints for the healed parts.
          await resolveInjuryConstraints(userId, [...healedParts]);
          console.warn('[health_event_resolve] resolved', { parts: [...healedParts], resolved });
          feedback.push(resolved > 0 ? 'Geçmiş olsun, kaydını güncelledim' : null);
          break;
        }
        case 'lab_value': {
          // Spec 2.1: lab/blood-work values told in chat ("kolesterolüm 210, D vitaminim 18")
          // persist to lab_values so the coach can reference them. items[] = one row each.
          const items = Array.isArray(action.items) ? action.items as Array<Record<string, unknown>> : [];
          const rows = items
            .map((it) => {
              const name = (it.parameter_name as string | undefined)?.trim();
              const val = Number(it.value);
              if (!name || !Number.isFinite(val)) return null;
              const refMin = it.reference_min != null && Number.isFinite(Number(it.reference_min)) ? Number(it.reference_min) : null;
              const refMax = it.reference_max != null && Number.isFinite(Number(it.reference_max)) ? Number(it.reference_max) : null;
              // NOTE: is_out_of_range is a GENERATED column — the DB computes it; inserting
              // it 428C9-fails. (Mirrors src/services/health.service.ts which omits it too.)
              return {
                user_id: userId,
                parameter_name: name,
                value: val,
                unit: (it.unit as string | undefined)?.trim() || '',
                reference_min: refMin,
                reference_max: refMax,
                measured_at: today,
              };
            })
            .filter((r): r is NonNullable<typeof r> => r !== null);
          if (rows.length === 0) { feedback.push(null); break; }
          const { error: labErr } = await supabaseAdmin.from('lab_values').insert(rows);
          if (labErr) { console.error('[lab_value] insert failed:', labErr.message); feedback.push(null); break; }
          feedback.push(`${rows.length} lab değeri kaydedildi`);
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
            const floor = getCalorieFloor(profileFloor?.gender as string | null); // owner floor (male 1500)

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
          // #S7: accumulate all sub-notes into ONE feedback entry — the caller maps
          // feedback[i]->actions[i] positionally, so pushing 2-4 here would shove the
          // extras onto a co-batched later action's chip.
          const stateMessages: string[] = [];
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
                stateMessages.push(`Gecen ${newState} doneminden not: ${matches[matches.length - 1]}`);
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
                stateMessages.push(`${stateLabel} nedeniyle ${activeChallenges.length} aktif challenge duraklatildi.`);
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
                stateMessages.push(`${pausedChallenges.length} duraklatilmis challenge tekrar aktif.`);
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
          stateMessages.push(CLEARING ? 'Donemsel durum kapatildi — normale donuldu' : `Donemsel durum: ${newState}`);
          feedback.push(stateMessages.join('\n'));
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
          // #journey CRITICAL: maintenance MUST raise the calorie band off the cutting deficit —
          // the old handler only flipped flags + wrote a note promising "+125/hafta", but never
          // touched calorie_range_rest_*, so daily_plans (projected from that band) kept the
          // aggressive cut and the goal-reacher kept losing into an under-eating spiral. Move the
          // band to MAINTENANCE (≈TDEE) so the cut stops immediately. Reverse-diet philosophy for a
          // general weight-loss user = eat at maintenance; no gradual ramp needed to stop harm.
          const maintMin = Math.round(tdee - 100);
          const maintMax = Math.round(tdee + 150);
          const maintTrainMin = Math.round(tdee);
          const maintTrainMax = Math.round(tdee + 350);

          await supabaseAdmin.from('profiles').update({
            maintenance_mode: true,
            maintenance_start_date: today,
            periodic_state: 'maintenance',
            periodic_state_start: today,
            calorie_range_rest_min: maintMin,
            calorie_range_rest_max: maintMax,
            calorie_range_training_min: maintTrainMin,
            calorie_range_training_max: maintTrainMax,
            weekly_calorie_budget: Math.round(((maintMin + maintMax) / 2) * 7),
            updated_at: new Date().toISOString(),
          }).eq('id', userId);

          // Reflect on today's plan immediately (mirror mini_cut_start) so the dashboard shows it now.
          await supabaseAdmin.from('daily_plans').update({
            calorie_target_min: maintMin, calorie_target_max: maintMax,
          }).eq('user_id', userId).eq('date', today);

          await updateLayer2(userId, {
            coaching_notes: `[${today}] Bakim modu basladi. Kalori bakim seviyesine cikarildi (~${Math.round((maintMin + maintMax) / 2)} kcal, TDEE ${tdee}). Tolerans ±1.5kg.`,
          }).then(() => {}, () => {});

          feedback.push(`Bakim modu aktif — kalori hedefin bakim seviyesine yukseltildi (${maintMin}-${maintMax} kcal). Artik kesimde degilsin, tolerans bandi ±1.5kg.`);
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
              // #S4: route through processLayer2Updates which maps the singular `coaching_note`
              // alias to the PLURAL `coaching_notes` column the ai_summary_merge RPC reads and
              // APPENDS (a dated line). Calling updateLayer2 directly with `coaching_note` was a
              // no-op (the RPC ignores the singular key) so the note was silently dropped.
              await processLayer2Updates(userId, { coaching_note: `Hedef onerisi kabul edildi: ${rawType}${targetVal ? ` ${targetVal}` : ''}` }).then(() => {}, () => {});
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

          // FIX (audit DB/HIGH — atomic set_active_goal, migration 057): deactivate-old +
          // insert-new in ONE transaction (single-active invariant, migration 033) so a
          // failed insert can never leave the user with 0 active goals.
          const { error: gsErr } = await supabaseAdmin.rpc('set_active_goal', {
            p_user: userId,
            p_goal: {
              goal_type: gType,
              target_weight_kg: hasWeightTarget ? targetVal : null,
              // FIX (audit low): coerce to integer — a fractional target_weeks would make the RPC's
              // p_goal->>'target_weeks'::int cast throw and roll back the whole goal write.
              target_weeks: Number.isFinite(Number(targetWeeks)) ? Math.round(Number(targetWeeks)) : null,
              start_weight_kg: startWeight,
              weekly_rate: weeklyRate,
            },
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
      .from('ai_summary').select('general_summary, behavioral_patterns, portion_calibration, strength_records, coaching_notes, caffeine_sleep_notes, habit_progress, learned_meal_times, seasonal_notes, alcohol_pattern, social_eating_notes, features_introduced, recovery_pattern, weekly_budget_pattern, menstrual_notes, supplement_notes')
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

        if (existingIdx < 0) {
          // FIX (audit AI-ORC-06): a genuinely NEW pattern is appended through the atomic
          // ai_summary_append_patterns RPC (row-locked, caps at 20) instead of the racy JS
          // read-modify-write below. Two concurrent ai-chat turns previously each read the
          // same `existing` array, rebuilt a full array, and the second merge overwrote the
          // pattern the first added (lost update). The RPC appends ONLY the new entry under a
          // FOR UPDATE lock, so concurrent adds serialize. We do NOT set
          // changes.behavioral_patterns here — that would clobber the appended row via the
          // COALESCE-replace merge using this turn's stale (pre-append) array.
          const newEntry = {
            ...newP,
            first_detected: new Date().toISOString(),
            last_occurred: new Date().toISOString(),
            times_observed: 1,
            evidence_count: 1,
            impact: (newP.impact as string) ?? 'medium',
            status: confidence >= 0.7 ? 'active' : 'candidate',
          };
          await appendBehavioralPatterns(userId, [newEntry]);
        } else {
          // Existing pattern: in-place increment (a true read-modify-write that the append
          // RPC can't express). This still goes through the locked ai_summary_merge below.
          // Two concurrent updates of the SAME existing pattern can still lose one increment;
          // a fully-locked per-entry RPC is out of scope here (no new DB object).
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

    // #memory: 5 ai_summary columns were READ into the coach prompt (buildLayer2) but had NO
    // writer path — permanently-blank sections. Wire the model-emit aliases so the coach can
    // populate them when it learns something (recovery/menstrual/weekly-budget/supplement notes).
    // All are TEXT columns appended date-stamped and whitelisted in ai_summary_merge (mig 037/045).
    const dateNow = new Date().toISOString().split('T')[0];
    const appendNote = (col: 'recovery_pattern' | 'weekly_budget_pattern' | 'menstrual_notes' | 'supplement_notes', val: unknown) => {
      if (!val || typeof val !== 'string' || !val.trim()) return;
      const cur = (existing?.[col] as string) ?? '';
      // keep the last ~6 dated lines to bound growth
      const lines = `${cur}\n[${dateNow}] ${val.trim()}`.trim().split('\n').filter(Boolean);
      changes[col] = lines.slice(-6).join('\n');
    };
    appendNote('recovery_pattern', updates.recovery_note ?? updates.recovery_pattern);
    appendNote('weekly_budget_pattern', updates.weekly_budget_note ?? updates.weekly_budget_pattern);
    appendNote('menstrual_notes', updates.menstrual_note ?? updates.menstrual_notes);
    appendNote('supplement_notes', updates.supplement_note ?? updates.supplement_notes);

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
    // Calculate TDEE and save targets (Spec 2.4, T1.18). #arch: route through the single owners
    // (bmrMifflin/tdeeFrom/computeCalorieBand) instead of re-inlining — this path previously kept a
    // drifting copy with the STALE male floor 1400 (the owner + its sibling recalculateTDEEIfNeeded
    // use getCalorieFloor=1500). computeCalorieBand also does the min<max clamp + weekly budget.
    const age = new Date().getFullYear() - data.birth_year;
    const tdee = tdeeFrom(bmrMifflin(data.weight_kg, data.height_cm, age, data.gender), data.activity_level);

    // Goal-aware target (profiles has no goal_type — read the active goal row).
    const { data: goalRow } = await supabaseAdmin.from('goals').select('goal_type').eq('user_id', userId).eq('is_active', true).limit(1).maybeSingle();
    const targetCal = Math.round(tdee * goalCalorieFactor(goalRow?.goal_type as string | undefined));
    const band = computeCalorieBand({ targetCalories: targetCal, gender: data.gender });
    const trainingMin = band.trainingMin;
    const safeTrainingMax = band.trainingMax;
    const restMin = band.restMin;
    const safeRestMax = band.restMax;
    const waterTarget = Math.round(data.weight_kg * 0.033 * 10) / 10;
    const weeklyBudget = band.weeklyBudget;

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
  const tdee = tdeeFrom(bmrMifflin(currentWeight, profile.height_cm as number, age, profile.gender as string | null), profile.activity_level as string | null);

  // Goal-aware target (don't diet a bulking/maintain user on a weight-change recalc).
  // #journey HIGH: honor the goal timeline — size the deficit to remaining-kg / remaining-weeks
  // (capped safe) so month-2/3 re-cuts converge on the user's DATE instead of a flat 15% that
  // drifts from the ETA/tempo chart. Falls back to the fixed factor when no timeline is set.
  const { data: goalRow } = await supabaseAdmin.from('goals').select('goal_type, target_weight_kg, target_weeks, created_at').eq('user_id', userId).eq('is_active', true).limit(1).maybeSingle();
  const gType = (goalRow?.goal_type as string | undefined) ?? 'maintain';
  const weeksElapsed = goalRow?.created_at ? Math.max(0, Math.floor((Date.now() - Date.parse(goalRow.created_at as string)) / (7 * 86400000))) : 0;
  const targetCal = resolveTargetCalories({
    tdee, goalType: gType, fixedFactor: goalCalorieFactor(gType),
    currentWeight, targetWeight: goalRow?.target_weight_kg as number | null,
    targetWeeks: goalRow?.target_weeks as number | null, weeksElapsed,
  });
  // #arch S1: single band owner (targets.ts) — was an inline copy of the same formula.
  const band = computeCalorieBand({ targetCalories: targetCal, gender: profile.gender as string | null });
  const trainingMin = band.trainingMin;
  const safeTrainingMax = band.trainingMax;
  const restMin = band.restMin;
  const safeRestMax = band.restMax;
  const proteinG = Math.round(currentWeight * 1.8);
  const waterTarget = Math.round(currentWeight * 0.033 * 10) / 10;
  const weeklyBudget = band.weeklyBudget;

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
    : `${reason}. Yeni TDEE ${tdee} kcal, kalori araligi ${restMin}-${safeTrainingMax} kcal, protein ${proteinG}g, su ${waterTarget}L.`;
  await supabaseAdmin.from('coaching_messages').insert({
    user_id: userId,
    trigger_type: 'tdee_recalculated',
    priority: 'low',
    content,
  }).then(() => {}, () => {});
}
