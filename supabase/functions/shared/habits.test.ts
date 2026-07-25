/**
 * Habit-ladder tests (AI-behaviour #14). These lock the three failures that made the app's central
 * behaviour-change mechanic dead: a gate that could never fire (weekly_compliance had no writer), two
 * habit vocabularies (key / name / habit), and monotonic streaks that survived long absences.
 * Run: `deno test habits.test.ts`
 */
import { normalizeHabitEntry, deriveHabitStats, readyForNextHabit, HABIT_CATALOG } from './habits.ts';

function ok(cond: boolean, msg: string): void { if (!cond) throw new Error(`ASSERT FAILED: ${msg}`); }
function eq<T>(a: T, b: T, msg: string): void {
  if (a !== b) throw new Error(`ASSERT FAILED: ${msg}\n  expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

const TODAY = '2026-07-24';
const daysBefore = (n: number) => new Date(Date.parse(`${TODAY}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);

// ── identity: all three writer generations must normalise to the same key ──
Deno.test('normalizeHabitEntry unifies key / name / habit vocabularies', () => {
  const byKey = normalizeHabitEntry({ key: 'water_tracking', status: 'active', streak: 3 });
  const byName = normalizeHabitEntry({ name: 'Su takibi', status: 'active', streak: 3 });
  const byHabit = normalizeHabitEntry({ habit: 'Su takibi', status: 'active', streak: 3 });
  eq(byKey?.key, 'water_tracking', 'explicit key kept');
  eq(byName?.key, 'water_tracking', 'label → catalog key');
  eq(byHabit?.key, 'water_tracking', 'the chat writer\'s `habit` field → catalog key (was undefined)');
  eq(byHabit?.name, 'Su takibi', 'canonical label restored');
});

Deno.test('normalizeHabitEntry rejects junk but keeps unknown custom habits', () => {
  eq(normalizeHabitEntry(null), null, 'null → null');
  eq(normalizeHabitEntry({ status: 'active' }), null, 'no identifier at all → null');
  const custom = normalizeHabitEntry({ habit: 'Akşam yürüyüşü', status: 'active' });
  ok(custom !== null && custom.key === 'akşam_yürüyüşü', 'a custom habit still gets a stable key');
});

// ── derived stats: the previously-unwritten weekly_compliance and the monotonic streak ──
Deno.test('deriveHabitStats computes a real streak and weekly compliance', () => {
  const log = [0, 1, 2, 3, 4].map(daysBefore); // today + 4 previous days
  const st = deriveHabitStats(log, TODAY);
  eq(st.streak, 5, '5 consecutive days');
  eq(st.weekly_compliance, Math.round((5 / 7) * 100), '5 of the last 7 days');
  eq(st.broken, false, 'not broken');
});

Deno.test('a pending today does NOT break the streak', () => {
  const log = [1, 2, 3].map(daysBefore); // yesterday and before, today still open
  const st = deriveHabitStats(log, TODAY);
  eq(st.streak, 3, 'streak counts back from yesterday when today is not done yet');
  eq(st.broken, false, 'an unfinished morning is not a broken streak');
});

Deno.test('a long absence BREAKS the streak (was monotonic streak+1 forever)', () => {
  const log = [20, 21, 22].map(daysBefore); // nothing for three weeks
  const st = deriveHabitStats(log, TODAY);
  eq(st.streak, 0, 'streak must be 0 after a 20-day gap');
  eq(st.weekly_compliance, 0, 'nothing in the last 7 days');
  eq(st.broken, true, 'broken must be flagged so the coach names it warmly');
});

Deno.test('empty / missing log is handled', () => {
  const st = deriveHabitStats(undefined, TODAY);
  eq(st.streak, 0, 'no log → no streak');
  eq(st.broken, false, 'never-started is not "broken"');
  eq(st.lastDone, null, 'no last-done date');
});

// ── the gate that could never fire ──
Deno.test('readyForNextHabit fires on a genuine 14-day ≥80% run', () => {
  const log = Array.from({ length: 16 }, (_, i) => daysBefore(i));
  const st = deriveHabitStats(log, TODAY);
  ok(st.streak >= 14, `streak should be >=14, got ${st.streak}`);
  ok(readyForNextHabit(st), 'a 16-day unbroken run MUST unlock the next habit (the old gate never could)');
});

Deno.test('readyForNextHabit stays closed on a short or patchy run', () => {
  ok(!readyForNextHabit(deriveHabitStats([0, 1, 2].map(daysBefore), TODAY)), '3 days is not enough');
  // 14-day span but every other day → streak breaks, compliance ~57%
  const patchy = [0, 2, 4, 6, 8, 10, 12, 14].map(daysBefore);
  ok(!readyForNextHabit(deriveHabitStats(patchy, TODAY)), 'every-other-day must not unlock');
});

Deno.test('HABIT_CATALOG keys are unique and ordered', () => {
  const keys = HABIT_CATALOG.map(h => h.key);
  eq(new Set(keys).size, keys.length, 'no duplicate keys');
  eq(keys[0], 'daily_meal_log', 'meal logging is the first rung');
});
