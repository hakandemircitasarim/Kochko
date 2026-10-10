/**
 * Expectation paths (§9.2): `decision.writes[op=water_log].unit`.
 *
 * Grammar (hand-parsed — no regex anywhere under ai-chat/v2 except safety-tripwires.ts):
 *   key            property access; on an array it maps over the elements
 *   [3]            index
 *   [*]            every element (or every value of an object)
 *   [k=v] [k!=v]   filter elements whose field k stringifies (or not) to v
 *   [k~v]          filter elements whose field k contains v (Turkish lower-case)
 *   ..key          deep search: every value stored under `key` at any depth below
 *
 * A filter, wildcard, deep search or implicit array mapping makes the result PLURAL: `count`
 * then counts resolved values instead of the length of a single array value.
 */

export type PathSegment =
  | { kind: 'key'; key: string }
  | { kind: 'index'; index: number }
  | { kind: 'wild' }
  | { kind: 'deep'; key: string }
  | { kind: 'filter'; key: string; op: '=' | '!=' | '~'; value: string };

/**
 * `missing` lists keys the path asked for on an object that does NOT have them (or a `..key` found
 * nowhere inside a non-empty value). That is structure, not data: an empty list or a filter that
 * matches nothing is a legitimate "nothing here", a missing key means the path does not fit the
 * output (a renamed field) — negative checks must not pass on it (expect.ts).
 */
export interface Resolution { values: unknown[]; plural: boolean; missing: string[] }

const isDigits = (s: string) => s.length > 0 && [...s].every((c) => c >= '0' && c <= '9');

function parseBracket(inner: string, path: string): PathSegment {
  const t = inner.trim();
  if (t === '*') return { kind: 'wild' };
  if (isDigits(t)) return { kind: 'index', index: Number(t) };
  const ne = t.indexOf('!=');
  if (ne > 0) return { kind: 'filter', key: t.slice(0, ne).trim(), op: '!=', value: t.slice(ne + 2).trim() };
  const ct = t.indexOf('~');
  if (ct > 0) return { kind: 'filter', key: t.slice(0, ct).trim(), op: '~', value: t.slice(ct + 1).trim() };
  const eq = t.indexOf('=');
  if (eq > 0) return { kind: 'filter', key: t.slice(0, eq).trim(), op: '=', value: t.slice(eq + 1).trim() };
  throw new Error(`geçersiz köşeli parantez "[${inner}]" (${path})`);
}

