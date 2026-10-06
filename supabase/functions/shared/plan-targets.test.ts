import { assert, assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  applyPlanTargets, computePlanTargets, dietPlanHoldsMaintenance, maintenanceHoldBand, maintenanceTdee, parseWeekdays, renderPlanTargets,
} from './plan-targets.ts';

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

// ── Faz 0 #6 (mem#4): the numeric ED gate ──────────────────────────────────────────────────────────

const days7 = () => [0, 1, 2, 3, 4, 5, 6].map((i) => ({ day_index: i, meals: [] as unknown[] }));
const planFrom = (t: NonNullable<ReturnType<typeof computePlanTargets>>) => {
  const snap: Record<string, unknown> = { targets: { kcal: 0 }, days: days7() };
  applyPlanTargets(snap, t);
  return snap;
};
// mem (live 2026-10-04, ed_tier amber). The stored band is what the ED cap wrote: the deficit shaper
// run at goal 'maintain' on TDEE 3062 — its rest-day edge (2659) sits 5% + 250 kcal under TDEE.
const memProfile = {
  tdee_calculated: 3062, gender: 'male',
  calorie_range_rest_min: 2659, calorie_range_rest_max: 2965,
  calorie_range_training_min: 2909, calorie_range_training_max: 3215,
  weight_kg: 83, protein_per_kg: 1.8,
};
// A lose-weight band set BEFORE the tier rose (the band shaper at 0.85 × TDEE).
const deficitProfile = {
  ...memProfile,
  calorie_range_rest_min: 2223, calorie_range_rest_max: 2483,
  calorie_range_training_min: 2473, calorie_range_training_max: 2733,
};

Deno.test('maintenanceHoldBand: maintenance at the CURRENT TDEE (the maintenance-band owner), clinically floored', () => {
  assertEquals(maintenanceHoldBand(3062, 'male'), { restMin: 2962, restMax: 3212, trainingMin: 3062, trainingMax: 3412 });
  const tiny = maintenanceHoldBand(1300, 'male');
  assert(tiny.restMin >= 1500 && tiny.trainingMin >= 1500 && tiny.restMax >= tiny.restMin);
});

Deno.test('mem#4 as reported (TDEE 2800, every day 2812): a plan at maintenance is APPROVABLE while the deficit gate is closed', () => {
  const plan = planFrom(computePlanTargets(memProfile, null)!); // every day 2812, like the live draft
  const v = dietPlanHoldsMaintenance(plan, maintenanceHoldBand(2800, 'male'));
  assertEquals([v.holds, v.floorKcal, v.lowestKcal], [true, 2700, 2812]);
});

Deno.test('mem#4: maintenance is TDEE-based — never merely the stored calorie_range_rest_min', () => {
  const band = maintenanceHoldBand(3062, 'male');
  // The same 2812/day draft once TDEE is 3062: 250 kcal/day under maintenance. The stored ED-cap
  // band (rest_min 2659) would have waved it through.
  const capPlan = planFrom(computePlanTargets(memProfile, null)!);
  assertEquals(dietPlanHoldsMaintenance(capPlan, { restMin: memProfile.calorie_range_rest_min }).holds, true, 'the weak (rest_min) gate');
  assertEquals(dietPlanHoldsMaintenance(capPlan, band).holds, false);
  // A plain deficit band set before the tier rose: passes its own rest_min, refused against TDEE.
  const cutPlan = planFrom(computePlanTargets(deficitProfile, [1, 3])!);
  assertEquals(dietPlanHoldsMaintenance(cutPlan, { restMin: deficitProfile.calorie_range_rest_min }).holds, true, 'the weak (rest_min) gate');
  const v = dietPlanHoldsMaintenance(cutPlan, band);
  assertEquals([v.holds, v.floorKcal, v.lowestKcal], [false, 2962, 2353]);
  // One low day is enough.
  const oneLow = planFrom(computePlanTargets(memProfile, null, band)!);
  assertEquals(dietPlanHoldsMaintenance(oneLow, band).holds, true);
  (oneLow.days as Array<Record<string, number>>)[4].target_kcal = 2400;
  assertEquals(dietPlanHoldsMaintenance(oneLow, band).holds, false);
});

