import { assert, assertEquals, assertThrows } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { applyAliases, parsePath, resolveSegments } from './path.ts';
import { evaluateExpectation, isPositiveSignal } from './expect.ts';
import { checkSchema } from './schema-check.ts';
import type { Expectation, StageOutputs, StageRoot, TurnResult } from './types.ts';

function turn(outputs: StageOutputs, errors: Partial<Record<StageRoot, string>> = {}): TurnResult {
  const stages: TurnResult['stages'] = {};
  for (const k of Object.keys(outputs) as StageRoot[]) stages[k] = 'ok';
  for (const k of Object.keys(errors) as StageRoot[]) stages[k] = 'error';
  return { outputs, stages, stage_errors: errors };
}

const decision = {
  writes: [
    { op: 'water_log', unit: 'bardak', quantity: 1, mode: 'add', replaces: null },
    {
      op: 'meal_log', day: '2026-10-01', venue: null,
      items: [
        { name: 'Tavuk nugget', kcal: 300, grams: 110, allergens: ['gluten'], may_contain: [] },
        { name: 'Ketçap', kcal: 20, grams: 17, allergens: [], may_contain: [] },
      ],
    },
  ],
  record_ops: [],
  safety: { acute_medical: 'none', self_harm: false, ed_signal: null },
};
const ctx = (outputs: StageOutputs = { decision }, message = 'mesaj') => ({ turn: turn(outputs), message });
const run = (e: Expectation, outputs?: StageOutputs, message?: string) => evaluateExpectation(e, ctx(outputs, message));

// ── path ──────────────────────────────────────────────────────────────────────────────────────

Deno.test('parsePath: keys, filters, index, wildcard and deep search', () => {
  assertEquals(parsePath('decision.writes[op=water_log].unit'), [
    { kind: 'key', key: 'decision' }, { kind: 'key', key: 'writes' },
    { kind: 'filter', key: 'op', op: '=', value: 'water_log' }, { kind: 'key', key: 'unit' },
  ]);
  assertEquals(parsePath('a[2][*][k!=v][n~tuz]..allergens').map((s) => s.kind), ['key', 'index', 'wild', 'filter', 'filter', 'deep']);
  assertThrows(() => parsePath('decision.writes[op=x'));
  assertThrows(() => parsePath('[0].x'));
  assertThrows(() => parsePath('decision..'));
});

Deno.test('resolveSegments: filter selects elements, implicit array mapping is plural', () => {
  const r = resolveSegments(decision, parsePath('d.writes[op=meal_log].items[*].kcal').slice(1));
  assertEquals(r.values, [300, 20]);
  assert(r.plural);
  const single = resolveSegments(decision, parsePath('d.record_ops').slice(1));
  assertEquals(single, { values: [[]], plural: false });
  const contains = resolveSegments(decision, parsePath('d.writes[op=meal_log].items[name~NUGGET].grams').slice(1));
  assertEquals(contains.values, [110], 'the ~ filter is a Turkish case-insensitive contains');
  const deep = resolveSegments(decision, parsePath('d.writes..allergens').slice(1));
  assertEquals(deep.values, [['gluten'], []]);
});

Deno.test('applyAliases: the longest matching prefix is rewritten once', () => {
  const al = { 'decision.record_ops[op=': 'decision.record_ops[kind=', 'decision.': 'decision.' };
  assertEquals(applyAliases('decision.record_ops[op=delete].ref', al), 'decision.record_ops[kind=delete].ref');
  assertEquals(applyAliases('commit.water_log.liters', al), 'commit.water_log.liters');
});

// ── operators ─────────────────────────────────────────────────────────────────────────────────

Deno.test('value operators: in / between / eq / not_in with default quantifiers', () => {
  assertEquals(run({ path: 'decision.writes[op=water_log].unit', in: ['bardak', 'su_bardagi'] }).status, 'pass');
  assertEquals(run({ path: 'decision.writes[op=water_log].unit', in: ['litre'] }).status, 'fail');
  assertEquals(run({ path: 'decision.writes[op=meal_log].items[name~nugget].kcal', between: [220, 450] }).status, 'pass');
  assertEquals(run({ path: 'decision.writes[op=meal_log].items[*].kcal', between: [220, 450], quantifier: 'all' }).status, 'fail');
  // not_in defaults to ALL values (none may match) and is vacuously true on an empty set.
  assertEquals(run({ path: 'decision.record_ops[*].ref', not_in: ['m30'] }).status, 'pass');
  assertEquals(run({ path: 'decision.writes[op=meal_log].items[*].name', not_in: ['Ketçap'] }).status, 'fail');
  // A positive operator over no values fails ("değer yok"), it does not pass silently.
  const r = run({ path: 'decision.writes[op=sleep_log].hours', eq: 6 });
  assertEquals(r.status, 'fail');
  assert(r.detail.includes('değer yok'));
});

Deno.test('set operators: count counts matches for plural paths and length for a single array', () => {
  assertEquals(run({ path: 'decision.writes', count: 2 }).status, 'pass');
  assertEquals(run({ path: 'decision.record_ops', count: 0 }).status, 'pass');
  assertEquals(run({ path: 'decision.writes[op=meal_log]', count: 1 }).status, 'pass');
  assertEquals(run({ path: 'decision.writes[op=meal_log].items[*]', count: 2 }).status, 'pass');
  assertEquals(run({ path: 'decision.writes[op=sleep_log]', count: 0 }).status, 'pass');
  assertEquals(run({ path: 'decision.writes[op=meal_log].venue', absent: true }).status, 'pass', 'null counts as absent');
  assertEquals(run({ path: 'decision.writes', count_gte: 3 }).status, 'fail');
});