/** Parse a path; throws a Turkish error naming the path on malformed input (fixture lint uses it). */
export function parsePath(path: string): PathSegment[] {
  const segs: PathSegment[] = [];
  let buf = '';
  let i = 0;
  let deepNext = false;
  const flush = () => {
    if (!buf) return;
    segs.push(deepNext ? { kind: 'deep', key: buf } : { kind: 'key', key: buf });
    buf = '';
    deepNext = false;
  };
  while (i < path.length) {
    const ch = path[i];
    if (ch === '.') {
      if (path[i + 1] === '.') {
        flush();
        deepNext = true;
        i += 2;
        continue;
      }
      flush();
      i++;
      continue;
    }
    if (ch === '[') {
      flush();
      if (deepNext) throw new Error(`".." sonrası anahtar gerekli (${path})`);
      const end = path.indexOf(']', i);
      if (end < 0) throw new Error(`kapanmamış "[" (${path})`);
      segs.push(parseBracket(path.slice(i + 1, end), path));
      i = end + 1;
      continue;
    }
    if (ch === ']') throw new Error(`fazla "]" (${path})`);
    buf += ch;
    i++;
  }
  flush();
  if (deepNext) throw new Error(`path ".." ile bitemez (${path})`);
  if (segs.length === 0 || segs[0].kind !== 'key') throw new Error(`path bir kök adıyla başlamalı (${path})`);
  return segs;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

const isLetter = (c: string) => c.toLowerCase() !== c.toUpperCase();

/** Word tokens without regex (Turkish lower-case): letters, digits and '_' stay inside a token. */
export function wordTokens(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (const ch of text.toLocaleLowerCase('tr')) {
    if (isLetter(ch) || (ch >= '0' && ch <= '9') || ch === '_') cur += ch;
    else if (cur) {
      out.push(cur);
      cur = '';
    }
  }
  if (cur) out.push(cur);
  return out;
}

/** Does `needle` (one or more words) occur as whole consecutive tokens of `text`? */
export function containsWords(text: string, needle: string): boolean {
  const hay = wordTokens(text);
  const want = wordTokens(needle);
  if (!want.length) return false;
  for (let i = 0; i + want.length <= hay.length; i++) {
    if (want.every((w, j) => hay[i + j] === w)) return true;
  }
  return false;
}

/**
 * Does any token of `text` start with one of `prefixes` — unless it starts with one of `except`?
 * ("kek" hits keke / kekleri / havuçlu kek; with except "kekik", "kekikli tavuk" does not.)
 */
export function hasTokenPrefix(text: string, prefixes: readonly string[], except: readonly string[] = []): boolean {
  const pre = prefixes.flatMap((p) => wordTokens(p).slice(0, 1));
  const exc = except.flatMap((e) => wordTokens(e).slice(0, 1));
  return wordTokens(text).some((tok) => pre.some((p) => tok.startsWith(p)) && !exc.some((e) => tok.startsWith(e)));
}

/** Turkish-aware lower-case + whitespace collapse; used by `~` filters and text operators. */
export function normTr(s: string): string {
  let out = '';
  let space = false;
  for (const ch of s.toLocaleLowerCase('tr')) {
    const ws = ch === ' ' || ch === '\n' || ch === '\t' || ch === '\r';
    if (ws) {
      if (!space && out) out += ' ';
      space = true;
    } else {
      out += ch;
      space = false;
    }
  }
  return out.trimEnd();
}

function stringOf(v: unknown): string {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

function filterMatches(el: unknown, seg: Extract<PathSegment, { kind: 'filter' }>): boolean {
  const field = isObj(el) ? el[seg.key] : undefined;
  if (seg.op === '~') return typeof field === 'string' && normTr(field).includes(normTr(seg.value));
  const same = stringOf(field) === seg.value;
  return seg.op === '=' ? same : !same;
}

function deepCollect(v: unknown, key: string, out: unknown[]): void {
  if (Array.isArray(v)) {
    for (const el of v) deepCollect(el, key, out);
  } else if (isObj(v)) {
    for (const [k, child] of Object.entries(v)) {
      if (k === key) out.push(child);
      deepCollect(child, key, out);
    }
  }
}

/** Resolve parsed segments against a root object. The first segment (the root name) is consumed
 *  by the caller, which passes the root's value here with the remaining segments. */
export function resolveSegments(root: unknown, segs: PathSegment[]): Resolution {
  let cur: unknown[] = [root];
  let plural = false;
  const missing = new Set<string>();
  const keyOf = (o: Record<string, unknown>, key: string, out: unknown[]) => {
    if (key in o) out.push(o[key]);
    else missing.add(key);
  };
  for (const seg of segs) {
    const next: unknown[] = [];
    for (const v of cur) {
      if (v === undefined || v === null) continue;
      switch (seg.kind) {
        case 'key':
          if (Array.isArray(v)) {
            plural = true;
            for (const el of v) if (isObj(el)) keyOf(el, seg.key, next);
          } else if (isObj(v)) {
            keyOf(v, seg.key, next);
          } else {
            missing.add(seg.key); // a scalar has no fields: the path does not fit the value
          }
          break;
        case 'index':
          if (Array.isArray(v) && seg.index < v.length) next.push(v[seg.index]);
          break;
        case 'wild':
          plural = true;
          if (Array.isArray(v)) next.push(...v);
          else if (isObj(v)) next.push(...Object.values(v));
          break;
        case 'deep': {
          plural = true;
          const before = next.length;
          deepCollect(v, seg.key, next);
          const nonEmpty = Array.isArray(v) ? v.length > 0 : isObj(v) && Object.keys(v).length > 0;
          if (next.length === before && nonEmpty) missing.add(`..${seg.key}`);
          break;
        }
        case 'filter': {
          plural = true;
          const arr = Array.isArray(v) ? v : [v];
          for (const el of arr) if (filterMatches(el, seg)) next.push(el);
          break;
        }
      }
    }
    cur = next;
  }
  return { values: cur, plural, missing: [...missing] };
}
