import { assert, assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import {
  buildRefMap,
  DB_BOUNDS,
  DECISION_RETENTION_DAYS,
  DELETABLE_REF_KINDS,
  HOLD_CLASSES,
  HOLD_DEFAULT_TTL_MIN,
  isDeletableRefKind,
  isRpcFailure,
  LEDGER_TABLES,
  METRIC_OPS,
  parseRef,
  parseRpcReceipt,
  PENDING_STATUSES,
  QUOTA_CLASSES,
  REF_KIND_TABLE,
  REF_KINDS,
  TURN_INPUT_KEYS,
  TURN_INPUT_SCHEMA,
  TURN_LOG_PIPELINES,
  UNDO_MODES,
  V2_FAILURE_CLASSES,
  V2_RPC,
  type MealApplyOk,
  type MetricApplyOk,
  type TurnInputRow,
} from './v2-db-types.ts';
import { WATER_MAX_LITERS_PER_WRITE } from './water-intent.ts';

// ─── SQL sources (the contract this file mirrors) ────────────────────────────────────────────────────
const MIG_DIR = new URL('../../migrations/', import.meta.url);
const V2_MIGRATIONS = [
  '108_turn_writes.sql', '109_pending_writes_v2.sql', '110_soft_delete_and_types.sql',
  '111_turn_log_v2.sql', '112_chat_receipts.sql', '113_v2_writer_rpcs.sql',
];
// CRLF-safe: a Windows checkout must not turn a parity check red.
const sql = (f: string) => Deno.readTextFileSync(new URL(f, MIG_DIR)).replace(/\r\n/g, '\n');
const ALL_V2_SQL = V2_MIGRATIONS.map(sql).join('\n');
const quoted = (list: string) => [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
const sorted = (xs: readonly string[]) => [...xs].sort();
function grab(text: string, re: RegExp, what: string): string {
  const m = re.exec(text);
  assert(m, `could not find ${what} in the SQL`);
  return m[1];
}

// ─── parseRef ────────────────────────────────────────────────────────────────────────────────────────

Deno.test('parseRef accepts every ref kind the DB issues', () => {
  for (const [ref, kind, seq] of [
    ['m1', 'm', 1], ['m12', 'm', 12], ['d3', 'd', 3], ['w2', 'w', 2], ['t5', 't', 5], ['s2', 's', 2],
    ['e1', 'e', 1], ['l9', 'l', 9], ['c1', 'c', 1], ['k1', 'k', 1], ['p10', 'p', 10], ['dft1', 'dft', 1],
  ] as const) {
    assertEquals(parseRef(ref), { ref, kind, seq }, ref);
  }
});

Deno.test('parseRef rejects anything that is not an exact ref token (no trimming, no case folding)', () => {
  for (const bad of ['m0', 'm01', 'M1', 'x1', 'm', 'dft', 'df1', 'm1a', ' m1', 'm1 ', 'mm1', 'd-1', 'm1234567890', '', 'm12.0']) {
    assertEquals(parseRef(bad), null, JSON.stringify(bad));
  }
  for (const bad of [12, null, undefined, { ref: 'm1' }, ['m1']]) assertEquals(parseRef(bad), null);
});

Deno.test('record ops may target records and metric writes, never the spine / commitments / holds / drafts', () => {
  for (const k of ['m', 't', 's', 'e', 'l', 'd', 'w'] as const) assert(isDeletableRefKind(k), k);
  for (const k of ['c', 'k', 'p', 'dft'] as const) assert(!isDeletableRefKind(k), k);
  // Mirrors the RPC: these kinds answer not_deletable.
  assertEquals(sorted(quoted(grab(sql('108_turn_writes.sql'), /IF v_refrow\.kind IN \(([^)]*)\) THEN/, 'not_deletable kinds'))),
    sorted(REF_KINDS.filter((k) => !DELETABLE_REF_KINDS.includes(k))));
});

// ─── SQL ↔ TS parity ─────────────────────────────────────────────────────────────────────────────────

Deno.test('REF_KINDS and REF_KIND_TABLE match record_refs CHECKs (108)', () => {
  const m108 = sql('108_turn_writes.sql');
  assertEquals(sorted(quoted(grab(m108, /kind\s+text NOT NULL CHECK \(kind IN \(([^)]*)\)\)/, 'record_refs.kind CHECK'))), sorted(REF_KINDS));
  const pairs = new Map<string, string>();
  for (const m of m108.matchAll(/\(kind = '(\w+)'\s+AND target_table = '(\w+)'\)/g)) pairs.set(m[1], m[2]);
  for (const m of m108.matchAll(/\(kind IN \(([^)]*)\) AND target_table = '(\w+)'\)/g)) for (const k of quoted(m[1])) pairs.set(k, m[2]);
  assertEquals(Object.fromEntries([...pairs].sort()), Object.fromEntries(Object.entries(REF_KIND_TABLE).sort()));
});

