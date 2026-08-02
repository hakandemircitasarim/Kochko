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
    // FIX (audit AI-MDL-06): daily_log used to hit the default branch and return
    // subtype:'general_coaching' (a SMART_SUBTYPE), routing even a simple "su içtim"
    // log to gpt-4o and defeating the two-tier cost split. Detect logs here so they
    // get a fast-tier subtype, but keep taskMode:'daily_log' so getRetrievalPlan's
    // rich daily_log branch still fires (delegating straight to analyzeRegister
    // would mislabel taskMode as 'register' and lose that scope). Non-log
    // conversational turns stay on general_coaching (smart) — unchanged behavior.
    case 'daily_log':
      return analyzeDailyLog(lower);
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

// FIX (audit AI-MDL-06): daily_log log-detection. Same keyword signals as
// analyzeRegister so simple logs land on a fast-tier subtype, but taskMode stays
// 'daily_log' (preserving getRetrievalPlan's rich daily_log scope) and anything
// that is not clearly a log keeps general_coaching/smart, matching prior behavior.
function analyzeDailyLog(lower: string): MessageAnalysis {
  const base: Omit<MessageAnalysis, 'subtype'> = {
    taskMode: 'daily_log',
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
  if (/su\s*ic|su\s*iç|uyku|uyudum|uyandim|uyandım|ruh\s*hal|moralim|kendimi/.test(lower)) {
    return { ...base, subtype: 'water_sleep_mood_log' };
  }
  // Not a log → keep the prior smart-tier coaching default (no behavior change).
  return { ...base, subtype: 'general_coaching' };
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
  if (/halsiz|hasta|enerji|baş?ı?m?\s*[ae]ğ?r|ağrı|mide|bulant[iı]|uyu(ya)?m|yorgun|baş?ı?m?\s*dön|bas\s*don|sersem|dengemi?\s*kaybet/.test(lower)) {
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
  // Nutrition-shaped questions ("kahvaltıda ne kadar yumurta?", "öğünlerde ne yemeliyim?")
  // MUST load the user's nutrition prefs/allergens even without a first-person cue — a
  // generic answer that ignores lactose intolerance / low morning appetite is wrong
  // (#R1-M4). Route these to the personalized plan (focused L1 nutrition + L2 prefs).
  const nutritionCues = /kahvalt|öğün|ogun|öğle|ogle|yemeli|ne\s*ye|porsiyon|kalori|protein|besin|diyet|atıştır|atistir|ara\s*öğün|tarif|yemek/;

  if (personalCues.test(lower) || nutritionCues.test(lower)) {
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
 *
 * NOT the public entry point — getRetrievalPlan() below clamps the result to the
 * conversational floor. Everything here may only ENRICH beyond that floor.
 *
 * IDENTITY LAYERS ARE NOT ROUTED (2026-08). Every builder here used to also name a layer1 scope
 * (who the user IS) and a layer2 scope (what we have learned about them). Since the conversational
 * floor pins both to `full`, those arguments were fiction: measured across 352 mode x message
 * combinations, layer1/layer1Focus/layer2/layer2Focus took exactly ONE value each — the floor's.
 * Fifteen call sites were writing values that were overwritten a function call later, which is
 * how "meal_log gets a minimal profile" could look true in review while being false at runtime.
 *
 * They are now set in ONE place (getRetrievalPlan, from CONVERSATIONAL_FLOOR). What a turn may
 * still vary is what it READS: how far back, which data types, how much detail, how much history.
 * That variance is real and measured — daysBack 0/7/14/21, four detail levels, five scope unions.
 */
function buildRetrievalPlan(analysis: MessageAnalysis): RetrievalPlan {
  const { taskMode, subtype } = analysis;

  // Greeting fast path
  if (subtype === 'pure_greeting') {
    return {
      ...makePlan(0, [], 'reference', 3),
      contextMeta: {
        confidenceLevel: 'high',
        missingDataTypes: [],
        daysWithCompleteData: 0,
        isGreetingFastPath: true,
      },
    };
  }

  // QA general — no personal DATA needed (the identity layers still come from the floor, so the
  // coach knows who it is talking to even when the question is a textbook one).
  if (subtype === 'qa_general') {
    return {
      ...makePlan(0, [], 'reference', 5),
      contextMeta: {
        // D5 (plan v2, DÜRÜSTLÜK-04): was hardcoded 'high' — the turn that loads the LEAST
        // personal context claimed the MOST confidence in the app (the allergen-card misroute
        // ran on exactly this plan). Zero layers ⇒ personalized claims must be hedged; textbook
        // facts need no confidence note anyway. refineContextMeta re-derives from evidence.
        confidenceLevel: 'medium',
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
      return makePlan(1, ['meals'], 'summary', 3);
    case 'eating_out':
      return makePlan(1, ['meals'], 'summary', 5);
    case 'mvd':
      return makePlan(3, ['metrics'], 'summary', 10);
    case 'plateau':
      return makePlan(21, ['metrics', 'workouts', 'reports'], 'full', 5);
    case 'simulation':
      return makePlan(1, ['meals'], 'full', 5);
    case 'recovery':
      return makePlan(7, ['meals', 'metrics'], 'summary', 10);
    case 'onboarding':
      // Onboarding is primarily POPULATING the profile, not reasoning from history — so it reads
      // no day data. It still receives the full identity layers from the floor, which is what
      // stops a task-card chat from re-asking something an earlier session already answered.
      return makePlan(0, [], 'reference', 10);
    case 'plan_diet':
      return makePlan(14, ['meals', 'metrics'], 'reference', 10);
    case 'plan_workout':
      // Recent workouts so the AI respects existing intensity/frequency.
      return makePlan(14, ['workouts', 'metrics'], 'reference', 10);
    case 'daily_log':
      // Day-to-day conversational logging: recent meals and workouts for pattern continuity.
      // AI-behaviour #7: 'commitments' + 'reports' added — the coach could not see its own open
      // commitments or yesterday's prescribed action on the app's HIGHEST-frequency mode, so it could
      // never follow up on what it asked for. The due/upcoming formatter already exists downstream.
      return makePlan(7, ['meals', 'workouts', 'metrics', 'reports', 'commitments'], 'full', 15);
    case 'periodic':
      return makePlan(7, ['meals', 'workouts', 'metrics', 'reports', 'commitments', 'labAlerts'], 'full', 10);
    default:
      return buildCoachingPlan('general_coaching');
  }
}

// ─── Task-Specific Plan Builders ───

function buildRegisterPlan(subtype: MessageSubtype): RetrievalPlan {
  switch (subtype) {
    case 'meal_log':
      return makePlan(1, ['meals'], 'full', 3);
    case 'workout_log':
      return makePlan(1, ['workouts'], 'full', 3);
    case 'weight_log':
      return makePlan(7, ['metrics'], 'summary', 3);
    default: // water_sleep_mood_log
      return makePlan(1, ['metrics'], 'summary', 3);
  }
}

function buildPlanPlan(subtype: MessageSubtype): RetrievalPlan {
  if (subtype === 'workout_plan') return makePlan(3, ['workouts', 'metrics'], 'summary', 5);
  // meal_guidance
  return makePlan(3, ['meals', 'metrics'], 'summary', 5);
}

function buildCoachingPlan(subtype: MessageSubtype): RetrievalPlan {
  switch (subtype) {
    case 'symptom_decision':
      return makePlan(7, ['meals', 'metrics'], 'summary', 10);
    case 'motivation':
      return makePlan(3, ['metrics'], 'summary', 10);
    case 'behavior_correction':
      return makePlan(7, ['meals', 'metrics'], 'summary', 10);
    default: // general_coaching
      return makePlan(7, ['meals', 'workouts', 'metrics', 'reports', 'commitments', 'labAlerts'], 'full', 15);
  }
}

function buildAnalystPlan(subtype: MessageSubtype): RetrievalPlan {
  if (subtype === 'plateau_diagnosis') {
    return makePlan(30, ['metrics', 'workouts', 'reports'], 'full', 5);
  }
  if (subtype === 'weekly_review') {
    return makePlan(7, ['meals', 'workouts', 'metrics', 'reports'], 'full', 5);
  }
  // general_analysis
  return makePlan(14, ['meals', 'workouts', 'metrics', 'reports', 'commitments', 'labAlerts'], 'full', 10);
}

function buildQAPlan(subtype: MessageSubtype): RetrievalPlan {
  if (subtype === 'qa_personalized') return makePlan(3, ['meals', 'metrics'], 'summary', 5);
  // qa_general (already handled above, but as fallback)
  return makePlan(0, [], 'reference', 5);
}

// ─── Conversational floor ───

/**
 * TEK BAGLAM OMURGASI (kullanici bulgusu: "her mesajda bir oncekiyle kulaktan kulakga
 * oynuyor, koc hicbir seyin farkinda degil").
 *
 * TESHIS: buildRetrievalPlan her mesaja regex uygulayip bir alt tip tayin ediyor ve o alt
 * tipe gore modelin hafizasini YENIDEN BOYUTLANDIRIYORDU. Ardisik iki mesajda profil
 * full <-> minimal, kisi ozeti full <-> YOK, gorunen sohbet 3 <-> 15 mesaj arasinda gidip
 * geliyordu. Kullanicinin karsisinda her turda FARKLI HAFIZAYA SAHIP FARKLI BIR ASISTAN
 * vardi; tutarli olmasi mumkun degildi. Tekrar sorulan sorularin, konudan sapmanin ve
 * "kopuk/baglamsiz" hissin tek bir teknik sebebi bu.
 *
 * Bu tasarim 2024 kisitlarini (dar pencere, pahali token) cozmek icin yazilmisti. O
 * kisitlar yok; dahasi degisken on-ek prompt cache'ini de oldurup tasarrufu yiyordu.
 *
 * COZUM: alt tip mantigi DURUYOR ama artik yalnizca ZENGINLESTIREBILIR — hicbir tur bu
 * tabanin altina inemez. Her tur en az: tam profil + tam kisi ozeti + 7 gunluk veri +
 * son 30 mesaj. Bir plan zaten daha genisse (analist 30 gun, rapor vb.) oldugu gibi kalir.
 */
const CONVERSATIONAL_FLOOR = {
  layer1: 'full' as Layer1Scope,
  layer1Focus: ['health', 'nutrition', 'training', 'demographics'] as Layer1Focus[],
  layer2: 'full' as Layer2Scope,
  layer2Focus: ['patterns', 'persona', 'preferences', 'strength', 'habits'] as Layer2Focus[],
  layer3DaysBack: 7,
  layer3Scope: ['meals', 'workouts', 'metrics'] as Layer3DataType[],
  layer4MaxMessages: 30,
};

const L3_RANK: Record<Layer3Detail, number> = { reference: 0, summary: 1, full: 2 };

function union<T>(a: T[], b: T[]): T[] {
  return [...new Set([...a, ...b])];
}

/**
 * Public entry point: raise any plan to the conversational floor.
 *
 * The identity layers (1 and 2 — who the user is, what we have learned) are not raised, they are
 * ASSIGNED: no turn may ever see less than the whole person. That is the invariant the whole
 * "tek baglam omurgasi" fix rests on, and it now holds by construction rather than by every
 * builder remembering to ask for enough.
 *
 * Tek istisna: pure_greeting hizli yolu. "merhaba"ya cevap vermek icin 30 mesaj + 7 gunluk
 * veri cekmek gereksiz — AMA eski hali kisi ozetini de atiyordu, yani koc selam verirken
 * kim oldugunu unutuyordu. Kimlik katmanlari orada da tam; yalnizca gun/mesaj sayisi dusuk kalir.
 */
export function getRetrievalPlan(analysis: MessageAnalysis): RetrievalPlan {
  const plan = buildRetrievalPlan(analysis);
  const isGreeting = analysis.subtype === 'pure_greeting';

  return {
    ...plan,
    layer1: CONVERSATIONAL_FLOOR.layer1,
    layer1Focus: [...CONVERSATIONAL_FLOOR.layer1Focus],
    layer2: CONVERSATIONAL_FLOOR.layer2,
    layer2Focus: [...CONVERSATIONAL_FLOOR.layer2Focus],
    layer3: {
      // Selamlasmada gun verisi cekmeye gerek yok; diger her turda taban gecerli.
      daysBack: isGreeting
        ? plan.layer3.daysBack
        : Math.max(plan.layer3.daysBack, CONVERSATIONAL_FLOOR.layer3DaysBack),
      scope: isGreeting
        ? plan.layer3.scope
        : union(plan.layer3.scope, CONVERSATIONAL_FLOOR.layer3Scope),
      // 'reference' seviyesi gunluk verinin sadece VAR/YOK bilgisini gecirir — sohbet
      // turlarinda bu "dun ne yedigimi bilmiyor" demek. En az 'summary'.
      detailLevel: isGreeting
        ? plan.layer3.detailLevel
        : (L3_RANK[plan.layer3.detailLevel] >= L3_RANK.summary ? plan.layer3.detailLevel : 'summary'),
    },
    layer4MaxMessages: isGreeting
      ? Math.max(plan.layer4MaxMessages, 10)
      : Math.max(plan.layer4MaxMessages, CONVERSATIONAL_FLOOR.layer4MaxMessages),
    contextMeta: plan.contextMeta,
  };
}

// ─── Helper ───

/**
 * A plan states only what a turn READS: how far back, which data types, how much detail, how much
 * conversation. The identity layers are filled from the floor by getRetrievalPlan — passing them
 * here would be writing a value that is overwritten one call later.
 */
function makePlan(
  l3Days: number, l3Scope: Layer3DataType[], l3Detail: Layer3Detail,
  l4Max: number
): RetrievalPlan {
  return {
    layer1: CONVERSATIONAL_FLOOR.layer1,
    layer1Focus: [...CONVERSATIONAL_FLOOR.layer1Focus],
    layer2: CONVERSATIONAL_FLOOR.layer2,
    layer2Focus: [...CONVERSATIONAL_FLOOR.layer2Focus],
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