Deno.test('flag: booleans, level enums and signal objects', () => {
  assert(!isPositiveSignal(null));
  assert(!isPositiveSignal('none'));
  assert(isPositiveSignal('possible'));
  assert(isPositiveSignal({ category: 'purging', severity: 'high', evidence_quote: 'x' }));
  assert(!isPositiveSignal({ level: 'none', category: 'other' }));
  assertEquals(run({ path: 'decision.safety.ed_signal', flag: false }).status, 'pass', 'null ed_signal is a negative reading');
  assertEquals(run({ path: 'decision.safety.acute_medical', flag: true }).status, 'fail');
  assertEquals(run({ path: 'decision.safety.self_harm', flag: false }).status, 'pass');
});

Deno.test('verbatim_in_message: the evidence quote must come from the USER message (final2#9)', () => {
  const d = { safety: { ed_signal: { category: 'purging', evidence_quote: '"Parmağımı boğazıma sokuyorum."' } } };
  const msg = 'yemekten sonra hep kendimi cezalandırıyorum, parmağımı  boğazıma sokuyorum';
  assertEquals(run({ path: 'decision.safety.ed_signal.evidence_quote', verbatim_in_message: true }, { decision: d }, msg).status, 'pass');
  const coach = { safety: { ed_signal: { category: 'restriction_intent', evidence_quote: 'telafi için aç kalma' } } };
  assertEquals(run({ path: 'decision.safety.ed_signal.evidence_quote', verbatim_in_message: true }, { decision: coach }, 'tamam, teşekkürler').status, 'fail');
});

Deno.test('contains / contains_any work on text, numbers and arrays', () => {
  assertEquals(run({ path: 'decision.writes[op=meal_log].items[*].allergens', contains: 'GLUTEN' }).status, 'pass');
  assertEquals(run({ path: 'decision.writes[op=meal_log]..allergens', not_contains_any: ['egg', 'peanut'] }).status, 'pass');
  assertEquals(run({ path: 'x.v', contains: '118' }, { x: { v: 118 } } as unknown as StageOutputs).status, 'fail', 'unknown root fails');
  assertEquals(run({ path: 'decision.v', contains: '118' }, { decision: { v: 118 } }).status, 'pass');
});

Deno.test('eq_path: committed values must equal the model arguments (no silent rewrite)', () => {
  const commit = { meal_log: { items: [{ kcal: 20 }, { kcal: 300 }] } };
  assertEquals(run({ path: 'commit.meal_log.items[*].kcal', eq_path: 'decision.writes[op=meal_log].items[*].kcal' }, { decision, commit }).status, 'pass');
  const rewritten = { meal_log: { items: [{ kcal: 1708 }, { kcal: 20 }] } };
  assertEquals(run({ path: 'commit.meal_log.items[*].kcal', eq_path: 'decision.writes[op=meal_log].items[*].kcal' }, { decision, commit: rewritten }).status, 'fail');
});

Deno.test('stages: not run → skipped, errored → fail, any_of/all_of combine conservatively', () => {
  assertEquals(run({ path: 'commit.water_log.liters', between: [0.15, 0.3] }).status, 'skipped');
  const errored = evaluateExpectation({ path: 'decision.writes', count: 0 }, { turn: turn({}, { decision: 'JSON ayrıştırılamadı' }), message: '' });
  assertEquals(errored.status, 'fail');
  assertEquals(run({ any_of: [{ path: 'decision.clarify', exists: true }, { path: 'decision.writes[op=water_log].quantity', eq: 1 }] }).status, 'pass');
  assertEquals(run({ any_of: [{ path: 'decision.clarify', exists: true }, { path: 'commit.water_log.liters', eq: 1 }] }).status, 'skipped');
  assertEquals(run({ any_of: [{ path: 'decision.clarify', exists: true }, { path: 'decision.writes', count: 9 }] }).status, 'fail');
  assertEquals(run({ all_of: [{ path: 'decision.writes', count: 2 }, { path: 'commit.x', exists: true }] }).status, 'skipped');
  assertEquals(run({ all_of: [{ path: 'decision.writes', count: 3 }, { path: 'commit.x', exists: true }] }).status, 'fail');
});

// ── schema check ──────────────────────────────────────────────────────────────────────────────

Deno.test('checkSchema: strict subset — enum, required, additionalProperties, anyOf, $ref, nullable', () => {
  const schema = {
    type: 'object', additionalProperties: false, required: ['writes', 'clarify'],
    $defs: { water: { type: 'object', additionalProperties: false, required: ['op', 'unit', 'quantity'], properties: {
      op: { const: 'water_log' }, unit: { type: 'string', enum: ['bardak', 'ml', 'litre'] }, quantity: { type: 'number', minimum: 0, maximum: 50 },
    } } },
    properties: {
      writes: { type: 'array', items: { anyOf: [{ $ref: '#/$defs/water' }] } },
      clarify: { type: ['object', 'null'] },
    },
  };
  assertEquals(checkSchema({ writes: [{ op: 'water_log', unit: 'bardak', quantity: 1 }], clarify: null }, schema), []);
  const bad = checkSchema({ writes: [{ op: 'water_log', unit: 'cup', quantity: 1 }], extra: 1 }, schema);
  assert(bad.some((e) => e.includes('zorunlu alan eksik "clarify"')));
  assert(bad.some((e) => e.includes('tanımsız alan "extra"')));
  assert(bad.some((e) => e.includes('anyOf')));
  assertEquals(checkSchema({ writes: [{ op: 'water_log', unit: 'ml', quantity: 250 }], clarify: null }, schema).length, 1, 'range violation');
});
