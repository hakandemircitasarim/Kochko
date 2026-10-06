/**
 * write-registry/schema.ts — strict json_schema generators (AI_MIMARI_V2 §4.1, §3.1).
 *
 * Responses API strict mode rules, applied everywhere:
 *   • every object: `additionalProperties: false` and EVERY property listed in `required`;
 *   • optional = type union with null (`["number","null"]`, enum includes null, nullable object =
 *     anyOf [object, null]);
 *   • op unions = `anyOf` of branches discriminated by a single-value `op` enum;
 *   • the root is an object (never anyOf); the write union lives once in `$defs.write` and is
 *     referenced by writes[] and by record_ops.update.patch.
 * Deliberately NOT emitted: minimum/maximum/maxLength/minItems. A decode-time clamp would rewrite
 * the model's number silently; ranges are checked by validateDecision, where a violation is a
 * visible REJECT/ASK with a reason (§2 rule 1). No per-turn dynamic enums: refs are strings.
 *
 * Output is byte-deterministic (insertion-ordered objects, registry order) — it is part of Stage
 * A's cached prefix and pinned by registry.test.ts against SCHEMA_VERSION.
 */
import type { Channel, FieldSpec, Fields, RegOp } from './dsl.ts';
import { ENVELOPE_HEAD, ENVELOPE_TAIL, REPLY_HEAD, REPLY_TAIL } from './envelope.ts';
import { opsIn, SCHEMA_VERSION, UNDERSTAND_CHANNELS } from './registry.ts';

export type JsonSchema = { [k: string]: unknown };

const WRITE_DEF = '#/$defs/write';

function typeOf(t: string, nullable: boolean): string | string[] {
  return nullable ? [t, 'null'] : t;
}

function described(base: JsonSchema, tr: string | undefined): JsonSchema {
  return tr ? { ...base, description: tr } : base;
}

export function fieldSchema(spec: FieldSpec): JsonSchema {
  switch (spec.kind) {
    case 'num':
      return described({ type: typeOf('number', spec.nullable) }, spec.tr);
    case 'text':
      return described({ type: typeOf('string', spec.nullable) }, spec.format === 'hhmm' ? `HH:MM (24 saat)${spec.tr ? ' — ' + spec.tr : ''}` : spec.tr);
    case 'bool':
      return described({ type: typeOf('boolean', spec.nullable) }, spec.tr);
    case 'enum': {
      const ids: Array<string | null> = Object.keys(spec.values);
      return described({ type: typeOf('string', spec.nullable), enum: spec.nullable ? [...ids, null] : ids }, spec.tr);
    }
    case 'enumList':
      return described({ type: 'array', items: { type: 'string', enum: Object.keys(spec.values) } }, spec.tr);
    case 'textList':
      return described({ type: 'array', items: { type: 'string' } }, spec.tr);
    case 'day':
      return described({ type: typeOf('string', spec.nullable) }, `today | yesterday | YYYY-MM-DD${spec.tr ? ' — ' + spec.tr : ''}`);
    case 'date':
      return described({ type: typeOf('string', spec.nullable) }, `YYYY-MM-DD${spec.tr ? ' — ' + spec.tr : ''}`);
    case 'ref':
      return described({ type: typeOf('string', spec.nullable) }, `${spec.kinds.join('|')}-ref (ör. ${spec.kinds[0]}3)${spec.tr ? ' — ' + spec.tr : ''}`);
    case 'list':
      return described({ type: 'array', items: objectSchema(spec.fields) }, spec.tr);
    case 'obj':
      return spec.nullable
        ? { anyOf: [objectSchema(spec.fields, spec.tr), { type: 'null' }] }
        : objectSchema(spec.fields, spec.tr);
    case 'write':
      return { $ref: WRITE_DEF };
  }
}

export function objectSchema(fields: Fields, tr?: string, head?: Record<string, JsonSchema>): JsonSchema {
  const properties: Record<string, JsonSchema> = { ...(head ?? {}) };
  for (const [name, spec] of Object.entries(fields)) properties[name] = fieldSchema(spec);
  return {
    type: 'object',
    ...(tr ? { description: tr } : {}),
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  };
}

/** One anyOf branch: `{op: <wire>, ...fields}`. */
export function opBranch(o: RegOp): JsonSchema {
  return objectSchema(o.fields, o.title_tr, { op: { type: 'string', enum: [o.op] } });
}

