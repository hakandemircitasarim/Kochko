/**
 * json-schema-check.ts — the LOCAL twin of the provider's strict structured-output check
 * (docs/AI_MIMARI_V2.md §5.1 madde 1, §10 Faz 1).
 *
 * WHY it exists: strict `json_schema` is enforced by OpenAI at generation time, but the incident
 * rollback path (OPENAI_BASE_URL → a gateway / gpt-4o) may only speak `json_object`. On that path
 * nothing upstream guarantees the shape, so the SAME schema must be checked here before a single
 * field is trusted. It is also run on the strict path as defence in depth: a provider that ever
 * returns an off-schema object is surfaced as `invalid`, never written.
 *
 * Scope is deliberately the strict-mode subset OpenAI documents (type/properties/required/
 * additionalProperties/enum/const/anyOf/allOf/items/$ref/$defs + numeric/string/array bounds).
 * Unknown keywords are IGNORED, never reported: a validator that is stricter than the provider
 * would turn a valid model answer into a false `invalid`, which is its own silent override.
 *
 * Pure, zero imports, no Deno globals — the write registry, the eval runner and the client can
 * all import it.
 */

export type JsonSchema = Record<string, unknown>;

/** OpenAI's constraint on `text.format.name` / `json_schema.name`; anything else is a 400. */
export const SCHEMA_NAME_RE = /^[A-Za-z0-9_-]{1,64}$/;

const DEFAULT_MAX_ISSUES = 25;
// A recursive $ref ('#') on a self-similar value is legal; a cycle that never consumes input
// is not. The depth cap turns the latter into one issue instead of a stack overflow.
const MAX_DEPTH = 64;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function typeName(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  if (typeof v === 'number') return Number.isInteger(v) ? 'integer' : 'number';
  return typeof v;
}

function matchesType(t: unknown, v: unknown): boolean {
  switch (t) {
    case 'null': return v === null;
    case 'array': return Array.isArray(v);
    case 'object': return isPlainObject(v);
    case 'integer': return typeof v === 'number' && Number.isInteger(v);
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'string': return typeof v === 'string';
    case 'boolean': return typeof v === 'boolean';
    default: return true; // unknown type keyword → not ours to reject
  }
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((x, i) => deepEqual(x, bb[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao);
  if (ak.length !== Object.keys(bo).length) return false;
  return ak.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && deepEqual(ao[k], bo[k]));
}

/** Resolve a local JSON pointer ('#', '#/$defs/x', '#/definitions/x/properties/y'). */
function resolveRef(root: JsonSchema, ref: string): unknown {
  if (ref === '#') return root;
  if (!ref.startsWith('#/')) return undefined; // remote refs are not part of the strict subset
  let node: unknown = root;
  for (const raw of ref.slice(2).split('/')) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (!isPlainObject(node) || !(key in node)) return undefined;
    node = node[key];
  }
  return node;
}

function childPath(path: string, key: string | number): string {
  if (typeof key === 'number') return `${path}[${key}]`;
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

interface Ctx { root: JsonSchema; issues: string[]; max: number }

function push(ctx: Ctx, msg: string): void {
  if (ctx.issues.length < ctx.max) ctx.issues.push(msg);
}

function check(schema: unknown, value: unknown, path: string, ctx: Ctx, depth: number): void {
  if (ctx.issues.length >= ctx.max) return;
  if (schema === true || schema === undefined) return;
  if (schema === false) { push(ctx, `${path}: no value is allowed here`); return; }
  if (!isPlainObject(schema)) return;
  if (depth > MAX_DEPTH) { push(ctx, `${path}: schema nesting exceeds ${MAX_DEPTH} (cyclic $ref?)`); return; }

  if (typeof schema.$ref === 'string') {
    const target = resolveRef(ctx.root, schema.$ref);
    if (target === undefined) push(ctx, `${path}: unresolvable $ref ${schema.$ref}`);
    else check(target, value, path, ctx, depth + 1);
  }

  if (Array.isArray(schema.allOf)) {
    for (const sub of schema.allOf) check(sub, value, path, ctx, depth + 1);
  }

  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    // Collect each branch privately; report only when NO branch fits, and then the closest
    // branch's issues — "matches none of 7 branches" alone is undebuggable.
    let best: string[] | null = null;
    for (const sub of schema.anyOf) {
      const branch: Ctx = { root: ctx.root, issues: [], max: ctx.max };
      check(sub, value, path, branch, depth + 1);
      if (branch.issues.length === 0) { best = null; break; }
      if (best === null || branch.issues.length < best.length) best = branch.issues;
    }
    if (best !== null) {
      push(ctx, `${path}: matches none of the anyOf branches`);
      for (const i of best) push(ctx, i);
    }
  }

  if ('const' in schema && !deepEqual(value, schema.const)) {
    push(ctx, `${path}: must equal ${JSON.stringify(schema.const)}`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((e) => deepEqual(e, value))) {
    push(ctx, `${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`);
  }

  if (schema.type !== undefined) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => matchesType(t, value))) {
      push(ctx, `${path}: expected ${types.join('|')}, got ${typeName(value)}`);
      return; // every keyword below is type-specific; piling on adds noise, not signal
    }
  }

  if (typeof value === 'number') {
    if (typeof schema.minimum === 'number' && value < schema.minimum) push(ctx, `${path}: ${value} < minimum ${schema.minimum}`);
    if (typeof schema.maximum === 'number' && value > schema.maximum) push(ctx, `${path}: ${value} > maximum ${schema.maximum}`);
    if (typeof schema.exclusiveMinimum === 'number' && value <= schema.exclusiveMinimum) push(ctx, `${path}: ${value} <= exclusiveMinimum ${schema.exclusiveMinimum}`);
    if (typeof schema.exclusiveMaximum === 'number' && value >= schema.exclusiveMaximum) push(ctx, `${path}: ${value} >= exclusiveMaximum ${schema.exclusiveMaximum}`);
    if (typeof schema.multipleOf === 'number' && schema.multipleOf > 0) {
      const q = value / schema.multipleOf;
      if (Math.abs(q - Math.round(q)) > 1e-9) push(ctx, `${path}: ${value} is not a multiple of ${schema.multipleOf}`);
    }
  }

  if (typeof value === 'string') {
    // Code points, not UTF-16 units: "ğ" is one character to the user and to the provider.
    const len = [...value].length;
    if (typeof schema.minLength === 'number' && len < schema.minLength) push(ctx, `${path}: length ${len} < minLength ${schema.minLength}`);
    if (typeof schema.maxLength === 'number' && len > schema.maxLength) push(ctx, `${path}: length ${len} > maxLength ${schema.maxLength}`);
    if (typeof schema.pattern === 'string') {
      let re: RegExp | null = null;
      try { re = new RegExp(schema.pattern, 'u'); } catch { re = null; } // unparseable pattern → not ours to enforce
      if (re && !re.test(value)) push(ctx, `${path}: does not match pattern ${schema.pattern}`);
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === 'number' && value.length < schema.minItems) push(ctx, `${path}: ${value.length} items < minItems ${schema.minItems}`);
    if (typeof schema.maxItems === 'number' && value.length > schema.maxItems) push(ctx, `${path}: ${value.length} items > maxItems ${schema.maxItems}`);
    if (schema.items !== undefined && !Array.isArray(schema.items)) {
      value.forEach((item, i) => check(schema.items, item, childPath(path, i), ctx, depth + 1));
    }
  }

  if (isPlainObject(value)) {
    const props = isPlainObject(schema.properties) ? schema.properties : {};
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (typeof key === 'string' && !Object.prototype.hasOwnProperty.call(value, key)) {
          push(ctx, `${childPath(path, key)}: required property is missing`);
        }
      }
    }
    for (const [key, v] of Object.entries(value)) {
      if (Object.prototype.hasOwnProperty.call(props, key)) {
        check(props[key], v, childPath(path, key), ctx, depth + 1);
      } else if (schema.additionalProperties === false) {
        push(ctx, `${childPath(path, key)}: property is not allowed (additionalProperties: false)`);
      } else if (isPlainObject(schema.additionalProperties)) {
        check(schema.additionalProperties, v, childPath(path, key), ctx, depth + 1);
      }
    }
  }
}

