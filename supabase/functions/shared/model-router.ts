/**
 * KOCHKO TURN-COMPUTE ROUTER (formerly the two-tier model router)
 *
 * WHAT CHANGED AND WHY (2026-08, GPT-5.6 migration)
 *
 * This file used to pick a MODEL: cheap-and-dumb for everyday turns, expensive-and-smart for the
 * rest. That design produced the app's signature complaint — "model hicbir seyin farkinda degil,
 * salak salak takiliyor" — because the turns users hit most (greeting, meal log, workout log,
 * weigh-in, general question) were exactly the ones routed to the weak model. One message was
 * answered by a competent coach, the next by a worse one, in the same conversation.
 *
 * The 2026-08-01 commit already collapsed every branch to the smart model. That left this file
 * vestigial: a "router" whose every path returned the same thing. Rather than delete it, it now
 * routes the dial that actually exists on reasoning models — REASONING EFFORT.
 *
 * THE INVARIANT THAT MAKES THIS SAFE: the model and the context are identical on every turn.
 * Only how long that one model THINKS varies. A user can never again meet two different coaches,
 * because there is only one coach — sometimes it pauses longer before answering.
 *
 * Effort is not a cost-saving hack dressed up as quality. It maps to a real property of the turn:
 * does this answer commit a number the user will act on? Parsing "2 yumurta yedim" into a schema
 * does not. Telling someone their deficit is safe does.
 */

import type { MessageAnalysis, MessageSubtype } from './retrieval-planner.ts';
import type { ReasoningEffort } from './openai.ts';

// ─── Model Tier Configuration ───

export type ModelTier = 'fast' | 'smart';

export interface ModelSelection {
  tier: ModelTier;
  model: string;
  maxTokens: number;
  /**
   * How hard the model thinks on this turn. Consumed by chatCompletion as `reasoningEffort`;
   * ignored on the legacy /chat/completions path (gpt-4o rollback), where TEMPERATURE rules.
   */
  effort: ReasoningEffort;
  reason: string;
}

// Model configuration — change these when switching providers.
//
// `fast` is NOT a chat tier any more. It is reserved for schema-constrained mechanical calls
// (extraction/classification) where the output is validated against a shape, so a cheaper model
// cannot drift undetected. It must never answer the user directly: its long-context recall is the
// weakest link in the family and this app puts the full profile + person summary in every prompt.
const MODEL_CONFIG = {
  fast: {
    model: Deno.env.get('KOCHKO_MODEL_FAST') || 'gpt-5.6-luna',
    maxTokens: 1500,
  },
  smart: {
    model: Deno.env.get('KOCHKO_MODEL_SMART') || 'gpt-5.6-terra',
    maxTokens: 2500,
  },
  vision: {
    model: Deno.env.get('KOCHKO_MODEL_VISION') || 'gpt-5.6-terra',
    maxTokens: 2000,
  },
};

// ─── Subtype → Effort Mapping ───

/**
 * Turns that commit a number, a diagnosis, or a safety judgement the user will act on.
 * These think before they speak.
 */
const DELIBERATE_SUBTYPES: Set<MessageSubtype> = new Set([
  'symptom_decision',    // "sirtim agriyor, antrenmana gideyim mi" — clinical judgement
  'plateau_diagnosis',   // why the scale stopped -> a strategy change
  'weekly_review',       // aggregates real data into claims
  'general_analysis',    // ditto
  'meal_guidance',       // portions and calories the user eats to
  'workout_plan',        // load/volume against injury constraints
]);

/**
 * Conversational turns. Full context, one model, no long pause — the coach answering normally.
 */
const CONVERSATIONAL_SUBTYPES: Set<MessageSubtype> = new Set([
  'meal_log',
  'workout_log',
  'weight_log',
  'water_sleep_mood_log',
  'qa_general',
  'qa_personalized',
  'motivation',
  'behavior_correction',
  'general_coaching',
  'default_subtype',
]);

// Task modes that always deliberate regardless of subtype.
const ALWAYS_DELIBERATE_MODES: Set<string> = new Set([
  'analyst',
  'plateau',
  'recovery',
  'periodic',
  'plan',
  'simulation',
]);

// ─── Router Function ───

/**
 * Select the compute for this turn: which model (effectively always the primary), how many output
 * tokens, and how hard to think. Deterministic — no LLM call needed.
 */
