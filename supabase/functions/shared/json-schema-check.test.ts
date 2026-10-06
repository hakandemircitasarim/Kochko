/**
 * json-schema-check.test.ts — the local validator is the ONLY shape guarantee on the json_object
 * gateway path (AI_MIMARI_V2 §5.1 madde 1). Two failure directions matter equally: letting an
 * off-schema value through (it would be written), and rejecting a valid one (a false `invalid`
 * is its own silent override of the model).
 */
import { assert, assertEquals } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { SCHEMA_NAME_RE, strictSchemaIssues, validateJsonSchema } from './json-schema-check.ts';

// Shaped like the registry's water_log (§4.4): nullable optional, enum unit, ref string.
const WATER_OP = {
  type: 'object',
  additionalProperties: false,
  required: ['op', 'day', 'as_stated', 'quantity', 'unit', 'other_ml_each', 'mode', 'replaces'],
  properties: {
    op: { type: 'string', const: 'water_log' },
    day: { type: 'string' },
    as_stated: { type: 'string', maxLength: 60 },
    quantity: { type: 'number', minimum: 0, maximum: 50 },
    unit: { type: 'string', enum: ['ml', 'litre', 'bardak', 'su_bardagi', 'cay_bardagi', 'other'] },
    other_ml_each: { type: ['number', 'null'], minimum: 1, maximum: 3000 },
    mode: { type: 'string', enum: ['add', 'set_day_total'] },
    replaces: { type: ['string', 'null'] },
  },
};
const MEAL_OP = {
  type: 'object',
  additionalProperties: false,
  required: ['op', 'raw', 'items'],
  properties: {
    op: { type: 'string', const: 'meal_log' },
    raw: { type: 'string' },
    items: {
      type: 'array',
      minItems: 1,
      maxItems: 20,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'as_stated', 'grams', 'kcal'],
        properties: {
          name: { type: 'string' },
          as_stated: { type: 'string' },
          grams: { type: ['number', 'null'] },
          kcal: { type: 'number', minimum: 0, maximum: 5000 },
        },
      },
    },
  },
};
const DECISION = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'writes'],
  properties: {
    intent: { type: 'string', enum: ['log', 'question', 'chat'] },
    writes: { type: 'array', items: { anyOf: [{ $ref: '#/$defs/water' }, { $ref: '#/$defs/meal' }] } },
  },
  $defs: { water: WATER_OP, meal: MEAL_OP },
};

const water = (over: Record<string, unknown> = {}) => ({
  op: 'water_log', day: 'today', as_stated: '1 bardak', quantity: 1, unit: 'bardak',
  other_ml_each: null, mode: 'add', replaces: null, ...over,
});

Deno.test('validate: a well-formed decision passes (anyOf + $ref + nullable)', () => {
  const v = {
    intent: 'log',
    writes: [
      water(),
      { op: 'meal_log', raw: 'yumurtaya 2 çimdik tuz attım', items: [{ name: 'tuz', as_stated: '2 çimdik', grams: 0.7, kcal: 0 }] },
    ],
  };
  assertEquals(validateJsonSchema(DECISION, v), []);
});

Deno.test('validate: free-text as_stated is never judged — only its declared bounds', () => {
  // "2 çimdik", "koca bir bardak", "annemin tabağı kadar": all valid strings (§4.3).
  for (const s of ['2 çimdik', 'koca bir bardak', 'annemin tabağı kadar', '']) {
    assertEquals(validateJsonSchema(WATER_OP, water({ as_stated: s })), [], s);
  }
  // maxLength counts characters, not UTF-16 units: 60 Turkish letters fit.
  assertEquals(validateJsonSchema(WATER_OP, water({ as_stated: 'ğ'.repeat(60) })), []);
  assertEquals(validateJsonSchema(WATER_OP, water({ as_stated: 'ğ'.repeat(61) })).length, 1);
});

Deno.test('validate: the "1 bardak = 1 litre" class — unit outside the enum is caught with a path', () => {
  const issues = validateJsonSchema(DECISION, { intent: 'log', writes: [water({ unit: 'glass' })] });
  assert(issues.some((i) => i.startsWith('$.writes[0].unit:')), issues.join(' | '));
});

Deno.test('validate: range, type, required, additionalProperties', () => {
  assert(validateJsonSchema(WATER_OP, water({ quantity: 250 })).some((i) => i.includes('maximum 50')));
  assert(validateJsonSchema(WATER_OP, water({ quantity: '1' })).some((i) => i.includes('expected number')));
  const { mode: _drop, ...noMode } = water();
  assert(validateJsonSchema(WATER_OP, noMode).some((i) => i === '$.mode: required property is missing'));
  assert(validateJsonSchema(WATER_OP, water({ liters: 1 })).some((i) => i.includes('$.liters') && i.includes('not allowed')));
  // null is only valid where the schema says so.
  assertEquals(validateJsonSchema(WATER_OP, water({ other_ml_each: null })), []);
  assert(validateJsonSchema(WATER_OP, water({ quantity: null })).length > 0);
});

