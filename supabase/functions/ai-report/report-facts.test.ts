import { assert, assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { goalKgLeft, goalPromptLine, partialFoodLog, resolveWaterTarget, workoutPromptLine } from './report-facts.ts';

Deno.test('diff#10: a passed lose goal is reached, not "0.6kg kaldi"', () => {
  assertEquals(Math.round(goalKgLeft('lose_weight', 69.4, 70) * 10) / 10, -0.6);
  const line = goalPromptLine('lose_weight', 70, 69.4, 10, 12);
  assert(line.includes('hedefe ulasildi'), line);
  assert(line.includes('hedef 0.6kg gecildi'), line);
  assert(!line.includes('kaldi'), line);
  assert(!line.includes('Gereken tempo'), line);
});

Deno.test('diff#10: a passed gain goal is reached too', () => {
  assert(goalKgLeft('gain_muscle', 76.2, 75) < 0);
  assert(goalKgLeft('gain_weight', 60.5, 60) < 0);
  assert(goalPromptLine('gain_weight', 60, 60.5, 4, 12).includes('hedefe ulasildi'));
});

Deno.test('diff#10: still on the way keeps the remaining kg and the pace', () => {
  const lose = goalPromptLine('lose_weight', 70, 74, 4, 12);
  assert(lose.includes('4.0kg kaldi'), lose);
  assert(lose.includes('Gereken tempo: 0.50kg/hafta'), lose);
  const gain = goalPromptLine('gain_muscle', 80, 77, 2, 12);
  assert(gain.includes('3.0kg kaldi'), gain);
  // Out of time but not there: no pace, no "ulasildi".
  const late = goalPromptLine('lose_weight', 70, 72, 14, 12);
  assert(late.includes('hedef suresi doldu'), late);
  assert(late.includes('12/12 hafta'), late);
});

Deno.test('diff#10: float noise at the target reads "hedefte"', () => {
  assertEquals(goalKgLeft('lose_weight', 70.0000001, 70), 0);
  const line = goalPromptLine('lose_weight', 70, 70, 6, 12);
  assert(line.includes('hedefte') && line.includes('hedefe ulasildi'), line);
});

Deno.test('diff#10: maintain keeps the plain distance (no direction to pass)', () => {
  assertEquals(goalKgLeft('maintain', 69, 70), 1);
  assertEquals(goalKgLeft('maintain', 71, 70), 1);
});

Deno.test('final2#17: one logged dinner of a 2-meal user, under the floor, is a partial log', () => {
  // The live repro: 1012 kcal, one dinner, meal_count_preference 2, plan floor 1994.
  const r = partialFoodLog(['dinner'], 2, 1012, 1994);
  assertEquals(r, { partial: true, logged: 1, usual: 2 });
});

Deno.test('final2#17: a complete day under target is real under-eating, not partial', () => {
  assertEquals(partialFoodLog(['breakfast', 'lunch', 'dinner'], 3, 1500, 1994).partial, false);
  // ...unless intake is under half the floor, whatever the meal count.
  assertEquals(partialFoodLog(['breakfast', 'lunch', 'dinner'], 3, 900, 1994).partial, true);
});

Deno.test('final2#17: inside/over the band or no plan band is never partial', () => {
  assertEquals(partialFoodLog(['dinner'], 3, 2100, 1994).partial, false);
  assertEquals(partialFoodLog(['dinner'], 3, 800, 0).partial, false);
  assertEquals(partialFoodLog([], 3, 0, 1994).partial, false); // no log at all: handled as "YEMEK KAYDI YOK"
});

Deno.test('final2#17: meal types are counted once; bad preference falls back to the DB default 3', () => {
  assertEquals(partialFoodLog(['snack', 'snack', 'lunch'], null, 1000, 1994).logged, 2);
  assertEquals(partialFoodLog(['lunch'], 'abc', 1000, 1994).usual, 3);
  assertEquals(partialFoodLog(['lunch'], 0, 1000, 1994).usual, 3);
});

Deno.test('diff#9: no plan row is "plan yok", never an asserted rest day', () => {
  const none = workoutPromptLine(0, 0, null);
  assert(none.startsWith('plan yok'), none);
  assert(!none.includes('antrenman beklenmiyor'), none);
  assertEquals(workoutPromptLine(0, 0, { plan_type: 'rest' }), 'dinlenme gunu (antrenman beklenmiyor)');
  assertEquals(workoutPromptLine(0, 0, { plan_type: 'training' }), 'planli antrenman gunu, kayit yok');
  assertEquals(workoutPromptLine(2, 75, null), '2 seans, 75 dk');
});

Deno.test('diff#9: water target — plan, then profile, else a default flagged unknown', () => {
  assertEquals(resolveWaterTarget(3.1, 2.6), { liters: 3.1, known: true });
  assertEquals(resolveWaterTarget(null, 2.6), { liters: 2.6, known: true });
  assertEquals(resolveWaterTarget(0, null), { liters: 2.5, known: false });
});
