/**
 * KOCHKO RETRIEVAL PLANNER v2
 *
 * Determines exactly which data to fetch for each LLM call.
 * Uses task_mode + subtype + message analysis to minimize token usage.
 *
 * Design principle: Memory is broad, context must be narrow.
 * The LLM is a reasoning engine, not a database browser.
 */

import type { TaskMode } from '../ai-chat/task-modes.ts';

// ─── Types ───

export type Layer1Scope = 'full' | 'focused' | 'minimal';
export type Layer2Scope = 'full' | 'minimal' | 'none';
export type Layer3Detail = 'full' | 'summary' | 'reference';
export type DataConfidence = 'high' | 'medium' | 'low';

export type Layer1Focus = 'health' | 'nutrition' | 'training' | 'demographics';
export type Layer2Focus = 'patterns' | 'persona' | 'preferences' | 'strength' | 'habits';
export type Layer3DataType = 'meals' | 'workouts' | 'metrics' | 'reports' | 'commitments' | 'labAlerts';

export interface RetrievalPlan {
  layer1: Layer1Scope;
  layer1Focus: Layer1Focus[];
  layer2: Layer2Scope;
  layer2Focus: Layer2Focus[];
  layer3: {
    daysBack: number;
    scope: Layer3DataType[];
    detailLevel: Layer3Detail;
  };
  layer4MaxMessages: number;
  contextMeta: ContextMeta;
}

export interface ContextMeta {
  confidenceLevel: DataConfidence;
  missingDataTypes: string[];
  daysWithCompleteData: number;
  isGreetingFastPath: boolean;
}

export type MessageSubtype =
  // greeting
  | 'pure_greeting'
  // register
  | 'meal_log' | 'workout_log' | 'weight_log' | 'water_sleep_mood_log'
  // plan
  | 'meal_guidance' | 'workout_plan'
  // coaching
  | 'symptom_decision' | 'motivation' | 'behavior_correction' | 'general_coaching'
  // analyst
  | 'plateau_diagnosis' | 'weekly_review' | 'general_analysis'
  // qa
  | 'qa_general' | 'qa_personalized'
  // recipe, eating_out, mvd, plateau, simulation, recovery, onboarding, periodic
  | 'default_subtype';

export interface MessageAnalysis {
  taskMode: TaskMode;
  subtype: MessageSubtype;
  riskLevel: 'low' | 'medium' | 'high';
  requiresPersonalization: boolean;
  recencyNeed: 'none' | 'today' | 'week' | 'month';
}

// ─── Message Analysis ───

/**
 * Analyze a message to determine subtype, risk, and personalization needs.
 * This is a deterministic pre-router — no LLM call needed.
 */
export function analyzeMessage(message: string, taskMode: TaskMode): MessageAnalysis {
  const lower = message.toLocaleLowerCase('tr');
  const wordCount = message.trim().split(/\s+/).length;

  // Greeting strict gating: short + pure greeting + no content signals
  if (taskMode === 'coaching' || taskMode === 'onboarding') {
    if (isStrictGreeting(lower, wordCount)) {
      return {
        taskMode: 'coaching', // greeting is handled via coaching with fast path
        subtype: 'pure_greeting',
        riskLevel: 'low',
        requiresPersonalization: false,
        recencyNeed: 'none',
      };
    }
  }

  switch (taskMode) {
    case 'register':
      return analyzeRegister(lower);
    case 'plan':
      return analyzePlan(lower);
    case 'coaching':
      return analyzeCoaching(lower);
    case 'analyst':
      return analyzeAnalyst(lower);
    case 'qa':
      return analyzeQA(lower);
    case 'mvd':
      return { taskMode, subtype: 'default_subtype', riskLevel: 'medium', requiresPersonalization: true, recencyNeed: 'week' };
    case 'plateau':
      return { taskMode, subtype: 'plateau_diagnosis', riskLevel: 'medium', requiresPersonalization: true, recencyNeed: 'month' };
    case 'simulation':
      return { taskMode, subtype: 'default_subtype', riskLevel: 'low', requiresPersonalization: true, recencyNeed: 'today' };
    case 'recovery':
      return { taskMode, subtype: 'default_subtype', riskLevel: 'medium', requiresPersonalization: true, recencyNeed: 'week' };
    case 'recipe':
      return { taskMode, subtype: 'default_subtype', riskLevel: 'low', requiresPersonalization: true, recencyNeed: 'today' };
    case 'eating_out':
      return { taskMode, subtype: 'default_subtype', riskLevel: 'low', requiresPersonalization: true, recencyNeed: 'today' };
    case 'onboarding':
      return { taskMode, subtype: 'default_subtype', riskLevel: 'low', requiresPersonalization: false, recencyNeed: 'none' };
    case 'periodic':
      return { taskMode, subtype: 'default_subtype', riskLevel: 'high', requiresPersonalization: true, recencyNeed: 'week' };
    default:
      return { taskMode, subtype: 'general_coaching', riskLevel: 'low', requiresPersonalization: true, recencyNeed: 'week' };
  }
}

