/**
 * Expectation evaluation (§9.2). Pure: (expectation, stage outputs, user message) → outcome.
 *
 * Skip vs fail is the load-bearing rule: an expectation on a stage that did not run is SKIPPED
 * (the fixture stays valid while v2 lands piece by piece); on a stage that ran and errored
 * (unparseable JSON, refusal) it FAILS — that is the model's behaviour, not missing plumbing.
 */
import {
  type AllOfExpectation,
  type AnyOfExpectation,
  type Expectation,
  type ExpectationOutcome,
  type Json,
  NEGATIVE_OPERATORS,
  type OutcomeStatus,
  type PathExpectation,
  type PrefixMatch,
  type Quantifier,
  SET_OPERATORS,
  STAGE_ROOTS,
  type StageRoot,
  type TurnResult,
  VALUE_OPERATORS,
} from './types.ts';
import { containsWords, hasTokenPrefix, normTr, parsePath, resolveSegments } from './path.ts';
import { ED_CATEGORIES, ENVELOPE_HEAD, TRIPWIRE_READINGS } from '../../../shared/write-registry/mod.ts';
import type { FieldSpec } from '../../../shared/write-registry/dsl.ts';

export interface EvalContext {
  turn: TurnResult;
  message: string;
}

const NEGATIVE_DEFAULT_ALL = new Set(NEGATIVE_OPERATORS);
/** The registry's "not an eating-disorder signal" category (envelope.ts ED_CATEGORIES). */
const ED_NOT_A_SIGNAL: keyof typeof ED_CATEGORIES = 'illness_vomiting';
/** The registry's protective tripwire reading (envelope.ts TRIPWIRE_READINGS). */
const TRIPWIRE_POSITIVE: keyof typeof TRIPWIRE_READINGS = 'positive';
/** The registry's own safety field declarations (envelope.ts ENVELOPE_HEAD.safety) — the ONLY
 *  shapes `flag` reads. A field added or reshaped there changes what is recognised here. */
const SAFETY_FIELDS: Readonly<Record<string, FieldSpec>> = ENVELOPE_HEAD.safety.fields;
const hasOwn = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const isPlainObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export const isAnyOf = (e: Expectation): e is AnyOfExpectation => 'any_of' in e;
export const isAllOf = (e: Expectation): e is AllOfExpectation => 'all_of' in e;

/** The single operator key of a path expectation (lint guarantees exactly one). */
export function operatorOf(e: PathExpectation): string | null {
  const ops = [...VALUE_OPERATORS, ...SET_OPERATORS].filter((k) => (e as unknown as Record<string, unknown>)[k] !== undefined);
  return ops.length === 1 ? ops[0] : null;
}

export function expectationLabel(e: Expectation): string {
  if (isAnyOf(e)) return `any_of(${e.any_of.map(expectationLabel).join(' | ')})`;
  if (isAllOf(e)) return `all_of(${e.all_of.map(expectationLabel).join(' & ')})`;
  const op = operatorOf(e) ?? '?';
  const val = (e as unknown as Record<string, unknown>)[op];
  return `${e.path} ${op} ${JSON.stringify(val)}`;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  if (typeof a === 'object') {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao);
    return ak.length === Object.keys(bo).length && ak.every((k) => deepEqual(ao[k], bo[k]));
  }
  return false;
}

/** The registry safety field a `flag` path reads (its last key), or null when it reads anything else. */
export function safetyFieldOf(path: string): string | null {
  let segs;
  try {
    segs = parsePath(path);
  } catch {
    return null;
  }
  const last = segs[segs.length - 1];
  return segs.length > 1 && last.kind === 'key' && hasOwn(SAFETY_FIELDS, last.key) ? last.key : null;
}

/**
 * One registry safety field's value as a signal, read by its declaration:
 *   bool (acute_medical, self_harm)            → itself
 *   nullable obj with an enum `category` (ed_signal) → null = negative; positive unless the
 *                                                 category is illness_vomiting ("YB değil")
 *   list of {hit_id, reading, reason} (tripwire_readings) → [] = negative; positive when ANY
 *                                                 reading is `positive` (one per hit; any positive protects)
 * Every object must carry exactly the declared keys (strict decoding emits all of them and nothing
 * else) and every enum value must be one the registry declares. Anything else → null.
 */
