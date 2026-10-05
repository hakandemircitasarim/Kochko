import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  deriveWaterLiters, nextWaterLiters, waterIsDailyTotal, waterModeOf,
  WATER_FLAG_SINGLE_ADD_LITERS, WATER_MAX_LITERS_PER_WRITE,
} from './water-intent.ts';

Deno.test('waterIsDailyTotal: "bugün X litre" and explicit totals SET the day', () => {
  for (const m of [
    'bugün 2 litre içtim',
    'Bugün 1,5 lt su içtim',
    'bugun yarım litre su ictim ancak',
    'bugün toplam 8 bardak su içtim',
    'şu ana kadar 3 bardak su içtim',
    'gün boyu 2 litre su içtim',
    'toplamda 2.5 l su',
  ]) assertEquals(waterIsDailyTotal(m), true, m);
});

Deno.test('waterIsDailyTotal: single drinks and "daha" ADD', () => {
  for (const m of [
    '2 bardak su içtim',
    'bir bardak su içtim',
    'bugün 2 bardak su içtim',
    '1 litre daha içtim',
    'bugün 1 litre daha su içtim',
    'şimdi 500 ml su içtim',
    'az önce yarım litre su içtim',
    '2 litre su içtim',
    '',
  ]) assertEquals(waterIsDailyTotal(m), false, m);
  assertEquals(waterIsDailyTotal(null), false);
});

Deno.test('waterIsDailyTotal: "toplantı" is not "toplam"', () => {
  assertEquals(waterIsDailyTotal('toplantıda 2 bardak su içtim'), false);
});

Deno.test('nextWaterLiters: total replaces, drink adds, float noise rounded', () => {
  assertEquals(nextWaterLiters(1.5, 2, true), 2);
  assertEquals(nextWaterLiters(1.5, 0.5, false), 2);
  assertEquals(nextWaterLiters(0.1, 0.2, false), 0.3);
});

// ─── Faz 0 #2: water_log {as_stated, quantity, unit, mode} — code does the unit math ───

Deno.test('deriveWaterLiters: "1 bardak su" is 0.2 L, never 1 L (final2#3)', () => {
  assertEquals(deriveWaterLiters({ as_stated: '1 bardak', quantity: 1, unit: 'bardak', mode: 'add' }),
    { ok: true, liters: 0.2, mode: 'add', source: 'unit' });
});

Deno.test('deriveWaterLiters: every enum unit converts via UNIT_ML', () => {
  const cases: [number, string, number][] = [
    [500, 'ml', 0.5], [1.5, 'litre', 1.5], [2, 'su_bardagi', 0.4], [3, 'cay_bardagi', 0.3],
    [1, 'kupa', 0.25], [1, 'sise_330', 0.33], [1, 'sise_500', 0.5], [1, 'sise_1500', 1.5], [0.5, 'bardak', 0.1],
  ];
  for (const [quantity, unit, liters] of cases) {
    const d = deriveWaterLiters({ quantity, unit, mode: 'add' });
    assertEquals(d.ok && d.liters, liters, `${quantity} ${unit}`);
  }
});

Deno.test('deriveWaterLiters: kupa keeps its 0.25 (NUMERIC(4,2) — no 0.3 rounding in code)', () => {
  const d = deriveWaterLiters({ quantity: 1, unit: 'kupa' });
  assertEquals(d.ok && d.liters, 0.25);
});

Deno.test('deriveWaterLiters: unit=other uses the model\'s own ml estimate, and requires it', () => {
  const d = deriveWaterLiters({ as_stated: '2 matara', quantity: 2, unit: 'other', other_ml_each: 750, mode: 'add' });
  assertEquals(d.ok && d.liters, 1.5);
  assertEquals(deriveWaterLiters({ quantity: 2, unit: 'other' }), { ok: false, reason: 'other_without_ml' });
  assertEquals(deriveWaterLiters({ quantity: 2, unit: 'other', other_ml_each: 5000 }), { ok: false, reason: 'other_without_ml' });
});

Deno.test('deriveWaterLiters: the model\'s enum spelling is tolerated (its field, not user text)', () => {
  for (const unit of ['Su bardağı', 'su-bardagi', 'SU_BARDAGI']) {
    const d = deriveWaterLiters({ quantity: 1, unit });
    assertEquals(d.ok && d.liters, 0.2, unit);
  }
  const l = deriveWaterLiters({ quantity: 2, unit: 'L' });
  assertEquals(l.ok && l.liters, 2);
  assertEquals(deriveWaterLiters({ quantity: '1,5', unit: 'litre' }).ok, true);
});

Deno.test('deriveWaterLiters: legacy {liters} is the fallback; the new shape wins when present', () => {
  assertEquals(deriveWaterLiters({ liters: 0.5 }), { ok: true, liters: 0.5, mode: null, source: 'legacy_liters' });
  assertEquals(deriveWaterLiters({ liters: 2, mode: 'set_day_total' }), { ok: true, liters: 2, mode: 'set_day_total', source: 'legacy_liters' });
  // A model that writes BOTH: the unit math decides, the stray litre field cannot re-inflate it.
  const both = deriveWaterLiters({ quantity: 1, unit: 'bardak', liters: 1 });
  assertEquals(both.ok && both.liters, 0.2);
});

Deno.test('deriveWaterLiters: hard bounds REJECT, never clamp', () => {
  assertEquals(deriveWaterLiters({ quantity: 250, unit: 'litre' }), { ok: false, reason: 'bad_quantity' });
  assertEquals(deriveWaterLiters({ quantity: 10, unit: 'litre' }), { ok: false, reason: 'out_of_range' });
  assertEquals(deriveWaterLiters({ quantity: 9000, unit: 'ml' }), { ok: false, reason: 'bad_quantity' });
  assertEquals(deriveWaterLiters({ quantity: 1500, unit: 'ml' }).ok, true); // ml is not a container count
  assertEquals(deriveWaterLiters({ liters: WATER_MAX_LITERS_PER_WRITE + 0.5 }), { ok: false, reason: 'out_of_range' });
  assertEquals(deriveWaterLiters({ liters: -1 }), { ok: false, reason: 'out_of_range' });
  assertEquals(deriveWaterLiters({ quantity: 1, unit: 'kova' }), { ok: false, reason: 'bad_unit' });
  assertEquals(deriveWaterLiters({ unit: 'bardak' }), { ok: false, reason: 'bad_quantity' });
  assertEquals(deriveWaterLiters({ type: 'water_log' }), { ok: false, reason: 'no_amount' });
  // 8 L itself is inside the bound; > 1.5 L single adds are FLAGGED by the caller, not rejected here.
  assertEquals(deriveWaterLiters({ quantity: 8, unit: 'litre' }).ok, true);
  assertEquals(WATER_FLAG_SINGLE_ADD_LITERS < WATER_MAX_LITERS_PER_WRITE, true);
});

Deno.test('waterModeOf: only the two enum values count as the model\'s decision', () => {
  assertEquals(waterModeOf({ mode: 'add' }), 'add');
  assertEquals(waterModeOf({ mode: ' SET_DAY_TOTAL ' }), 'set_day_total');
  assertEquals(waterModeOf({ mode: 'total' }), null);
  assertEquals(waterModeOf({}), null);
});