// ─── Strict Greeting Gate ───

const GREETING_PATTERNS = /^(merhaba|selam|hey|sa|naber|nasilsin|nasılsın|gunaydin|günaydın|iyi\s*(aksamlar|aksam|geceler|gunler)|hosgeldin|hoşgeldin)\s*[.!?]*$/;

const CONTENT_SIGNALS = /yedim|ictim|içtim|halsiz|hasta|kilo|spor|antrenman|plan|ne\s*ye|spora|gitmesem|yesem|rapor|analiz|gece\s*ye|kaçamak|bozdum|ağrı|agrı|motive|hedef/;

function isStrictGreeting(lower: string, wordCount: number): boolean {
  if (wordCount > 5) return false;
  if (CONTENT_SIGNALS.test(lower)) return false;
  return GREETING_PATTERNS.test(lower.trim());
}

// ─── Subtype Analyzers ───

function analyzeRegister(lower: string): MessageAnalysis {
  const base: Omit<MessageAnalysis, 'subtype'> = {
    taskMode: 'register',
    riskLevel: 'low',
    requiresPersonalization: true,
    recencyNeed: 'today',
  };

  if (/yedim|ictim|içtim|kahvalt|ogle|öğle|aksam|akşam|atistir|atıştır/.test(lower)) {
    return { ...base, subtype: 'meal_log' };
  }
  if (/yaptim|yaptım|kostum|koştum|yurudum|yürüdüm|antrenman|salon|egzersiz/.test(lower)) {
    return { ...base, subtype: 'workout_log' };
  }
  if (/\d+\s*k(g|ilo)|tartildim|tartıldım/.test(lower)) {
    return { ...base, subtype: 'weight_log', recencyNeed: 'week' };
  }
  return { ...base, subtype: 'water_sleep_mood_log' };
}

function analyzePlan(lower: string): MessageAnalysis {
  const base: Omit<MessageAnalysis, 'subtype'> = {
    taskMode: 'plan',
    riskLevel: 'low',
    requiresPersonalization: true,
    recencyNeed: 'week',
  };

  if (/antrenman|egzersiz|spor|program/.test(lower)) {
    return { ...base, subtype: 'workout_plan' };
  }
  return { ...base, subtype: 'meal_guidance' };
}

