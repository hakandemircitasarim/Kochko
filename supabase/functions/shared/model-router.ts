/**
 * KOCHKO MODEL ROUTER
 *
 * Two-tier model strategy for cost optimization:
 *
 * Tier 1 (Cheap/Fast): Simple tasks that don't need deep reasoning
 *   - Greeting responses
 *   - Basic meal/workout logging (parsing)
 *   - General QA (factual, no personalization)
 *   - Simple acknowledgments
 *
 * Tier 2 (Smart/Expensive): Tasks requiring deep reasoning + personalization
 *   - Coaching (symptom decisions, behavior correction, motivation)
 *   - Analysis (plateau diagnosis, trend analysis, weekly review)
 *   - Plan generation (personalized meal/workout plans)
 *   - Recovery guidance
 *   - Periodic state management
 *
 * The router is deterministic (no LLM call needed for routing).
 * It uses the MessageAnalysis from retrieval-planner to decide.
 */

import type { MessageAnalysis, MessageSubtype } from './retrieval-planner.ts';

// ─── Model Tier Configuration ───

export type ModelTier = 'fast' | 'smart';

export interface ModelSelection {
  tier: ModelTier;
  model: string;
  maxTokens: number;
  reason: string;
}

// Model configuration — change these when switching providers
const MODEL_CONFIG = {
  fast: {
    model: Deno.env.get('KOCHKO_MODEL_FAST') || 'gpt-4o-mini',
    maxTokens: 1500,
  },
  smart: {
    model: Deno.env.get('KOCHKO_MODEL_SMART') || 'gpt-4o',
    maxTokens: 2500,
  },
  vision: {
    model: Deno.env.get('KOCHKO_MODEL_VISION') || 'gpt-4o',
    maxTokens: 2000,
  },
};

// ─── Subtype → Tier Mapping ───

const FAST_SUBTYPES: Set<MessageSubtype> = new Set([
  'pure_greeting',
  'meal_log',
  'workout_log',
  'weight_log',
  'water_sleep_mood_log',
  'qa_general',
  'default_subtype', // for simulation, eating_out (simple tasks)
]);

const SMART_SUBTYPES: Set<MessageSubtype> = new Set([
  'symptom_decision',
  'motivation',
  'behavior_correction',
  'general_coaching',
  'plateau_diagnosis',
  'weekly_review',
  'general_analysis',
  'meal_guidance',
  'workout_plan',
  'qa_personalized',
]);

// Task modes that always go to smart tier regardless of subtype
const ALWAYS_SMART_MODES: Set<string> = new Set([
  'coaching',
  'analyst',
  'plateau',
  'recovery',
  'periodic',
  'plan',
  'mvd',
]);

// ─── Router Function ───

/**
 * Select the appropriate model tier based on message analysis.
 * This is a deterministic decision — no LLM call needed.
 */
export function selectModel(analysis: MessageAnalysis, hasImage: boolean, taskModeOverride?: string): ModelSelection {
  // Vision always uses vision model
  if (hasImage) {
    return {
      tier: 'smart',
      model: MODEL_CONFIG.vision.model,
      maxTokens: MODEL_CONFIG.vision.maxTokens,
      reason: 'vision_required',
    };
  }

  const { taskMode, subtype, riskLevel } = analysis;

  // Plan generation emits a full 7-day JSON snapshot — far larger than a normal
  // reply. The default 1500–2500 token ceiling truncates it mid-JSON, so the
  // closing </plan_snapshot> tag never arrives and the whole plan is silently
  // dropped (user taps "Plan oluştur" and nothing happens). The plan modes come
  // from the client hint, not message analysis, so the caller passes them in via
  // taskModeOverride. Force the smart model with a high ceiling for any of them.
  const planMode = taskModeOverride || taskMode;
  if (planMode && planMode.startsWith('plan')) {
    return {
      tier: 'smart',
      model: MODEL_CONFIG.smart.model,
      maxTokens: 8000,
      reason: `plan_generation_${planMode}`,
    };
  }

  // High risk always goes to smart tier
  if (riskLevel === 'high') {
    return {
      tier: 'smart',
      model: MODEL_CONFIG.smart.model,
      maxTokens: MODEL_CONFIG.smart.maxTokens,
      reason: `high_risk_${taskMode}`,
    };
  }

  // Task modes that always need deep reasoning
  if (ALWAYS_SMART_MODES.has(taskMode)) {
    return {
      tier: 'smart',
      model: MODEL_CONFIG.smart.model,
      maxTokens: MODEL_CONFIG.smart.maxTokens,
      reason: `smart_mode_${taskMode}`,
    };
  }

  // Subtype-based routing.
  //
  // HIZLI KATMAN SOHBETTEN KALDIRILDI (kullanici bulgusu: "model hicbir seyin farkinda
  // degil, salak salak takiliyor"). FAST_SUBTYPES gunluk mesajlarin cogunu kapsiyordu —
  // selamlasma, yemek kaydi, antrenman kaydi, tarti, su/uyku/mod, genel soru. Yani
  // kullanicinin koclariyla en sik konustugu turlar KUCUK modele gidiyordu; ayni sohbette
  // bir mesaj gpt-4o, sonraki gpt-4o-mini cevapliyordu. Kalite dalgalanmasinin ve
  // "onceki mesaji anlamamis gibi" hissin ikinci sebebi buydu (birincisi baglam varyansi,
  // bkz. retrieval-planner CONVERSATIONAL_FLOOR).
  //
  // Kayit turlari kisa cevap urettigi icin maliyet farki kucuk; tutarlilik farki buyuk.
  // maxTokens hizli katmanin dar tavaninda (1500) kalir — bu turlar zaten uzun yazmamali.
  if (FAST_SUBTYPES.has(subtype)) {
    return {
      tier: 'smart',
      model: MODEL_CONFIG.smart.model,
      maxTokens: MODEL_CONFIG.fast.maxTokens,
      reason: `smart_uniform_${subtype}`,
    };
  }

  if (SMART_SUBTYPES.has(subtype)) {
    return {
      tier: 'smart',
      model: MODEL_CONFIG.smart.model,
      maxTokens: MODEL_CONFIG.smart.maxTokens,
      reason: `smart_subtype_${subtype}`,
    };
  }

  // Default: smart tier (safe fallback)
  return {
    tier: 'smart',
    model: MODEL_CONFIG.smart.model,
    maxTokens: MODEL_CONFIG.smart.maxTokens,
    reason: 'default_smart',
  };
}

/**
 * Get current model configuration (for logging/debugging).
 */
export function getModelConfig() {
  return { ...MODEL_CONFIG };
}
