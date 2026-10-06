/**
 * write-registry/util.ts — the small pure helpers every registry file shares (AI_MIMARI_V2 §4).
 *
 * No Deno APIs, no I/O, no imports: ai-chat, ai-plan, the eval runner and (later) the client can
 * all load the registry. Dates are plain 'YYYY-MM-DD' strings in the user's effective day, so the
 * validator never touches a clock or a timezone — the caller passes `today`.
 */

/** Round to N decimals without the 1.005 float trap ("0,25 L" must stay 0,25). */
export function roundTo(n: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round((n + Number.EPSILON) * f) / f;
}

export const round2 = (n: number): number => roundTo(n, 2);

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar day in 'YYYY-MM-DD' (rejects 2026-02-30). */
export function isIsoDay(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = ISO_DAY.exec(s);
  if (!m) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Shift an ISO day by whole days (UTC arithmetic on a date-only value is DST-safe). */
export function shiftDay(day: string, offset: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/**
 * Resolve a log day ('today' | 'yesterday' | 'YYYY-MM-DD') against the user's effective day.
 * Returns null when the token is malformed — the caller turns that into a visible issue.
 */
export function resolveDay(token: unknown, today: string): string | null {
  if (token === 'today') return today;
  if (token === 'yesterday') return shiftDay(today, -1);
  return isIsoDay(token) ? token : null;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/** 24-hour 'HH:MM' — the format the MODEL is asked to emit (it converts "sabah 7 gibi"). */
export function isHhmm(s: unknown): s is string {
  return typeof s === 'string' && HHMM.test(s);
}

/**
 * Normalise text for the verbatim-evidence check (§5: the ONE place code looks at the user's
 * words outside the safety tripwires). Only case, Unicode form, quotes and whitespace are folded;
 * the words themselves must match, so a paraphrase is not "verbatim".
 */
export function normalizeForQuote(s: string): string {
  return s
    .normalize('NFC')
    .toLocaleLowerCase('tr')
    .replace(/[‘’‚‛′`´]/g, "'")
    .replace(/[“”„‟″«»]/g, '"')
    .replace(/[.,!?;:…"'()]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Is `quote` a (normalised) substring of the user's message? Empty quotes never pass. */
export function isVerbatimQuote(quote: unknown, userMessage: string): boolean {
  if (typeof quote !== 'string') return false;
  const q = normalizeForQuote(quote);
  if (q.length < 2) return false;
  return normalizeForQuote(userMessage).includes(q);
}

/** Turkish decimal display: 0.2 → "0,20" (fixed decimals), used by receipts and docs. */
export function trNum(n: number, decimals = 0): string {
  return roundTo(n, decimals).toFixed(decimals).replace('.', ',');
}

/** Turkish display with grouping for big counts: 12000 → "12.000". */
export function trInt(n: number): string {
  return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Deep structural equality for JSON-like values (tests and the no-rewrite check). */
export function jsonEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((v, i) => jsonEqual(v, b[i]));
  }
  if (typeof a === 'object') {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao);
    if (ak.length !== Object.keys(bo).length) return false;
    return ak.every((k) => Object.prototype.hasOwnProperty.call(bo, k) && jsonEqual(ao[k], bo[k]));
  }
  return false;
}

/** JSON-safe deep clone (the validator works on copies; the model's decision is never mutated). */
export function cloneJson<T>(v: T): T {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