export function selectModel(analysis: MessageAnalysis, hasImage: boolean, taskModeOverride?: string): ModelSelection {
  const { taskMode, subtype, riskLevel } = analysis;

  // Vision: same family, multimodal. Reading a plate of food is perception, not deliberation,
  // but the portion/calorie ESTIMATE that follows is a number the user eats to — so `low`, not
  // `none`. Kept ahead of every other branch because an image changes what the model must do.
  if (hasImage) {
    return {
      tier: 'smart',
      model: MODEL_CONFIG.vision.model,
      maxTokens: MODEL_CONFIG.vision.maxTokens,
      effort: 'low',
      reason: 'vision_required',
    };
  }

  // Plan generation emits a full 7-day JSON snapshot — far larger than a normal reply. The default
  // 1500–2500 token ceiling truncates it mid-JSON, so the closing </plan_snapshot> tag never
  // arrives and the whole plan is silently dropped (user taps "Plan oluştur" and nothing happens).
  // The plan modes come from the client hint, not message analysis, so the caller passes them in
  // via taskModeOverride. NOTE: 8000 here is the VISIBLE budget; shared/openai.ts adds the
  // reasoning reserve on top, so thinking cannot eat the snapshot.
  const planMode = taskModeOverride || taskMode;
  if (planMode && planMode.startsWith('plan')) {
    return {
      tier: 'smart',
      model: MODEL_CONFIG.smart.model,
      maxTokens: 8000,
      effort: 'medium',
      reason: `plan_generation_${planMode}`,
    };
  }

  // High risk always deliberates. This is the safety spine: allergen, injury, disordered-eating
  // and crisis signals reach here, and a fast answer is worth nothing if it is the wrong one.
  if (riskLevel === 'high') {
    return {
      tier: 'smart',
      model: MODEL_CONFIG.smart.model,
      maxTokens: MODEL_CONFIG.smart.maxTokens,
      effort: 'medium',
      reason: `high_risk_${taskMode}`,
    };
  }

  if (ALWAYS_DELIBERATE_MODES.has(taskMode)) {
    return {
      tier: 'smart',
      model: MODEL_CONFIG.smart.model,
      maxTokens: MODEL_CONFIG.smart.maxTokens,
      effort: 'medium',
      reason: `deliberate_mode_${taskMode}`,
    };
  }

  if (DELIBERATE_SUBTYPES.has(subtype)) {
    return {
      tier: 'smart',
      model: MODEL_CONFIG.smart.model,
      maxTokens: MODEL_CONFIG.smart.maxTokens,
      effort: 'medium',
      reason: `deliberate_subtype_${subtype}`,
    };
  }

  // A bare greeting needs no thinking — but it still sees the full context spine, so the coach
  // knows who it is greeting. This is the one turn where `none` is honest rather than cheap.
  if (subtype === 'pure_greeting') {
    return {
      tier: 'smart',
      model: MODEL_CONFIG.smart.model,
      maxTokens: MODEL_CONFIG.fast.maxTokens,
      effort: 'none',
      reason: 'greeting_no_reasoning',
    };
  }

  // Everyday conversation: one model, full memory, a short pause. The narrow token ceiling is
  // kept — log turns should answer briefly, and that was never the problem with them.
  if (CONVERSATIONAL_SUBTYPES.has(subtype)) {
    return {
      tier: 'smart',
      model: MODEL_CONFIG.smart.model,
      maxTokens: MODEL_CONFIG.fast.maxTokens,
      effort: 'low',
      reason: `conversational_${subtype}`,
    };
  }

  // Default: primary model, conversational effort. Never the cheap tier.
  return {
    tier: 'smart',
    model: MODEL_CONFIG.smart.model,
    maxTokens: MODEL_CONFIG.smart.maxTokens,
    effort: 'low',
    reason: 'default_conversational',
  };
}

/**
 * The mechanical tier: schema-constrained extraction/classification that never speaks to the user.
 * Exposed explicitly so a caller has to NAME the fact that it is using the cheap model on output
 * it will validate — rather than a router silently deciding the user deserves a worse coach.
 */
export function mechanicalModel(): { model: string; maxTokens: number; effort: ReasoningEffort } {
  return { model: MODEL_CONFIG.fast.model, maxTokens: MODEL_CONFIG.fast.maxTokens, effort: 'none' };
}

/**
 * Get current model configuration (for logging/debugging).
 */
export function getModelConfig() {
  return { ...MODEL_CONFIG };
}
