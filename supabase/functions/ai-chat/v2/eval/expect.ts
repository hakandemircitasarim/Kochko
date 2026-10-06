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
  type OutcomeStatus,
  type PathExpectation,
  type Quantifier,
  SET_OPERATORS,
  STAGE_ROOTS,
  type StageRoot,
  type TurnResult,
  VALUE_OPERATORS,
} from './types.ts';
import { applyAliases, normTr, parsePath, resolveSegments } from './path.ts';

export interface EvalContext {
  turn: TurnResult;
  message: string;
  aliases?: Record<string, string>;
}

const NEGATIVE_DEFAULT_ALL = new Set(['ne', 'not_in', 'not_contains', 'not_contains_any']);
/** Level words that mean "no signal" for `flag` (bool or enum safety fields, §7.2). */
const NEGATIVE_LEVELS = new Set(['', 'none', 'no', 'false', 'benign', 'yok', 'null', 'n/a', 'not_applicable']);

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

/** true / "possible" / "clear" / 1 / {category:"purging"} → positive; false / null / "none" → negative. */
export function isPositiveSignal(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v > 0;
  if (typeof v === 'string') return !NEGATIVE_LEVELS.has(normTr(v));
  if (Array.isArray(v)) return v.some(isPositiveSignal);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of ['level', 'severity', 'category', 'value']) if (k in o) return isPositiveSignal(o[k]);
    return true;
  }
  return false;
}

function textContains(hay: unknown, needle: string): boolean {
  if (typeof hay === 'string') return normTr(hay).includes(normTr(needle));
  // A lab value or a year may arrive as a number or as text; "118" must match both.
  if (typeof hay === 'number') return String(hay).includes(normTr(needle));
  if (Array.isArray(hay)) return hay.some((x) => (typeof x === 'string' ? normTr(x) === normTr(needle) : deepEqual(x, needle)));
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

function valuePredicate(op: string, arg: unknown, message: string): (v: unknown) => boolean {
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
    case 'flag': return (v) => isPositiveSignal(v) === arg;
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

interface Resolved { status: 'ok'; values: unknown[]; plural: boolean }
type RootState = Resolved | { status: 'skipped' | 'fail'; detail: string };

function resolve(path: string, ctx: EvalContext): RootState {
  const segs = parsePath(applyAliases(path, ctx.aliases));
  const root = (segs[0] as { key: string }).key as StageRoot;
  if (!STAGE_ROOTS.includes(root)) return { status: 'fail', detail: `bilinmeyen kök "${root}"` };
  const st = ctx.turn.stages[root];
  if (st === 'error') return { status: 'fail', detail: `${root} aşaması hata verdi: ${ctx.turn.stage_errors[root] ?? '?'}` };
  if (st !== 'ok') return { status: 'skipped', detail: `${root} aşaması bu koşuda çalışmadı` };
  const r = resolveSegments(ctx.turn.outputs[root], segs.slice(1));
  return { status: 'ok', values: r.values, plural: r.plural };
}

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
    return { status: ok ? 'pass' : 'fail', detail: `sayı=${n}; bulunan: ${brief(r.values)}` };
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

  const pred = valuePredicate(op, arg, ctx.message);
  const values = r.values.filter((v) => v !== undefined);
  const q: Quantifier = e.quantifier ?? (NEGATIVE_DEFAULT_ALL.has(op) ? 'all' : 'any');
  let ok: boolean;
  if (q === 'any') ok = values.some(pred);
  else if (q === 'all') ok = values.every(pred);
  else ok = !values.some(pred);
  const empty = values.length === 0 ? ' (değer yok)' : '';
  return { status: ok ? 'pass' : 'fail', detail: `${q}; bulunan: ${brief(values)}${empty}` };
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