function analyzeCoaching(lower: string): MessageAnalysis {
  // Symptom/health decision
  if (/halsiz|hasta|enerji|basi?m?\s*agr|ağrı|mide|bulanti|uyu(ya)?m|yorgun|bas\s*don/.test(lower)) {
    return {
      taskMode: 'coaching',
      subtype: 'symptom_decision',
      riskLevel: 'high',
      requiresPersonalization: true,
      recencyNeed: 'week',
    };
  }

  // Motivation
  if (/motive|motivasyon|cesaretlendir|umut|basarabilir|yapabilir|inaniyorum|devam|pes/.test(lower)) {
    return {
      taskMode: 'coaching',
      subtype: 'motivation',
      riskLevel: 'low',
      requiresPersonalization: true,
      recencyNeed: 'week',
    };
  }

  // Behavior correction
  if (/gece\s*ye|kaçamak|kacarma|sapma|disiplin|toparla|bozdum|fazla\s*yedim/.test(lower)) {
    return {
      taskMode: 'coaching',
      subtype: 'behavior_correction',
      riskLevel: 'medium',
      requiresPersonalization: true,
      recencyNeed: 'week',
    };
  }

  return {
    taskMode: 'coaching',
    subtype: 'general_coaching',
    riskLevel: 'low',
    requiresPersonalization: true,
    recencyNeed: 'week',
  };
}

function analyzeAnalyst(lower: string): MessageAnalysis {
  if (/plato|plateau|durgun|degismiyor|değişmiyor|ayni\s*kal|aynı\s*kal/.test(lower)) {
    return {
      taskMode: 'analyst',
      subtype: 'plateau_diagnosis',
      riskLevel: 'medium',
      requiresPersonalization: true,
      recencyNeed: 'month',
    };
  }
  if (/hafta|weekly|7\s*gun|son\s*hafta/.test(lower)) {
    return {
      taskMode: 'analyst',
      subtype: 'weekly_review',
      riskLevel: 'low',
      requiresPersonalization: true,
      recencyNeed: 'week',
    };
  }
  return {
    taskMode: 'analyst',
    subtype: 'general_analysis',
    riskLevel: 'low',
    requiresPersonalization: true,
    recencyNeed: 'week',
  };
}

function analyzeQA(lower: string): MessageAnalysis {
  // Personalized QA: references user's own situation
  const personalCues = /benim|bende|bana|durumum|kilom|boyum|yaşım|ameliyat|alerji|ilacım|ilaç|sorunum|problem|mide|hamile|emzir/;

  if (personalCues.test(lower)) {
    return {
      taskMode: 'qa',
      subtype: 'qa_personalized',
      riskLevel: 'low',
      requiresPersonalization: true,
      recencyNeed: 'today',
    };
  }

  return {
    taskMode: 'qa',
    subtype: 'qa_general',
    riskLevel: 'low',
    requiresPersonalization: false,
    recencyNeed: 'none',
  };
}

// ─── Retrieval Plan Builder ───

/**
 * Build a retrieval plan from message analysis.
 * This determines exactly which data layers and scopes to fetch.
 */