Deno.test('Faz 0 #6: a plan generated under the hold always passes the gate (the offered fix cannot dead-end)', () => {
  const hold = maintenanceHoldBand(3062, 'male');
  for (const p of [deficitProfile, memProfile]) {
    const t = computePlanTargets(p, [1, 3], hold)!;
    assertEquals([t.restKcal, t.trainingKcal, t.heldAtMaintenance], [3087, 3237, true]);
    assertEquals(dietPlanHoldsMaintenance(planFrom(t), hold).holds, true);
    if (!renderPlanTargets(t).includes('BAKIM seviyesinde')) throw new Error(renderPlanTargets(t));
  }
  // The hold only RAISES: a band already at/above maintenance (e.g. maintenance mode) is used as is.
  const atMaintenance = computePlanTargets({
    ...memProfile,
    calorie_range_rest_min: 2962, calorie_range_rest_max: 3212, calorie_range_training_min: 3062, calorie_range_training_max: 3412,
  }, null, hold)!;
  assertEquals([atMaintenance.restKcal, atMaintenance.trainingKcal, atMaintenance.heldAtMaintenance], [3087, 3237, false]);
  const high = computePlanTargets({
    ...memProfile,
    calorie_range_rest_min: 3100, calorie_range_rest_max: 3300, calorie_range_training_min: 3300, calorie_range_training_max: 3500,
  }, null, hold)!;
  assertEquals([high.restKcal, high.trainingKcal, high.heldAtMaintenance], [3200, 3400, false]);
  assertEquals(renderPlanTargets(computePlanTargets(memProfile, null)!).includes('BAKIM'), false);
  // No stored band at all → the plan is built from the maintenance band.
  const fromHold = computePlanTargets({ weight_kg: 83 }, null, hold)!;
  assertEquals([fromHold.restKcal, fromHold.trainingKcal], [3087, 3237]);
});

Deno.test('Faz 0 #6: what cannot be judged does not pass (fail closed)', () => {
  const band = maintenanceHoldBand(3062, 'male');
  assertEquals(dietPlanHoldsMaintenance(planFrom(computePlanTargets(memProfile, null, band)!), null).holds, false, 'no maintenance band');
  assertEquals(dietPlanHoldsMaintenance({ days: [] }, band).holds, false, 'no days');
  assertEquals(dietPlanHoldsMaintenance(null, band).holds, false, 'no plan');
  assertEquals(dietPlanHoldsMaintenance({ days: [{ day_index: 0, meals: [] }] }, band).holds, false, 'a day with no number');
  // A draft without server targets is judged by its own day totals.
  const legacy = { targets: { kcal: 3000 }, days: [{ total_kcal: 3050 }, { meals: [{ total_kcal: 1500 }, { total_kcal: 1500 }] }] };
  assertEquals(dietPlanHoldsMaintenance(legacy, band).holds, true);
  assertEquals(dietPlanHoldsMaintenance({ ...legacy, targets: { kcal: 1900 } }, band).holds, false, 'a deficit week target');
});

Deno.test('maintenanceTdee: the stored TDEE, else Mifflin × activity from the profile, else null', () => {
  assertEquals(maintenanceTdee({ tdee_calculated: 3062 }), 3062);
  // 83 kg, 180 cm, 30 y, male, active: BMR 1810 × 1.725
  assertEquals(maintenanceTdee({ weight_kg: 83, height_cm: 180, birth_year: 1996, gender: 'male', activity_level: 'active' }, 2026), 3122);
  assertEquals(maintenanceTdee({ weight_kg: 83 }), null);
});