function unionOf(channel: Channel): JsonSchema {
  const branches = opsIn(channel).map(opBranch);
  return branches.length === 1 ? branches[0] : { anyOf: branches };
}

function channelArray(channel: Channel): JsonSchema {
  return { type: 'array', items: channel === 'writes' ? { $ref: WRITE_DEF } : unionOf(channel) };
}

function fieldsInto(target: Record<string, JsonSchema>, fields: Fields): void {
  for (const [name, spec] of Object.entries(fields)) target[name] = fieldSchema(spec);
}

function understandProperties(): Record<string, JsonSchema> {
  const p: Record<string, JsonSchema> = {};
  fieldsInto(p, ENVELOPE_HEAD);
  for (const ch of UNDERSTAND_CHANNELS) p[ch] = channelArray(ch);
  fieldsInto(p, ENVELOPE_TAIL);
  return p;
}

function replyProperties(): Record<string, JsonSchema> {
  const p: Record<string, JsonSchema> = {};
  fieldsInto(p, REPLY_HEAD);
  p.memory = channelArray('memory');
  fieldsInto(p, REPLY_TAIL);
  return p;
}

function root(properties: Record<string, JsonSchema>, withWriteDef: boolean): JsonSchema {
  return {
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
    ...(withWriteDef ? { $defs: { write: unionOf('writes') } } : {}),
  };
}

/** Stage A — 'kochko_understand_vN' (decision-first). */
export function buildUnderstandSchema(): JsonSchema {
  return root(understandProperties(), true);
}

/** §3.1 escape hatch — ONE call: the understanding envelope, then the reply fields. */
export function buildFusedSchema(): JsonSchema {
  return root({ ...understandProperties(), ...replyProperties() }, true);
}

/** Stage B — 'kochko_reply_vN' (suggested_* before the prose, then memory/ui). */
export function buildReplySchema(): JsonSchema {
  return root(replyProperties(), false);
}

export const SCHEMA_NAMES = {
  understand: `kochko_understand_${SCHEMA_VERSION}`,
  fused: `kochko_fused_${SCHEMA_VERSION}`,
  reply: `kochko_reply_${SCHEMA_VERSION}`,
} as const;

/** Responses API `text.format` (strict). Legacy chat: wrap as response_format.json_schema. */
export function strictFormat(kind: keyof typeof SCHEMA_NAMES): { type: 'json_schema'; name: string; schema: JsonSchema; strict: true } {
  const schema = kind === 'understand' ? buildUnderstandSchema() : kind === 'fused' ? buildFusedSchema() : buildReplySchema();
  return { type: 'json_schema', name: SCHEMA_NAMES[kind], schema, strict: true };
}

/** The exact bytes the provider receives (and the snapshot pins). */
export function schemaBytes(schema: JsonSchema): string {
  return JSON.stringify(schema);
}

/**
 * Size facts checked against the provider's strict-mode limits (registry.test.ts): total object
 * properties, nesting depth of objects, enum values and the string budget of names/enum values.
 */
export function schemaStats(schema: JsonSchema): { properties: number; maxDepth: number; enumValues: number; stringChars: number } {
  let properties = 0;
  let maxDepth = 0;
  let enumValues = 0;
  let stringChars = 0;
  const defs = (schema.$defs ?? {}) as Record<string, JsonSchema>;
  const walk = (node: unknown, depth: number, seen: Set<string>) => {
    if (!node || typeof node !== 'object') return;
    const n = node as JsonSchema;
    if (typeof n.$ref === 'string') {
      const key = n.$ref.replace('#/$defs/', '');
      if (!seen.has(key)) walk(defs[key], depth, new Set([...seen, key]));
      return;
    }
    if (n.type === 'object' || (Array.isArray(n.type) && n.type.includes('object'))) {
      const d = depth + 1;
      maxDepth = Math.max(maxDepth, d);
      const props = (n.properties ?? {}) as Record<string, unknown>;
      for (const [k, v] of Object.entries(props)) {
        properties++;
        stringChars += k.length;
        walk(v, d, seen);
      }
      return;
    }
    if (Array.isArray(n.enum)) {
      for (const e of n.enum) if (typeof e === 'string') { enumValues++; stringChars += e.length; }
    }
    if (n.items) walk(n.items, depth, seen);
    if (Array.isArray(n.anyOf)) for (const b of n.anyOf) walk(b, depth, seen);
  };
  walk(schema, 0, new Set());
  return { properties, maxDepth, enumValues, stringChars };
}