function exactKeys(fields: Readonly<Record<string, FieldSpec>>, v: unknown): v is Record<string, unknown> {
  if (!isPlainObj(v)) return false;
  const keys = Object.keys(fields);
  return Object.keys(v).length === keys.length && keys.every((k) => hasOwn(v, k));
}

function readSafetyField(spec: FieldSpec, v: unknown): boolean | null {
  if (spec.kind === 'bool') return typeof v === 'boolean' ? v : null;
  if (spec.kind === 'list') {
    const reading = spec.fields.reading;
    if (!Array.isArray(v) || reading?.kind !== 'enum') return null;
    let positive = false;
    for (const el of v) {
      if (!exactKeys(spec.fields, el)) return null;
      const r = el.reading;
      if (typeof r !== 'string' || !hasOwn(reading.values, r)) return null;
      if (r === TRIPWIRE_POSITIVE) positive = true;
    }
    return positive;
  }
  if (spec.kind !== 'obj') return null;
  if (v === null) return spec.nullable ? false : null;
  if (!exactKeys(spec.fields, v)) return null;
  const cat = spec.fields.category;
  if (cat?.kind === 'enum') {
    const c = v.category;
    return typeof c === 'string' && hasOwn(cat.values, c) ? c !== ED_NOT_A_SIGNAL : null;
  }
  return null;
}

/**
 * Read a value as a registry safety signal (ENVELOPE_HEAD.safety). With `field` (what `flag`
 * passes: the path's last key) only THAT field's declaration is used; a field that is not a
 * registry safety field reads nothing. Without it, the value must be readable by the safety
 * fields and every reading must agree. null = not a registry shape: the harness does not guess,
 * and the `flag` check fails closed for both flag:true and flag:false ("tanınmayan sinyal biçimi").
 */
export function signalOf(v: unknown, field?: string): boolean | null {
  if (field !== undefined) return hasOwn(SAFETY_FIELDS, field) ? readSafetyField(SAFETY_FIELDS[field], v) : null;
  const readings = Object.values(SAFETY_FIELDS).map((s) => readSafetyField(s, v)).filter((x): x is boolean => x !== null);
  return readings.length && readings.every((x) => x === readings[0]) ? readings[0] : null;
}

function textContains(hay: unknown, needle: string): boolean {
  if (typeof hay === 'string') return normTr(hay).includes(normTr(needle));
  // A lab value or a year may arrive as a number or as text; "118" must match both.
  if (typeof hay === 'number') return String(hay).includes(normTr(needle));
  if (Array.isArray(hay)) return hay.some((x) => (typeof x === 'string' ? normTr(x) === normTr(needle) : deepEqual(x, needle)));
  return false;
}

/** Whole-word variant: text by tokens; a list element must equal the needle (as textContains). */
function wordsIn(hay: unknown, needle: string): boolean {
  if (typeof hay === 'string') return containsWords(hay, needle);
  if (Array.isArray(hay)) return hay.some((x) => typeof x === 'string' && normTr(x) === normTr(needle));
  return false;
}

/** Token-prefix variant: text by tokens (with exceptions); a list matches when any element does. */
function prefixIn(hay: unknown, m: PrefixMatch): boolean {
  if (typeof hay === 'string') return hasTokenPrefix(hay, m.prefixes, m.except ?? []);
  if (Array.isArray(hay)) return hay.some((x) => typeof x === 'string' && hasTokenPrefix(x, m.prefixes, m.except ?? []));
  return false;
}

/** Normalize a quote/message the same way on both sides: Turkish lower-case, collapsed spaces,
 *  surrounding quote marks and end punctuation dropped (a model quoting "…" is still verbatim). */
function normQuote(s: string): string {
  const strip = new Set(['"', "'", '“', '”', '‘', '’', '«', '»', '.', ',', '!', '?', ' ']);
  let t = normTr(s);
  while (t.length && strip.has(t[0])) t = t.slice(1);
  while (t.length && strip.has(t[t.length - 1])) t = t.slice(0, -1);
  return t;
}

