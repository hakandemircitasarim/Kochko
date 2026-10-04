import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { nextWaterLiters, waterIsDailyTotal } from './water-intent.ts';

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