Deno.test('validate: integer vs number, const, array bounds', () => {
  assertEquals(validateJsonSchema({ type: 'integer' }, 3), []);
  assert(validateJsonSchema({ type: 'integer' }, 3.5).length === 1);
  assertEquals(validateJsonSchema({ type: 'number' }, 3), [], 'an integer is a number');
  assert(validateJsonSchema({ const: 'water_log' }, 'meal_log').length === 1);
  assert(validateJsonSchema(MEAL_OP, { op: 'meal_log', raw: 'x', items: [] }).some((i) => i.includes('minItems 1')));
  assert(validateJsonSchema({ type: 'number' }, NaN).length === 1, 'NaN is not a JSON number');
});

Deno.test('validate: anyOf reports the closest branch, not just "no match"', () => {
  const issues = validateJsonSchema(DECISION, { intent: 'log', writes: [water({ mode: 'sometimes' })] });
  assert(issues.some((i) => i.includes('matches none of the anyOf branches')));
  assert(issues.some((i) => i.startsWith('$.writes[0].mode:')), issues.join(' | '));
});

Deno.test('validate: unknown keywords are ignored, never a false rejection', () => {
  assertEquals(validateJsonSchema({ type: 'string', format: 'date-time', 'x-tr': 'gün' }, 'dün'), []);
  assertEquals(validateJsonSchema({ type: 'string', pattern: '(' }, 'x'), [], 'an unparseable pattern is not enforced');
});

Deno.test('validate: recursive $ref works; a broken $ref is reported, a cycle does not overflow', () => {
  const tree = {
    type: 'object', additionalProperties: false, required: ['name', 'children'],
    properties: { name: { type: 'string' }, children: { type: 'array', items: { $ref: '#' } } },
  };
  assertEquals(validateJsonSchema(tree, { name: 'a', children: [{ name: 'b', children: [] }] }), []);
  assert(validateJsonSchema({ $ref: '#/$defs/missing' }, 1)[0].includes('unresolvable $ref'));
  const cyclic = { $ref: '#/$defs/a', $defs: { a: { $ref: '#/$defs/a' } } };
  assert(validateJsonSchema(cyclic, 1)[0].includes('nesting exceeds'));
});

Deno.test('validate: issue count is capped', () => {
  const many = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, i]));
  assertEquals(validateJsonSchema({ type: 'object', additionalProperties: false, properties: {} }, many).length, 25);
  assertEquals(validateJsonSchema({ type: 'object', additionalProperties: false, properties: {} }, many, { maxIssues: 3 }).length, 3);
});

Deno.test('strictSchemaIssues: a registry-shaped schema is strict-clean', () => {
  assertEquals(strictSchemaIssues(DECISION), []);
});

Deno.test('strictSchemaIssues: the three rules strict mode 400s on', () => {
  assert(strictSchemaIssues({ anyOf: [WATER_OP, MEAL_OP] }).some((i) => i.includes('root')), 'root must be an object');
  const loose = { type: 'object', required: ['a'], properties: { a: { type: 'string' } } };
  assert(strictSchemaIssues(loose).some((i) => i.includes('additionalProperties')));
  const optional = { type: 'object', additionalProperties: false, required: [], properties: { a: { type: 'string' } } };
  assert(strictSchemaIssues(optional).some((i) => i.includes('#/properties/a') && i.includes('required')));
  // Found inside $defs / anyOf / items too, with a pointer to the spot.
  const nested = { ...DECISION, $defs: { water: { ...WATER_OP, additionalProperties: true }, meal: MEAL_OP } };
  assert(strictSchemaIssues(nested).some((i) => i.startsWith('#/$defs/water')));
  assertEquals(strictSchemaIssues('nope'), ['#: schema must be a JSON object']);
});

Deno.test('SCHEMA_NAME_RE mirrors the provider constraint', () => {
  assert(SCHEMA_NAME_RE.test('kochko_understand_v1'));
  assert(SCHEMA_NAME_RE.test('kochko-reply-v2'));
  assert(!SCHEMA_NAME_RE.test('kochko understand'));
  assert(!SCHEMA_NAME_RE.test(''));
  assert(!SCHEMA_NAME_RE.test('a'.repeat(65)));
});