function valuePredicate(op: string, arg: unknown, message: string, path: string): (v: unknown) => boolean {
  switch (op) {
    case 'eq': return (v) => deepEqual(v, arg);
    case 'ne': return (v) => !deepEqual(v, arg);
    case 'in': return (v) => (arg as Json[]).some((a) => deepEqual(v, a));
    case 'not_in': return (v) => !(arg as Json[]).some((a) => deepEqual(v, a));
    case 'between': {
      const [lo, hi] = arg as [number, number];
      return (v) => typeof v === 'number' && v >= lo && v <= hi;
    }
    case 'gte': return (v) => typeof v === 'number' && v >= (arg as number);
    case 'lte': return (v) => typeof v === 'number' && v <= (arg as number);
    case 'gt': return (v) => typeof v === 'number' && v > (arg as number);
    case 'lt': return (v) => typeof v === 'number' && v < (arg as number);
    case 'contains': return (v) => textContains(v, arg as string);
    case 'not_contains': return (v) => !textContains(v, arg as string);
    case 'contains_any': return (v) => (arg as string[]).some((n) => textContains(v, n));
    case 'not_contains_any': return (v) => !(arg as string[]).some((n) => textContains(v, n));
    case 'contains_word_any': return (v) => (arg as string[]).some((n) => wordsIn(v, n));
    case 'not_contains_word_any': return (v) => !(arg as string[]).some((n) => wordsIn(v, n));
    case 'contains_prefix_any': return (v) => prefixIn(v, arg as PrefixMatch);
    case 'not_contains_prefix_any': return (v) => !prefixIn(v, arg as PrefixMatch);
    case 'flag': {
      const field = safetyFieldOf(path);
      return (v) => {
        if (field === null) return false; // not a registry safety field: nothing to read
        const s = signalOf(v, field);
        return s !== null && s === arg; // an unrecognised shape fails BOTH flag:true and flag:false
      };
    }
    case 'verbatim_in_message': {
      const msg = normQuote(message);
      return (v) => (typeof v === 'string' && normQuote(v).length > 0 && msg.includes(normQuote(v))) === arg;
    }
    default: return () => false;
  }
}

function brief(values: unknown[]): string {
  const s = JSON.stringify(values.length === 1 ? values[0] : values);
  return s === undefined ? 'undefined' : s.length > 160 ? s.slice(0, 157) + '...' : s;
}

interface Resolved { status: 'ok'; values: unknown[]; plural: boolean; missing: string[] }
type RootState = Resolved | { status: 'skipped' | 'fail'; detail: string };

function resolve(path: string, ctx: EvalContext): RootState {
  const segs = parsePath(path);
  const root = (segs[0] as { key: string }).key as StageRoot;
  if (!STAGE_ROOTS.includes(root)) return { status: 'fail', detail: `bilinmeyen kök "${root}"` };
  const st = ctx.turn.stages[root];
  if (st === 'error') return { status: 'fail', detail: `${root} aşaması hata verdi: ${ctx.turn.stage_errors[root] ?? '?'}` };
  if (st !== 'ok') return { status: 'skipped', detail: `${root} aşaması bu koşuda çalışmadı` };
  const unbound = ctx.turn.unbound?.[root];
  if (unbound) {
    for (const s of segs.slice(1)) {
      const k = s.kind === 'key' || s.kind === 'deep' || s.kind === 'filter' ? s.key : null;
      if (k !== null && Object.prototype.hasOwnProperty.call(unbound, k)) return { status: 'skipped', detail: `${root}.${k} henüz üretilmiyor: ${unbound[k]}` };
    }
  }
  const r = resolveSegments(ctx.turn.outputs[root], segs.slice(1));
  return { status: 'ok', values: r.values, plural: r.plural, missing: r.missing };
}

const missingNote = (r: Resolved) => (r.missing.length ? ` · yolda yok: ${r.missing.join(', ')}` : '');

function countOf(r: Resolved): number {
  const present = r.values.filter((v) => v !== undefined && v !== null);
  if (r.plural) return present.length;
  if (present.length === 0) return 0;
  const v = present[0];
  return Array.isArray(v) ? v.length : 1;
}