export function getRetrievalPlan(analysis: MessageAnalysis): RetrievalPlan {
  const { taskMode, subtype } = analysis;

  // Greeting fast path
  if (subtype === 'pure_greeting') {
    return {
      layer1: 'minimal',
      layer1Focus: ['demographics'],
      layer2: 'none',
      layer2Focus: [],
      layer3: { daysBack: 0, scope: [], detailLevel: 'reference' },
      layer4MaxMessages: 3,
      contextMeta: {
        confidenceLevel: 'high',
        missingDataTypes: [],
        daysWithCompleteData: 0,
        isGreetingFastPath: true,
      },
    };
  }

  // QA general — minimal personal context
  if (subtype === 'qa_general') {
    return {
      layer1: 'minimal',
      layer1Focus: ['demographics'],
      layer2: 'none',
      layer2Focus: [],
      layer3: { daysBack: 0, scope: [], detailLevel: 'reference' },
      layer4MaxMessages: 5,
      contextMeta: {
        confidenceLevel: 'high',
        missingDataTypes: [],
        daysWithCompleteData: 0,
        isGreetingFastPath: false,
      },
    };
  }

  // Build plan based on task mode + subtype
  switch (taskMode) {
    case 'register':
      return buildRegisterPlan(subtype);
    case 'plan':
      return buildPlanPlan(subtype);
    case 'coaching':
      return buildCoachingPlan(subtype);
    case 'analyst':
      return buildAnalystPlan(subtype);
    case 'qa':
      return buildQAPlan(subtype);
    case 'recipe':
      return makePlan('focused', ['nutrition'], 'minimal', ['preferences'], 1, ['meals'], 'summary', 3);
    case 'eating_out':
      return makePlan('focused', ['nutrition'], 'minimal', ['preferences'], 1, ['meals'], 'summary', 5);
    case 'mvd':
      return makePlan('minimal', ['demographics'], 'full', ['persona', 'habits'], 3, ['metrics'], 'summary', 10);
    case 'plateau':
      return makePlan('full', ['health', 'nutrition', 'training', 'demographics'], 'full', ['patterns', 'persona', 'preferences', 'strength', 'habits'], 21, ['metrics', 'workouts', 'reports'], 'full', 5);
    case 'simulation':
      return makePlan('focused', ['nutrition'], 'minimal', ['preferences'], 1, ['meals'], 'full', 5);
    case 'recovery':
      return makePlan('full', ['health', 'nutrition', 'demographics'], 'full', ['patterns', 'persona'], 7, ['meals', 'metrics'], 'summary', 10);
    case 'onboarding':
      // Full layer1 is critical: task-card chats persist into profiles/goals/food_preferences,
      // and other onboarding sessions MUST see that data so they don't re-ask what's already
      // been answered. Includes motivation, goal, nutrition prefs, training background.
      // Layer2 still 'none' since onboarding is primarily populating, not reasoning from,
      // learned insights. Layer4 reference keeps the immediate chat turn context intact.
      return makePlan('full', ['health', 'nutrition', 'training', 'demographics'], 'minimal', ['preferences'], 0, [], 'reference', 10);
    case 'plan_diet':
      // Full profile + rich layer2 (food preferences, portion calibration, alcohol pattern,
      // micro-nutrient risks) so the plan chat has everything needed to negotiate.
      return makePlan('full', ['health', 'nutrition', 'demographics'], 'full', ['preferences', 'patterns'], 14, ['meals', 'metrics'], 'reference', 10);
    case 'plan_workout':
      // Same idea but training-focused. Layer3 includes recent workouts so AI respects
      // existing intensity/frequency.
      return makePlan('full', ['health', 'training', 'demographics'], 'full', ['strength', 'habits', 'preferences'], 14, ['workouts', 'metrics'], 'reference', 10);
    case 'daily_log':
      // Day-to-day conversational logging. Needs profile for TDEE context, recent meals
      // and workouts (7 days) for pattern continuity, and layer2 patterns to recognize
      // habits. Layer4 full so the chat thread stays coherent.
      return makePlan('focused', ['nutrition', 'training'], 'minimal', ['patterns', 'preferences'], 7, ['meals', 'workouts', 'metrics'], 'full', 15);
    case 'periodic':
      return makePlan('full', ['health', 'nutrition', 'training', 'demographics'], 'full', ['patterns', 'persona', 'preferences', 'strength', 'habits'], 7, ['meals', 'workouts', 'metrics', 'reports', 'commitments', 'labAlerts'], 'full', 10);
    default:
      return buildCoachingPlan('general_coaching');
  }
}

// ─── Task-Specific Plan Builders ───

function buildRegisterPlan(subtype: MessageSubtype): RetrievalPlan {
  switch (subtype) {
    case 'meal_log':
      return makePlan('focused', ['nutrition'], 'minimal', ['preferences'], 1, ['meals'], 'full', 3);
    case 'workout_log':
      return makePlan('focused', ['training'], 'minimal', ['strength'], 1, ['workouts'], 'full', 3);
    case 'weight_log':
      return makePlan('focused', ['demographics'], 'minimal', ['patterns'], 7, ['metrics'], 'summary', 3);
    default: // water_sleep_mood_log
      return makePlan('minimal', ['demographics'], 'none', [], 1, ['metrics'], 'summary', 3);
  }
}

