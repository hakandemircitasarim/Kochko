/**
 * Fleet-rotation tests. These lock the failure they were written for: `ai-extractor` took the
 * first 100 rows with no ordering, so past the 100th profile a user was never extracted — and
 * the silence looked exactly like success.
 * Run: `deno test fleet-rotation.test.ts`
 */
import { selectFleetBatch, type CheckpointMap } from './fleet-rotation.ts';

function ok(cond: boolean, msg: string): void { if (!cond) throw new Error(`ASSERT FAILED: ${msg}`); }
function eqArr(a: string[], b: string[], msg: string): void {
  if (a.length !== b.length || a.some((x, i) => x !== b[i])) {
    throw new Error(`ASSERT FAILED: ${msg}\n  expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
  }
}

const KEY = 'tier2_last';
const cp = (pairs: [string, string][]): Map<string, CheckpointMap> =>
  new Map(pairs.map(([id, ts]) => [id, { [KEY]: ts }]));

Deno.test('never-extracted users go first — the ones a naive limit starved', () => {
  const ids = ['a', 'b', 'c'];
  const checks = cp([['a', '2026-08-01T00:00:00Z'], ['b', '2026-07-01T00:00:00Z']]);
  eqArr(selectFleetBatch(ids, checks, KEY, 3), ['c', 'b', 'a'], 'c has no checkpoint, then oldest first');
});

Deno.test('oldest checkpoint wins over newest', () => {
  const ids = ['new', 'old', 'mid'];
  const checks = cp([
    ['new', '2026-08-05T00:00:00Z'],
    ['old', '2026-01-01T00:00:00Z'],
    ['mid', '2026-05-05T00:00:00Z'],
  ]);
  eqArr(selectFleetBatch(ids, checks, KEY, 3), ['old', 'mid', 'new'], 'ascending by timestamp');
});

Deno.test('the 101st user is reachable — this is the whole point', () => {
  // 150 users; the first 100 were extracted today, the rest never were.
  const ids = Array.from({ length: 150 }, (_, i) => `u${i}`);
  const checks = cp(ids.slice(0, 100).map(id => [id, '2026-08-06T00:00:00Z'] as [string, string]));
  const batch = selectFleetBatch(ids, checks, KEY, 100);
  ok(batch.length === 100, 'batch is capped at the limit');
  // The 50 never-extracted users must come FIRST — with a 100 limit the batch necessarily also
  // contains 50 already-extracted ones, so "all starved" would be an impossible assertion.
  ok(batch.slice(0, 50).every(id => Number(id.slice(1)) >= 100), 'the starved users lead the batch');
  ok(batch.includes('u100'), 'the 101st profile is in the batch — under the old code it never was');
  ok(batch.includes('u149'), 'so is the last one');
});

Deno.test('a tier key is independent — tier3 staleness does not mask tier2', () => {
  const ids = ['a', 'b'];
  const checks = new Map<string, CheckpointMap>([
    ['a', { tier2_last: '2026-01-01T00:00:00Z', tier3_last: '2026-08-06T00:00:00Z' }],
    ['b', { tier3_last: '2026-01-01T00:00:00Z' }], // never had tier2
  ]);
  eqArr(selectFleetBatch(ids, checks, 'tier2_last', 2), ['b', 'a'], 'b never had tier2, so it leads');
  eqArr(selectFleetBatch(ids, checks, 'tier3_last', 2), ['b', 'a'], 'by tier3, b is the older stamp');
});

Deno.test('empty and malformed checkpoints count as never-extracted', () => {
  const ids = ['blank', 'missing', 'done'];
  const checks = new Map<string, CheckpointMap>([
    ['blank', { [KEY]: '' }],
    ['done', { [KEY]: '2026-08-01T00:00:00Z' }],
  ]);
  eqArr(selectFleetBatch(ids, checks, KEY, 3), ['blank', 'missing', 'done'], 'blank string is not a checkpoint');
});

Deno.test('order is stable for equal staleness, so runs are reproducible', () => {
  const ids = ['x', 'y', 'z'];
  const checks = cp([['x', 'T'], ['y', 'T'], ['z', 'T']]);
  eqArr(selectFleetBatch(ids, checks, KEY, 3), ['x', 'y', 'z'], 'ties keep input order');
});

Deno.test('limit is respected and never negative', () => {
  const ids = ['a', 'b', 'c'];
  eqArr(selectFleetBatch(ids, new Map(), KEY, 2), ['a', 'b'], 'caps at limit');
  eqArr(selectFleetBatch(ids, new Map(), KEY, 0), [], 'zero yields nothing');
  eqArr(selectFleetBatch(ids, new Map(), KEY, -5), [], 'negative cannot throw or wrap');
});