function evalPath(e: PathExpectation, ctx: EvalContext): { status: OutcomeStatus; detail: string } {
  const op = operatorOf(e);
  if (!op) return { status: 'fail', detail: 'tam olarak bir operatör olmalı' };
  let r: RootState;
  try {
    r = resolve(e.path, ctx);
  } catch (err) {
    return { status: 'fail', detail: (err as Error).message };
  }
  if (r.status !== 'ok') return { status: r.status, detail: r.detail };
  const arg = (e as unknown as Record<string, unknown>)[op];

  if ((SET_OPERATORS as readonly string[]).includes(op)) {
    const n = countOf(r);
    let ok: boolean;
    switch (op) {
      case 'exists': ok = (n > 0) === arg; break;
      case 'absent': ok = (n === 0) === arg; break;
      case 'count': ok = n === arg; break;
      case 'count_gte': ok = n >= (arg as number); break;
      case 'count_lte': ok = n <= (arg as number); break;
      case 'empty': {
        const single = !r.plural && r.values.length === 1 ? r.values[0] : undefined;
        const isEmpty = typeof single === 'string' ? single.trim() === '' : n === 0;
        ok = isEmpty === arg;
        break;
      }
      default: ok = false;
    }
    return { status: ok ? 'pass' : 'fail', detail: `sayı=${n}; bulunan: ${brief(r.values)}${missingNote(r)}` };
  }

  if (op === 'eq_path') {
    let other: RootState;
    try {
      other = resolve(arg as string, ctx);
    } catch (err) {
      return { status: 'fail', detail: (err as Error).message };
    }
    if (other.status !== 'ok') return { status: other.status, detail: other.detail };
    const a = r.values.filter((v) => v !== undefined).map((v) => JSON.stringify(v)).sort();
    const b = other.values.filter((v) => v !== undefined).map((v) => JSON.stringify(v)).sort();
    const ok = a.length > 0 && a.length === b.length && a.every((x, i) => x === b[i]);
    return { status: ok ? 'pass' : 'fail', detail: `sol=${brief(r.values)} sağ=${brief(other.values)}` };
  }

  if (op === 'flag' && safetyFieldOf(e.path) === null) {
    return { status: 'fail', detail: `flag yalnız registry safety alanlarını okur (${Object.keys(SAFETY_FIELDS).join('|')}); "${e.path}" değil` };
  }
  const pred = valuePredicate(op, arg, ctx.message, e.path);
  const values = r.values.filter((v) => v !== undefined);
  const q: Quantifier = e.quantifier ?? (NEGATIVE_DEFAULT_ALL.has(op) ? 'all' : 'any');
  // A negative check is vacuously true on an empty set — fine when the list really is empty, not
  // when the path asked for a field the output does not have (registry drift would turn a safety
  // invariant green without checking anything).
  if (values.length === 0 && r.missing.length && q !== 'any') {
    return { status: 'fail', detail: `${q}; değer yok ve yol çıktıya uymuyor (${r.missing.join(', ')}) — boş geçiş sayılmaz` };
  }
  let ok: boolean;
  if (q === 'any') ok = values.some(pred);
  else if (q === 'all') ok = values.every(pred);
  else ok = !values.some(pred);
  const empty = values.length === 0 ? ' (değer yok)' : '';
  const field = op === 'flag' ? safetyFieldOf(e.path) : null;
  const unread = field !== null && values.some((v) => signalOf(v, field) === null) ? ` · tanınmayan sinyal biçimi (registry ${field} biçimi değil)` : '';
  return { status: ok ? 'pass' : 'fail', detail: `${q}; bulunan: ${brief(values)}${empty}${unread}${missingNote(r)}` };
}

function combine(children: { status: OutcomeStatus }[], mode: 'any' | 'all'): OutcomeStatus {
  const s = children.map((c) => c.status);
  if (mode === 'any') {
    if (s.includes('pass')) return 'pass';
    return s.includes('skipped') ? 'skipped' : 'fail';
  }
  if (s.includes('fail')) return 'fail';
  return s.includes('skipped') ? 'skipped' : 'pass';
}

export function evaluateExpectation(e: Expectation, ctx: EvalContext, index = 0): ExpectationOutcome {
  const label = expectationLabel(e);
  if (isAnyOf(e) || isAllOf(e)) {
    const kids = (isAnyOf(e) ? e.any_of : e.all_of).map((c, i) => evaluateExpectation(c, ctx, i));
    const status = combine(kids, isAnyOf(e) ? 'any' : 'all');
    return { index, label, status, detail: kids.map((k) => `[${k.status}] ${k.detail}`).join(' ; ') };
  }
  const r = evalPath(e, ctx);
  return { index, label, status: r.status, detail: r.detail };
}

export function evaluateAll(expect: Expectation[], ctx: EvalContext): ExpectationOutcome[] {
  return expect.map((e, i) => evaluateExpectation(e, ctx, i));
}