Deno.test('LEDGER_TABLES, UNDO_MODES and the ledger pipeline match turn_writes CHECKs (108)', () => {
  const m108 = sql('108_turn_writes.sql');
  assertEquals(sorted(quoted(grab(m108, /table_name\s+text NOT NULL CHECK \(table_name IN \(([\s\S]*?)\)\),/, 'table_name CHECK'))), sorted(LEDGER_TABLES));
  assertEquals(sorted(quoted(grab(m108, /undo_mode\s+text NOT NULL CHECK \(undo_mode IN \(([^)]*)\)\)/, 'undo_mode CHECK'))), sorted(UNDO_MODES));
  assertEquals(sorted(quoted(grab(m108, /pipeline\s+text NOT NULL DEFAULT 'v2' CHECK \(pipeline IN \(([^)]*)\)\)/, 'pipeline CHECK'))), ['v1', 'v2']);
  // The engine's dynamic SQL whitelist is the same list.
  assertEquals(sorted(quoted(grab(m108, /p_table NOT IN \(([\s\S]*?)\) THEN/, '_v2_assert_table list'))), sorted(LEDGER_TABLES));
});

Deno.test('every failure_class the SQL can return is a V2_FAILURE_CLASSES member, and none is dead', () => {
  const emitted = new Set<string>();
  for (const m of ALL_V2_SQL.matchAll(/_v2_fail\('(\w+)'/g)) emitted.add(m[1]);
  for (const m of ALL_V2_SQL.matchAll(/'failure_class', '(\w+)'/g)) emitted.add(m[1]);
  // RAISE-with-variable in _v2_fail itself is not a class.
  emitted.delete('p_class');
  const known = new Set<string>(V2_FAILURE_CLASSES);
  for (const c of emitted) assert(known.has(c), `SQL emits unknown failure_class '${c}' — add it to V2_FAILURE_CLASSES`);
  for (const c of V2_FAILURE_CLASSES) assert(emitted.has(c), `V2_FAILURE_CLASSES has '${c}' but no SQL path returns it`);
});

Deno.test('every V2 RPC exists, is SECURITY DEFINER with a pinned search_path, and is service_role-only', () => {
  for (const name of Object.values(V2_RPC)) {
    const def = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(([\\s\\S]*?)\\$\\$`).exec(ALL_V2_SQL);
    assert(def, `${name} is not defined in 108-113`);
    assert(/SECURITY DEFINER/.test(def[1]), `${name} is not SECURITY DEFINER`);
    assert(/SET search_path = public/.test(def[1]), `${name} has no pinned search_path`);
    assert(new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([^)]*\\)\\s+FROM PUBLIC, anon, authenticated`).test(ALL_V2_SQL),
      `${name} is not revoked from PUBLIC/anon/authenticated`);
    assert(new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([^)]*\\)\\s+TO service_role`).test(ALL_V2_SQL),
      `${name} is not granted to service_role`);
  }
});

Deno.test('internal _v2_ helpers are never granted and every file that defines one revokes them', () => {
  assert(!/^\s*GRANT[^;]*public\._v2_/m.test(ALL_V2_SQL), 'an internal _v2_ helper is granted');
  for (const f of V2_MIGRATIONS) {
    const text = sql(f);
    const lastDef = text.lastIndexOf('FUNCTION public._v2_');
    const createdHere = /CREATE OR REPLACE FUNCTION public\._v2_/.test(text);
    if (!createdHere) continue;
    const loop = text.lastIndexOf("p.proname LIKE '\\_v2\\_%'");
    assert(loop > lastDef, `${f} defines _v2_ helpers after (or without) its REVOKE loop`);
  }
  // No SECURITY DEFINER function anywhere in 108-113 may float its search_path.
  for (const chunk of ALL_V2_SQL.split('CREATE OR REPLACE FUNCTION').slice(1)) {
    const header = chunk.slice(0, chunk.indexOf('$$'));
    if (/SECURITY DEFINER/.test(header)) assert(/SET search_path/.test(header), `definer without search_path: ${header.slice(0, 60)}`);
  }
});

Deno.test('pending / turn-log / chat enums match their CHECKs (109, 111, 112)', () => {
  assertEquals(sorted(quoted(grab(sql('109_pending_writes_v2.sql'), /pending_writes_status_check\s+CHECK \(status IN \(([^)]*)\)\)/, 'status CHECK'))), sorted(PENDING_STATUSES));
  assertEquals(sorted(quoted(grab(sql('109_pending_writes_v2.sql'), /pending_writes_hold_class_check CHECK \(hold_class IN \(([^)]*)\)\)/, 'hold_class CHECK'))), sorted(HOLD_CLASSES));
  assertEquals(sorted(quoted(grab(sql('111_turn_log_v2.sql'), /CHECK \(pipeline IS NULL OR pipeline IN \(([^)]*)\)\)/, 'turn log pipeline CHECK'))), sorted(TURN_LOG_PIPELINES));
  assertEquals(sorted(quoted(grab(sql('112_chat_receipts.sql'), /CHECK \(quota_class IS NULL OR quota_class IN \(([^)]*)\)\)/, 'quota CHECK'))), sorted(QUOTA_CLASSES));
});

Deno.test('TURN_INPUT_KEYS and the schema tag match what v2_turn_input returns (113)', () => {
  const m113 = sql('113_v2_writer_rpcs.sql');
  const start = m113.indexOf("RETURN jsonb_build_object(\n    'schema'");
  assert(start > 0, 'v2_turn_input RETURN block not found');
  const block = m113.slice(start, m113.indexOf('END $$;', start));
  const keys = [...block.matchAll(/^\s{4}'(\w+)',/gm)].map((m) => m[1]);
  assertEquals(keys, [...TURN_INPUT_KEYS]);
  assert(block.includes(`'schema', '${TURN_INPUT_SCHEMA}'`), 'schema tag drifted');
});

Deno.test('DB bounds, metric ops, hold TTL and retention match the SQL', () => {
  const m113 = sql('113_v2_writer_rpcs.sql');
  const has = (re: RegExp, what: string) => assert(re.test(m113), `${what} drifted from DB_BOUNDS`);
  has(new RegExp(`_v2_num\\(v_p, 'liters', 0, ${DB_BOUNDS.waterLitersPerWrite}, false`), 'water per write');
  has(new RegExp(`v_next > ${DB_BOUNDS.waterDayTotalMax.toString().replace('.', '\\.')}`), 'water day total');
  has(new RegExp(`'kcal',\\s+0, ${DB_BOUNDS.itemKcalMax},`), 'item kcal');
  has(new RegExp(`'protein_g',\\s+0, ${DB_BOUNDS.itemMacroGramsMax.toString().replace('.', '\\.')},`), 'item macros');
  has(new RegExp(`'grams',\\s+0, ${DB_BOUNDS.itemGramsMax.toString().replace('.', '\\.')},`), 'item grams');
  has(new RegExp(`NOT BETWEEN ${DB_BOUNDS.mealItemsMin} AND ${DB_BOUNDS.mealItemsMax}`), 'meal item count');
  has(new RegExp(`'hours', ${DB_BOUNDS.sleepHoursExclusive[0]}, ${DB_BOUNDS.sleepHoursExclusive[1]},`), 'sleep hours');
  has(new RegExp(`'score', ${DB_BOUNDS.moodScore[0]}, ${DB_BOUNDS.moodScore[1]},`), 'mood score');
  has(new RegExp(`'steps', 0, ${DB_BOUNDS.stepsMax},`), 'steps');
  has(new RegExp(`'kg', ${DB_BOUNDS.weightKg[0]}, ${DB_BOUNDS.weightKg[1]},`), 'weight');
  assert(sql('108_turn_writes.sql').includes(
    `v_day < current_date - ${DB_BOUNDS.dayWindowPastDays} OR v_day > current_date + ${DB_BOUNDS.dayWindowFutureDays}`), 'day window drifted');
  // One water bound across v1 and v2: the Faz 0 handler, the registry and the RPC agree.
  assertEquals(DB_BOUNDS.waterLitersPerWrite, WATER_MAX_LITERS_PER_WRITE);
  for (const [metric, op] of Object.entries(METRIC_OPS)) {
    assert(m113.includes(`WHEN '${metric}' THEN '${op}'`), `metric op ${metric} → ${op} drifted`);
  }
  assert(sql('109_pending_writes_v2.sql').includes(`'ttl_minutes', 1, 10080, true, 'ttl_minutes'), ${HOLD_DEFAULT_TTL_MIN})`), 'hold TTL drifted');
  const m111 = sql('111_turn_log_v2.sql');
  assert(m111.includes(`v2_retention_sweep(p_days integer DEFAULT ${DECISION_RETENTION_DAYS})`), 'retention default drifted');
  assert(m111.includes(`SELECT public.v2_retention_sweep(${DECISION_RETENTION_DAYS})`), 'retention cron drifted');
});

Deno.test('migration numbers are unique (parallel branches must not both ship a 108)', () => {
  const seen = new Map<string, string>();
  for (const e of Deno.readDirSync(MIG_DIR)) {
    if (!e.isFile || !e.name.endsWith('.sql')) continue;
    const n = /^(\d+)_/.exec(e.name)?.[1];
    assert(n, `migration without a numeric prefix: ${e.name}`);
    assert(!seen.has(n), `duplicate migration number ${n}: ${seen.get(n)} and ${e.name}`);
    seen.set(n, e.name);
  }
  for (const f of V2_MIGRATIONS) assert([...seen.values()].includes(f), `${f} missing`);
});

Deno.test('the branch-DB SQL test exercises every V2 RPC', () => {
  const t = Deno.readTextFileSync(new URL('../../tests/v2_rpc_test.sql', import.meta.url)).replace(/\r\n/g, '\n');
  for (const name of Object.values(V2_RPC)) assert(new RegExp(`\\b${name}\\(`).test(t), `${name} has no SQL test`);
  assert(/ROLLBACK;\s*$/.test(t), 'the SQL test must end in ROLLBACK');
});

// ─── parseRpcReceipt ─────────────────────────────────────────────────────────────────────────────────

Deno.test('parseRpcReceipt passes a well-formed success for the expected op', () => {
  const raw = { ok: true, op: 'meal_log', ref: 'm3', total_kcal: 300 };
  const r = parseRpcReceipt<MealApplyOk>(raw, ['meal_log']);
  assert(!isRpcFailure(r));
  assertEquals(r.ref, 'm3');
  const m = parseRpcReceipt<MetricApplyOk>({ ok: true, op: 'step_log' }, Object.values(METRIC_OPS));
  assertEquals(m.ok, true);
});

Deno.test('parseRpcReceipt never turns an off-contract answer into success', () => {
  const cases: [unknown, string][] = [
    [null, 'not_an_object'], [undefined, 'not_an_object'], ['ok', 'not_an_object'], [[{ ok: true }], 'not_an_object'],
    [{ op: 'meal_log' }, 'missing_ok'], [{ ok: 'true', op: 'meal_log' }, 'missing_ok'],
    [{ ok: true, op: 'water_log' }, 'unexpected_op'],
  ];
  for (const [raw, reason] of cases) {
    const r = parseRpcReceipt<MealApplyOk>(raw, ['meal_log']);
    assert(isRpcFailure(r), JSON.stringify(raw));
    assertEquals(r.failure_class, 'write_failed');
    assertEquals(r.detail.reason, reason, JSON.stringify(raw));
  }
});

Deno.test('parseRpcReceipt keeps known failure classes and demotes unknown ones to write_failed', () => {
  const known = parseRpcReceipt({ ok: false, op: 'record_delete', failure_class: 'later_write', detail: { ref: 'd3' } }, ['record_delete']);
  assertEquals(known, { ok: false, op: 'record_delete', failure_class: 'later_write', detail: { ref: 'd3' } });
  const unknown = parseRpcReceipt({ ok: false, op: 'water_log', failure_class: 'cosmic_ray', detail: 'x' }, ['water_log']);
  assertEquals(unknown, { ok: false, op: 'water_log', failure_class: 'write_failed', detail: { original_class: 'cosmic_ray' } });
});

// ─── buildRefMap ─────────────────────────────────────────────────────────────────────────────────────

type RefSections = Parameters<typeof buildRefMap>[0];
function sections(over: Partial<RefSections> = {}): RefSections {
  const base: RefSections = {
    meals: [{ ref: 'm12', id: 'meal-12' }, { ref: 'm15', id: 'meal-15' }] as TurnInputRow['meals'],
    metric_writes: [{ ref: 'd3', write_id: 'tw-3' }, { ref: 'w1', write_id: 'tw-9' }, { ref: null, write_id: 'tw-x' }] as TurnInputRow['metric_writes'],
    workouts: [{ ref: 't1', id: 'wo-1' }] as TurnInputRow['workouts'],
    supplements: [{ ref: 's2', id: 'sp-2' }] as TurnInputRow['supplements'],
    labs: [{ ref: 'l1', id: 'lab-1' }] as TurnInputRow['labs'],
    life_events: [{ ref: 'e1', id: 'ev-1' }] as TurnInputRow['life_events'],
    constraints: [{ ref: 'c1', id: 'uc-1' }] as TurnInputRow['constraints'],
    commitments: [{ ref: 'k1', id: 'cm-1' }] as TurnInputRow['commitments'],
    pending: [{ ref: 'p1', id: 'pw-1' }] as TurnInputRow['pending'],
    plans: { active: [], drafts: [{ ref: 'dft1', id: 'wp-1' }] as TurnInputRow['plans']['drafts'] },
  };
  return { ...base, ...over };
}

Deno.test('buildRefMap maps every rendered ref to its table and row (d/w → the ledger write)', () => {
  const { map, problems } = buildRefMap(sections());
  assertEquals(problems, []);
  assertEquals(map.get('m12'), { kind: 'm', table: 'meal_logs', id: 'meal-12' });
  assertEquals(map.get('d3'), { kind: 'd', table: 'turn_writes', id: 'tw-3' });
  assertEquals(map.get('w1'), { kind: 'w', table: 'turn_writes', id: 'tw-9' });
  assertEquals(map.get('dft1'), { kind: 'dft', table: 'weekly_plans', id: 'wp-1' });
  assertEquals(map.size, 12);
  // A ref the model invents is simply absent: refInRenderedSet fails, nothing is guessed.
  assertEquals(map.get('m99'), undefined);
});

Deno.test('buildRefMap reports malformed, mis-kinded and colliding refs instead of guessing', () => {
  const { map, problems } = buildRefMap(sections({
    meals: [{ ref: 'm1', id: 'a' }, { ref: 'm1', id: 'b' }, { ref: 'd4', id: 'c' }, { ref: 'M2', id: 'd' }] as TurnInputRow['meals'],
  }));
  assertEquals(map.get('m1'), { kind: 'm', table: 'meal_logs', id: 'a' });
  assert(!map.has('d4') && !map.has('M2'));
  assertEquals(problems.length, 3);
  assert(problems.some((p) => p.includes('two rows')));
  assert(problems.some((p) => p.includes('has kind d')));
  assert(problems.some((p) => p.includes('malformed')));
});