function buildPlanPlan(subtype: MessageSubtype): RetrievalPlan {
  if (subtype === 'workout_plan') {
    return makePlan(
      'full', ['training', 'health', 'demographics'],
      'full', ['strength', 'habits', 'patterns'],
      3, ['workouts', 'metrics'], 'summary', 5
    );
  }
  // meal_guidance
  return makePlan(
    'full', ['nutrition', 'health', 'demographics'],
    'full', ['preferences', 'patterns'],
    3, ['meals', 'metrics'], 'summary', 5
  );
}

function buildCoachingPlan(subtype: MessageSubtype): RetrievalPlan {
  switch (subtype) {
    case 'symptom_decision':
      return makePlan(
        'focused', ['health', 'demographics'],
        'full', ['patterns'],
        7, ['meals', 'metrics'], 'summary', 10
      );
    case 'motivation':
      return makePlan(
        'minimal', ['demographics'],
        'full', ['persona', 'habits'],
        3, ['metrics'], 'summary', 10
      );
    case 'behavior_correction':
      return makePlan(
        'full', ['nutrition', 'health', 'demographics'],
        'full', ['patterns', 'persona'],
        7, ['meals', 'metrics'], 'summary', 10
      );
    default: // general_coaching
      return makePlan(
        'full', ['health', 'nutrition', 'training', 'demographics'],
        'full', ['patterns', 'persona', 'preferences', 'strength', 'habits'],
        7, ['meals', 'workouts', 'metrics', 'reports', 'commitments', 'labAlerts'], 'full', 15
      );
  }
}

function buildAnalystPlan(subtype: MessageSubtype): RetrievalPlan {
  if (subtype === 'plateau_diagnosis') {
    return makePlan(
      'full', ['health', 'nutrition', 'training', 'demographics'],
      'full', ['patterns', 'persona', 'preferences', 'strength', 'habits'],
      30, ['metrics', 'workouts', 'reports'], 'full', 5
    );
  }
  if (subtype === 'weekly_review') {
    return makePlan(
      'focused', ['nutrition', 'training', 'demographics'],
      'full', ['patterns'],
      7, ['meals', 'workouts', 'metrics', 'reports'], 'full', 5
    );
  }
  // general_analysis
  return makePlan(
    'full', ['health', 'nutrition', 'training', 'demographics'],
    'full', ['patterns', 'persona', 'preferences', 'strength', 'habits'],
    14, ['meals', 'workouts', 'metrics', 'reports', 'commitments', 'labAlerts'], 'full', 10
  );
}

function buildQAPlan(subtype: MessageSubtype): RetrievalPlan {
  if (subtype === 'qa_personalized') {
    return makePlan(
      'focused', ['health', 'nutrition', 'demographics'],
      'minimal', ['preferences'],
      3, ['meals', 'metrics'], 'summary', 5
    );
  }
  // qa_general (already handled above, but as fallback)
  return makePlan('minimal', ['demographics'], 'none', [], 0, [], 'reference', 5);
}

// ─── Helper ───

function makePlan(
  l1: Layer1Scope, l1Focus: Layer1Focus[],
  l2: Layer2Scope, l2Focus: Layer2Focus[],
  l3Days: number, l3Scope: Layer3DataType[], l3Detail: Layer3Detail,
  l4Max: number
): RetrievalPlan {
  return {
    layer1: l1,
    layer1Focus: l1Focus,
    layer2: l2,
    layer2Focus: l2Focus,
    layer3: { daysBack: l3Days, scope: l3Scope, detailLevel: l3Detail },
    layer4MaxMessages: l4Max,
    contextMeta: {
      confidenceLevel: 'medium', // will be refined after actual data retrieval
      missingDataTypes: [],
      daysWithCompleteData: 0,
      isGreetingFastPath: false,
    },
  };
}
