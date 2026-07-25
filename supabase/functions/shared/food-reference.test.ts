/**
 * Food-reference grounding tests. The grounded macros OVERRIDE the model estimate and feed the
 * deficit ledger the whole app optimizes, so a portion-parsing error here silently poisons every
 * downstream number. These lock the household-unit → grams math. Run: `deno test food-reference.test.ts`.
 */
import { computeItemNutrition } from './food-reference.ts';

function ok(cond: boolean, msg: string): void { if (!cond) throw new Error(`ASSERT FAILED: ${msg}`); }
function near(actual: number, expected: number, tol: number, msg: string): void {
  if (Math.abs(actual - expected) > tol) throw new Error(`ASSERT FAILED: ${msg}\n  expected ~${expected} (±${tol}), got ${actual}`);
}

Deno.test('kase respects the food dry-basis (the 972-kcal oatmeal bug)', () => {
  const r = computeItemNutrition('yulaf ezmesi', '1 kase');
  ok(r !== null, 'yulaf must resolve');
  // portionG 40 (dry) × 3.89 kcal/g ≈ 156 — NOT 250g × 3.89 = 972.
  near(r!.calories, 156, 25, '"1 kase yulaf" must be ~156 kcal, not ~972');
});

Deno.test('gram entry is exact against the dry basis', () => {
  const r = computeItemNutrition('yulaf', '60 gram');
  near(r!.calories, 233, 10, '60g dry yulaf ≈ 233 kcal (60/100×389)');
});

Deno.test('kase of a 250g-portion food is unchanged (no regression)', () => {
  const r = computeItemNutrition('mantı', '1 kase'); // portionG 250
  ok(r !== null, 'mantı resolves');
  near(r!.calories, 500, 40, '1 kase mantı ≈ 250g × 2.0 kcal/g ≈ 500');
});

Deno.test('unresolved food returns null (caller keeps model estimate)', () => {
  ok(computeItemNutrition('zzz-olmayan-yemek', '1 porsiyon') === null, 'unknown food must not ground');
});

// ── AI-behaviour #6: the user's taught portion beats the generic household table ──
// NOTE: portion_calibration is keyed by FOOD NAME with {grams,count,confirmed} — the shape the only
// writer in the app produces (ai-chat: raw[pu.food.toLowerCase()] = {...}). Earlier drafts of these
// tests used unit-shaped keys ({tabak:…}) that NO writer emits, which hid a real wiring bug.
Deno.test('personal portion calibration overrides the household table', () => {
  const generic = computeItemNutrition('pilav', '1 tabak');
  const mine = computeItemNutrition('pilav', '1 tabak', { pilav: { grams: 200, count: 4, confirmed: true } });
  ok(generic !== null && mine !== null, 'both resolve');
  near(mine!.grams, 200, 1, `calibrated plate must be 200 g, got ${mine!.grams}`);
  ok(mine!.grams !== generic!.grams, 'calibration must actually change the result');
});

Deno.test('calibration still scales with count and size words', () => {
  const half = computeItemNutrition('pilav', 'yarım tabak', { pilav: { grams: 200, count: 3, confirmed: true } });
  near(half!.grams, 100, 1, '"yarım tabak" of a 200 g plate = 100 g');
  const two = computeItemNutrition('pilav', '2 tabak', { pilav: { grams: 200, count: 3, confirmed: true } });
  near(two!.grams, 400, 1, '"2 tabak" of a 200 g plate = 400 g');
});

Deno.test('an explicit gram figure still beats calibration', () => {
  const r = computeItemNutrition('pilav', '150 gram', { pilav: { grams: 200, count: 5, confirmed: true } });
  near(r!.grams, 150, 1, 'explicit grams win over a calibrated food');
});

Deno.test('an UNCONFIRMED single observation must NOT override the reference table', () => {
  const generic = computeItemNutrition('pilav', '1 tabak');
  const once = computeItemNutrition('pilav', '1 tabak', { pilav: { grams: 200, count: 1, confirmed: false } });
  near(once!.grams, generic!.grams, 1, 'one unverified correction must not rewrite the food (Spec 5.23 needs 3+)');
});

Deno.test('a 2-char calibration key cannot substring-match an unrelated food', () => {
  const generic = computeItemNutrition('ekmek', '1 dilim');
  const withEt = computeItemNutrition('ekmek', '1 dilim', { et: { grams: 500, count: 9, confirmed: true } });
  near(withEt!.grams, generic!.grams, 1, '"et" must not calibrate "ekmek"');
});
