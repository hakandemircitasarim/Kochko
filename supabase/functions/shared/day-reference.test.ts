import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { simulationTargetDay } from './day-reference.ts';

// 2026-10-04 is a SUNDAY (the diff#4 repro: tomorrow already belongs to a new budget week).
const SUN = '2026-10-04';
const MON = '2026-10-05';

Deno.test('diff#4: "yarın akşam ... yesem" is about tomorrow', () => {
  assertEquals(simulationTargetDay('yarın akşam 2 dilim pizza yesem ne olur?', SUN), { date: '2026-10-05', label: 'yarın' });
  assertEquals(simulationTargetDay('YARIN pizza yesem', SUN), { date: '2026-10-05', label: 'yarın' });
  assertEquals(simulationTargetDay('yarin aksam pizza yesem', SUN), { date: '2026-10-05', label: 'yarın' });
});

Deno.test('diff#4: no day word, a today cue, or only a past day → today (null)', () => {
  assertEquals(simulationTargetDay('2 dilim pizza yesem ne olur?', SUN), null);
  assertEquals(simulationTargetDay('bu akşam pizza yesem?', SUN), null);
  assertEquals(simulationTargetDay('dün çok yedim, pizza yesem?', SUN), null);
  assertEquals(simulationTargetDay('bugünkü yemeğe ek olarak pizza yesem', SUN), null);
  assertEquals(simulationTargetDay('', SUN), null);
});

Deno.test('diff#4: the day word nearest BEFORE the hypothetical verb wins', () => {
  assertEquals(simulationTargetDay('bugün çok yedim, yarın pizza yesem?', SUN)?.label, 'yarın');
  assertEquals(simulationTargetDay('yarın spor var, bu akşam pizza yesem?', SUN), null);
  // A day word only AFTER the verb is the consequence, not the meal's day.
  assertEquals(simulationTargetDay('pizza yesem yarın tartıda ne olur?', SUN), null);
});

Deno.test('diff#4: weekday names resolve to their next occurrence; today\'s own weekday is today', () => {
  assertEquals(simulationTargetDay('cumartesi düğün var, baklava yesem?', SUN), { date: '2026-10-10', label: 'cumartesi' });
  assertEquals(simulationTargetDay('salı akşamı mantı yesem', MON), { date: '2026-10-06', label: 'salı' });
  assertEquals(simulationTargetDay('cumaya pizza yesem', MON), { date: '2026-10-09', label: 'cuma' });
  assertEquals(simulationTargetDay('pazar günü lahmacun yesem', SUN), null);
  assertEquals(simulationTargetDay('pazartesi pizza yesem', SUN), { date: '2026-10-05', label: 'pazartesi' });
});

Deno.test('diff#4: "pazar" as the market is not Sunday', () => {
  assertEquals(simulationTargetDay('pazardan aldığım elmayı yesem', MON), null);
  assertEquals(simulationTargetDay('pazar yeri gözlemesi yesem', MON), null);
});

Deno.test('diff#4: haftaya / hafta sonu / N gün sonra / öbür gün', () => {
  assertEquals(simulationTargetDay('haftaya salı doğum günü, pasta yesem', MON), { date: '2026-10-13', label: 'haftaya salı' });
  assertEquals(simulationTargetDay('hafta sonu pizza yesem', MON), { date: '2026-10-10', label: 'hafta sonu' });
  assertEquals(simulationTargetDay('hafta sonu pizza yesem', '2026-10-10'), null); // Saturday: the weekend is today
  assertEquals(simulationTargetDay('gelecek hafta sonu düğün var, baklava yesem', MON), { date: '2026-10-17', label: 'gelecek hafta sonu' });
  assertEquals(simulationTargetDay('gelecek hafta her gün tatlı yesem', MON), { date: '2026-10-12', label: 'gelecek hafta' });
  assertEquals(simulationTargetDay('3 gün sonra pizza yesem', SUN), { date: '2026-10-07', label: '3 gün sonra' });
  assertEquals(simulationTargetDay('öbür gün mangal yesem', SUN), { date: '2026-10-06', label: 'öbür gün' });
});