/**
 * Validate `value` against `schema`. Returns human-readable issues ('$.writes[0].unit: …');
 * an EMPTY array means valid. Never throws on odd input — the caller's job is to surface the
 * issues, not to crash the turn.
 */
export function validateJsonSchema(
  schema: JsonSchema,
  value: unknown,
  opts: { maxIssues?: number } = {},
): string[] {
  const ctx: Ctx = { root: schema, issues: [], max: opts.maxIssues ?? DEFAULT_MAX_ISSUES };
  check(schema, value, '$', ctx, 0);
  return ctx.issues;
}

function isObjectSchema(s: Record<string, unknown>): boolean {
  const t = s.type;
  return t === 'object' || (Array.isArray(t) && t.includes('object')) || isPlainObject(s.properties);
}

/**
 * Lint a schema against OpenAI's strict-mode structural rules BEFORE paying for a request.
 * Strict mode 400s when (a) the root is not a plain object schema, (b) any object schema lacks
 * `additionalProperties: false`, or (c) any property is not listed in `required` (optional
 * fields must be expressed as nullable, §4.1 schema.ts). Size/depth limits are left to the
 * provider: they change between releases and a stale local copy would reject valid schemas.
 */
export function strictSchemaIssues(schema: unknown): string[] {
  const issues: string[] = [];
  if (!isPlainObject(schema)) return ['#: schema must be a JSON object'];
  if (schema.type !== 'object') issues.push('#: root must be {"type":"object"} (strict mode rejects anyOf/array roots)');
  if (Array.isArray(schema.anyOf)) issues.push('#: root must not be anyOf');

  const seen = new Set<unknown>();
  const visit = (node: unknown, at: string): void => {
    if (!isPlainObject(node) || seen.has(node)) return;
    seen.add(node);
    if (isObjectSchema(node)) {
      if (node.additionalProperties !== false) issues.push(`${at}: object schema needs "additionalProperties": false`);
      const props = isPlainObject(node.properties) ? Object.keys(node.properties) : [];
      const req = Array.isArray(node.required) ? node.required.filter((k): k is string => typeof k === 'string') : [];
      for (const p of props) if (!req.includes(p)) issues.push(`${at}/properties/${p}: must be listed in "required" (make it nullable instead of optional)`);
      for (const r of req) if (!props.includes(r)) issues.push(`${at}: "required" lists "${r}" which is not a property`);
    }
    if (isPlainObject(node.properties)) {
      for (const [k, v] of Object.entries(node.properties)) visit(v, `${at}/properties/${k}`);
    }
    if (isPlainObject(node.items)) visit(node.items, `${at}/items`);
    if (isPlainObject(node.additionalProperties)) visit(node.additionalProperties, `${at}/additionalProperties`);
    for (const key of ['anyOf', 'allOf'] as const) {
      const list = node[key];
      if (Array.isArray(list)) list.forEach((s, i) => visit(s, `${at}/${key}/${i}`));
    }
    for (const key of ['$defs', 'definitions'] as const) {
      const defs = node[key];
      if (isPlainObject(defs)) for (const [k, v] of Object.entries(defs)) visit(v, `${at}/${key}/${k}`);
    }
  };
  visit(schema, '#');
  return issues;
}
