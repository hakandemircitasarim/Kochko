import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { expandCompactDietSnapshot } from './plan-compact.ts';

Deno.test('compact item rows expand to the full schema; meal totals are computed', () => {
  const snap = expandCompactDietSnapshot({
    days: [{ day_index: 0, meals: [{ meal_type: 'lunch', items: [['tavuk göğsü', 150, 248, 47, 0, 5], ['bulgur pilavı', 200, 280, 8, 56, 2]] }] }],
  })!;
  const meal = ((snap.days as Record<string, unknown>[])[0].meals as Record<string, unknown>[])[0];
  assertEquals((meal.items as Record<string, unknown>[])[0], { name: 'tavuk göğsü', grams: 150, kcal: 248, protein: 47, carbs: 0, fat: 5 });
  assertEquals([meal.total_kcal, meal.total_protein, meal.total_carbs, meal.total_fat], [528, 55, 56, 7]);
});

Deno.test('object items pass through; model-written totals are kept', () => {
  const item = { name: 'yulaf', grams: 60, kcal: 220, protein: 8, carbs: 38, fat: 4 };
  const snap = expandCompactDietSnapshot({ days: [{ meals: [{ items: [item], total_kcal: 230 }] }] })!;
  const meal = ((snap.days as Record<string, unknown>[])[0].meals as Record<string, unknown>[])[0];
  assertEquals((meal.items as unknown[])[0], item);
  assertEquals(meal.total_kcal, 230);
  assertEquals(meal.total_protein, 8);
});

Deno.test('malformed rows are dropped, string numbers are tolerated', () => {
  const snap = expandCompactDietSnapshot({ days: [{ meals: [{ items: [[null, 1, 2], ['ayran', '200', '76,5', 4, 6, 4]] }] }] })!;
  const items = (((snap.days as Record<string, unknown>[])[0].meals as Record<string, unknown>[])[0].items) as Record<string, unknown>[];
  assertEquals(items.length, 1);
  assertEquals(items[0].kcal, 76.5);
});
