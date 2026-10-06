import { assert, assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { deepMerge, expandFixtureDoc, isRefToken, lintFixture, lintFixtures, loadFixtureDir } from './fixtures.ts';
import type { EvalFixture } from './types.ts';

const FIXTURES = new URL('./fixtures/', import.meta.url);

/** The 43 verified round-3 findings (scratchpad round3-findings.json, §9.3): each must be a fixture. */
const ROUND3_IDS = [
  ...Array.from({ length: 17 }, (_, i) => `final2#${i + 1}`),
  ...Array.from({ length: 15 }, (_, i) => `mem#${i + 1}`),
  ...Array.from({ length: 11 }, (_, i) => `diff#${i + 1}`),
];

Deno.test('fixtures: the shipped set lints clean and is large enough (§9.3 target ≥ 100)', async () => {
  const loaded = await loadFixtureDir(FIXTURES);
  assertEquals(loaded.issues, []);
  assert(loaded.fixtures.length >= 100, `only ${loaded.fixtures.length} fixtures`);
  const pkgs = new Set(loaded.fixtures.map((f) => f.package));
  for (const p of ['A', "A'", 'B+', 'B-', 'D']) assert(pkgs.has(p as EvalFixture['package']), `package ${p} has no fixture`);
});

Deno.test('fixtures: every one of the 43 round-3 findings has at least one fixture', async () => {
  const { fixtures } = await loadFixtureDir(FIXTURES);
  assertEquals(ROUND3_IDS.length, 43);
  const sources = new Set(fixtures.map((f) => f.source));
  const missing = ROUND3_IDS.filter((id) => !sources.has(`round3:${id}`));
  assertEquals(missing, []);
});

Deno.test('fixtures: earlier rounds, cap-probe and spec package lists are seeded too', async () => {
  const { fixtures } = await loadFixtureDir(FIXTURES);
  const count = (prefix: string) => fixtures.filter((f) => f.source.startsWith(prefix)).length;
  assert(count('devir:') >= 15, 'DEVIR §6–§8 regressions');
  assertEquals(count('probe:cap-schema'), 5, 'all five cap-probe messages');
  assert(count('spec:') >= 20, '§9.4 package examples');
  assertEquals(count('owner:2026-10-06'), 3, 'suspicious old record: notice, fix on yes, ask only once');
  // Every B+ fixture must assert something on Stage A or Stage B safety structure.
  for (const f of fixtures.filter((x) => x.package === 'B+')) assert(f.expect.length > 0 || (f.reply_rubric?.length ?? 0) > 0, f.id);
});

Deno.test('fixtures: personas are merged under group defaults and fixture overrides', async () => {
  const { fixtures } = await loadFixtureDir(FIXTURES);
  const sleep = fixtures.find((f) => f.id === 'probe-dtm-dort-saat-uyku-antrenman-sorusu')!;
  assertEquals(sleep.turn_input.now, { local_date: '2026-10-06', weekday_tr: 'Salı', local_time: '08:15', tz: 'Europe/Istanbul' });
  const fresh = fixtures.find((f) => f.id === 'probe-cap-bir-bardak-su-daha')!;
  assertEquals(fresh.turn_input.now?.local_time, '21:30', 'group default overrides the persona');
  assertEquals(fresh.turn_input.profile?.occupation, 'öğretmen', 'persona profile carried over');
  const plan = fixtures.find((f) => f.id === 'r3-mem-10-plan-gunleri-protein-hedefinde')!;
  assertEquals(plan.turn_input.draft, null, 'an explicit null clears the persona draft');
  assertEquals(plan.turn_input.spine?.length, 4);
});

Deno.test('deepMerge: objects merge, arrays and scalars replace, null clears', () => {
  const a = { now: { local_date: 'x', local_time: '1' }, spine: [1, 2], draft: { ref: 'dft1' } };
  const merged: unknown = deepMerge(a, { now: { local_time: '2' }, spine: [3], draft: null });
  assertEquals(merged, { now: { local_date: 'x', local_time: '2' }, spine: [3], draft: null });
  assertEquals(a.now.local_time, '1', 'inputs are not mutated');
});

Deno.test('isRefToken: short record tokens only', () => {
  for (const ok of ['m12', 'd3', 'c1', 'p1', 'k1', 'dft1']) assert(isRefToken(ok), ok);
  for (const bad of ['12', 'M12', 'meal12', 'm', 'm1a', '']) assert(!isRefToken(bad), bad);
});

const base = (over: Partial<EvalFixture> = {}): EvalFixture => ({
  id: 'x-fixture',
  source: 'test',
  package: 'A',
  title: 'deneme',
  turn_input: {
    now: { local_date: '2026-10-06' },
    records: [{ ref: 'd3', kind: 'water', day: '2026-10-06', line: 'su +0,20 L' }],
  },
  message: 'geri al',
  expect: [{ path: 'decision.record_ops[op=delete].ref', eq: 'd3' }],
  ...over,
});

Deno.test('lint: a well-formed fixture is clean', () => {
  assertEquals(lintFixture(base()), []);
});

Deno.test('lint: catches operator typos, double operators and bad paths', () => {
  const msgs = (f: EvalFixture) => lintFixture(f).map((i) => i.message).join(' | ');
  assert(msgs(base({ expect: [{ path: 'decision.writes', betwen: [1, 2] } as never] })).includes('bilinmeyen anahtar "betwen"'));
  assert(msgs(base({ expect: [{ path: 'decision.writes', count: 0, exists: true }] })).includes('tam olarak bir operatör'));
  assert(msgs(base({ expect: [{ path: 'decision.writes[op=x', count: 0 }] })).includes('kapanmamış'));
  assert(msgs(base({ expect: [{ path: 'nope.writes', count: 0 }] })).includes('bilinmeyen kök'));
  assert(msgs(base({ expect: [{ path: 'decision.x', between: [5, 1] }] })).includes('[alt, üst]'));
  assert(msgs(base({ expect: [{ any_of: [{ path: 'decision.x', eq: 1 }] }] })).includes('en az iki'));
});

Deno.test('lint: a ref the TurnInput never rendered is a fixture bug, not a model failure', () => {
  const issues = lintFixture(base({ expect: [{ path: 'decision.record_ops[op=delete].ref', eq: 'm30' }] }));
  assertEquals(issues.length, 1);
  assert(issues[0].message.includes('"m30" ref\'i turn_input\'ta yok'));
});

Deno.test('lint: a logged day outside f.day() (future or > 7 days back) is rejected', () => {
  const future = lintFixture(base({ expect: [{ path: 'decision.writes[op=meal_log].day', eq: '2026-10-07' }] }));
  assert(future.some((i) => i.message.includes('aralığı dışında')));
  const old = lintFixture(base({ expect: [{ path: 'decision.writes[op=meal_log].day', eq: '2026-09-20' }] }));
  assert(old.some((i) => i.message.includes('aralığı dışında')));
  // simulation.target_day is not a logged day — the future is allowed there.
  assertEquals(lintFixture(base({ expect: [{ path: 'decision.simulation.target_day', eq: '2026-10-07' }] })), []);
});

Deno.test('lint: duplicate ids across files, unknown package and missing fields', () => {
  const issues = lintFixtures([{ fixture: base(), file: 'a.json' }, { fixture: base(), file: 'b.json' }]);
  assert(issues.some((i) => i.message.includes('id tekrar ediyor (ilk: a.json)')));
  const bad = lintFixture(base({ package: 'Z' as never, message: ' ', expect: [] }));
  const text = bad.map((i) => i.message).join(' | ');
  assert(text.includes('geçersiz package'));
  assert(text.includes('message eksik'));
  assert(text.includes('expect boş olamaz'));
});

Deno.test('expandFixtureDoc: single object, array and group shapes; unknown persona reported', () => {
  const one = expandFixtureDoc(base(), {}, 'one.json');
  assertEquals(one.fixtures.length, 1);
  const arr = expandFixtureDoc([base(), base({ id: 'y' })], {}, 'arr.json');
  assertEquals(arr.fixtures.map((f) => f.id), ['x-fixture', 'y']);
  const grp = expandFixtureDoc({ defaults: { persona: 'ghost', package: 'B-' }, fixtures: [{ ...base(), package: undefined }] }, {}, 'g.json');
  assertEquals(grp.fixtures[0].package, 'B-');
  assert(grp.issues.some((i) => i.message.includes('bilinmeyen persona "ghost"')));
  assertEquals(expandFixtureDoc(42, {}, 'n.json').fixtures.length, 0);
});
