import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { applyPlanTargets, computePlanTargets, parseWeekdays, renderPlanTargets } from './plan-targets.ts';

Deno.test('parseWeekdays: Turkish day names, including the cuma/cumartesi and pazar/pazartesi traps', () => {
  assertEquals(parseWeekdays('salı ve perşembe akşamları'), [1, 3]);
  assertEquals(parseWeekdays('cumartesi sabahı'), [5]);
  assertEquals(parseWeekdays('cuma ve pazar'), [4, 6]);
  assertEquals(parseWeekdays('pazartesi'), [0]);
  assertEquals(parseWeekdays('hafta içi akşam 19-21'), [0, 1, 2, 3, 4]);
  assertEquals(parseWeekdays('sabah 7-8 arası'), []);
});

const profile = {
  tdee_calculated: 2600,
  calorie_range_rest_min: 2000, calorie_range_rest_max: 2200,
  calorie_range_training_min: 2300, calorie_range_training_max: 2500,
  weight_kg: 80, protein_per_kg: 1.8, meal_count_preference: 2,
  available_training_times: 'salı ve perşembe akşamları',
};

Deno.test('computePlanTargets: bands → rest/training targets; schedule → training days; saved prefs kept', () => {
  const t = computePlanTargets(profile, null)!;
  assertEquals([t.restKcal, t.trainingKcal, t.proteinG, t.mealsPerDay], [2100, 2400, 144, 2]);
  assertEquals(t.trainingDays, [1, 3]);
  assertEquals(t.trainingSource, 'profile_text');
  // an active workout plan outranks the free-text schedule
  assertEquals(computePlanTargets(profile, [0, 2, 4])!.trainingDays, [0, 2, 4]);
});

Deno.test('computePlanTargets: no calorie band yet → null (model keeps computing, as before)', () => {
  assertEquals(computePlanTargets({ weight_kg: 80 }, null), null);
});

Deno.test('applyPlanTargets: the stored snapshot carries the server numbers, training days get more', () => {
  const t = computePlanTargets(profile, null)!;
  const snap: Record<string, unknown> = {
    targets: { kcal: 2000, protein: 150, carbs: 200, fat: 65 },
    days: [0, 1, 2, 3, 4, 5, 6].map((i) => ({ day_index: i, meals: [] })),
  };
  applyPlanTargets(snap, t);
  assertEquals((snap.targets as Record<string, number>).kcal, 2100);
  assertEquals((snap.targets as Record<string, number>).protein, 144);
  const perDay = (snap.days as Array<Record<string, number>>).map((d) => d.target_kcal);
  assertEquals(perDay, [2100, 2400, 2100, 2400, 2100, 2100, 2100]);
  const block = renderPlanTargets(t);
  if (!block.includes('Salı (day_index 1)') || !block.includes('TAM 2 ana öğün')) throw new Error(block);
});
