import { assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { pickFollowUpAction } from './context-builders.ts';

const r = (date: string, tomorrow_action: string | null) => ({ date, compliance_score: 50, deviation_reason: null, tomorrow_action });

Deno.test('final2#7: today\'s own report (tomorrow\'s step) never feeds DUNKU AKSIYON', () => {
  const reports = [r('2026-10-02', 'A'), r('2026-10-03', 'B'), r('2026-10-04', 'Yarın saat 16.00\'da tavuk ye')];
  assertEquals(pickFollowUpAction(reports, '2026-10-04')?.tomorrow_action, 'B');
});

Deno.test('final2#7: an empty or "-" action falls back to the day before', () => {
  const reports = [r('2026-10-02', 'A'), r('2026-10-03', '-'), r('2026-10-04', 'C')];
  assertEquals(pickFollowUpAction(reports, '2026-10-04')?.date, '2026-10-02');
  assertEquals(pickFollowUpAction([r('2026-10-02', 'A'), r('2026-10-03', '  ')], '2026-10-04')?.date, '2026-10-02');
});

Deno.test('final2#7: an action older than two days is stale, not "dünkü"', () => {
  assertEquals(pickFollowUpAction([r('2026-10-01', 'eski'), r('2026-10-04', 'C')], '2026-10-04'), null);
  assertEquals(pickFollowUpAction([], '2026-10-04'), null);
});

Deno.test('final2#7: input order does not matter — the newest qualifying report wins', () => {
  const reports = [r('2026-10-03', 'B'), r('2026-10-02', 'A')];
  assertEquals(pickFollowUpAction(reports, '2026-10-04')?.tomorrow_action, 'B');
});
