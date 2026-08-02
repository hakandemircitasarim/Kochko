/**
 * model-router.test.ts — the "one coach" invariant.
 *
 * The bug this file exists to prevent is the one the user actually reported: "model hicbir seyin
 * farkinda degil, salak salak takiliyor". Its cause was a router that answered everyday turns with
 * a weaker model, so the assistant's competence changed between consecutive messages. The guard is
 * blunt on purpose — selectModel must NEVER return the cheap tier, for any input.
 */
import { assertEquals, assert } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { selectModel, mechanicalModel, getModelConfig } from './model-router.ts';
import type { MessageAnalysis, MessageSubtype } from './retrieval-planner.ts';
import type { TaskMode } from '../ai-chat/task-modes.ts';

const ALL_SUBTYPES: MessageSubtype[] = [
  'pure_greeting',
  'meal_log', 'workout_log', 'weight_log', 'water_sleep_mood_log',
  'meal_guidance', 'workout_plan',
  'symptom_decision', 'motivation', 'behavior_correction', 'general_coaching',
  'plateau_diagnosis', 'weekly_review', 'general_analysis',
  'qa_general', 'qa_personalized',
  'default_subtype',
];

// The full TaskMode union (ai-chat/task-modes.ts). Kept exhaustive on purpose: the invariant
// below is only meaningful if it sweeps every mode the app can actually produce.
// NB there is no 'greeting' mode — a bare greeting arrives under another mode and is identified
// by its SUBTYPE, which is exactly why the greeting fast path keys off pure_greeting.
const ALL_MODES: TaskMode[] = [
  'register', 'plan', 'plan_diet', 'plan_workout', 'daily_log', 'coaching', 'analyst',
  'qa', 'recipe', 'eating_out', 'mvd', 'plateau', 'simulation', 'recovery',
  'onboarding', 'periodic',
];

function analysis(over: Partial<MessageAnalysis> = {}): MessageAnalysis {
  return {
    taskMode: 'coaching',
    subtype: 'general_coaching',
    riskLevel: 'low',
    requiresPersonalization: true,
    recencyNeed: 'week',
    ...over,
  };
}

Deno.test('THE invariant: no input can route the user to the cheap model', () => {
  const cheap = getModelConfig().fast.model;
  const smart = getModelConfig().smart.model;

  for (const subtype of ALL_SUBTYPES) {
    for (const taskMode of ALL_MODES) {
      for (const riskLevel of ['low', 'medium', 'high'] as const) {
        for (const hasImage of [false, true]) {
          const sel = selectModel(analysis({ subtype, taskMode, riskLevel }), hasImage);
          assert(
            sel.model !== cheap,
            `${taskMode}/${subtype}/risk=${riskLevel}/img=${hasImage} routed the USER to the cheap model`,
          );
          assertEquals(sel.tier, 'smart');
          // Vision may name a dedicated model; every other path is the one primary model.
          if (!hasImage) assertEquals(sel.model, smart);
        }
      }
    }
  }
});

Deno.test('the cheap tier is reachable only by explicitly naming it', () => {
  // mechanicalModel is the ONLY door to the cheap model, and it is for schema-validated output
  // that never reaches the user as prose.
  assertEquals(mechanicalModel().model, getModelConfig().fast.model);
  assertEquals(mechanicalModel().effort, 'none');
});

Deno.test('safety-critical turns always deliberate', () => {
  // A high-risk turn is where allergen / injury / disordered-eating / crisis signals land.
  // A fast wrong answer is worth nothing here.
  for (const subtype of ALL_SUBTYPES) {
    const sel = selectModel(analysis({ subtype, riskLevel: 'high' }), false);
    assertEquals(sel.effort, 'medium', `high-risk ${subtype} must think`);
  }
});

Deno.test('turns that commit numbers deliberate; conversation does not stall', () => {
  for (const subtype of ['symptom_decision', 'plateau_diagnosis', 'weekly_review', 'general_analysis', 'meal_guidance', 'workout_plan'] as MessageSubtype[]) {
    assertEquals(selectModel(analysis({ subtype }), false).effort, 'medium', `${subtype} must deliberate`);
  }
  for (const subtype of ['meal_log', 'workout_log', 'weight_log', 'water_sleep_mood_log', 'qa_general', 'qa_personalized', 'motivation', 'behavior_correction', 'general_coaching'] as MessageSubtype[]) {
    assertEquals(selectModel(analysis({ subtype }), false).effort, 'low', `${subtype} must stay responsive`);
  }
});

Deno.test('a bare greeting spends no thinking — but still meets the full context spine', () => {
  const sel = selectModel(analysis({ subtype: 'pure_greeting', taskMode: 'daily_log' }), false);
  assertEquals(sel.effort, 'none');
  // Crucially still the PRIMARY model: the coach must know who it is greeting. `none` buys
  // latency, not amnesia — the context spine is assembled upstream and is unconditional.
  assertEquals(sel.model, getModelConfig().smart.model);
});

Deno.test('plan generation keeps its large visible budget and deliberates', () => {
  for (const mode of ['plan', 'plan_diet', 'plan_workout']) {
    const sel = selectModel(analysis({ subtype: 'default_subtype' }), false, mode);
    assertEquals(sel.maxTokens, 8000, `${mode} must keep room for the whole 7-day snapshot`);
    assertEquals(sel.effort, 'medium');
  }
});

Deno.test('the plan override wins over an unrelated analysed subtype', () => {
  // The plan modes arrive as a client hint, not from message analysis. A greeting-looking message
  // that is actually a plan request must not fall into the greeting fast path.
  const sel = selectModel(analysis({ subtype: 'pure_greeting', taskMode: 'daily_log' }), false, 'plan_diet');
  assertEquals(sel.maxTokens, 8000);
  assertEquals(sel.effort, 'medium');
});

Deno.test('a photo estimates portions, so it thinks a little', () => {
  const sel = selectModel(analysis({ subtype: 'meal_log' }), true);
  assertEquals(sel.reason, 'vision_required');
  // Not 'none': the calorie number that follows is one the user eats to.
  assertEquals(sel.effort, 'low');
});

Deno.test('every returned effort is a value the API accepts', () => {
  const allowed = new Set(['none', 'low', 'medium', 'high', 'xhigh', 'max']);
  for (const subtype of ALL_SUBTYPES) {
    for (const taskMode of ALL_MODES) {
      const sel = selectModel(analysis({ subtype, taskMode }), false);
      assert(allowed.has(sel.effort), `${sel.effort} is not a valid reasoning effort`);
    }
  }
});
