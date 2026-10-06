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

export interface Resolution { values: unknown[]; plural: boolean }

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
  for (const seg of segs) {
    const next: unknown[] = [];
    for (const v of cur) {
      if (v === undefined || v === null) continue;
      switch (seg.kind) {
        case 'key':
          if (Array.isArray(v)) {
            plural = true;
            for (const el of v) if (isObj(el) && seg.key in el) next.push(el[seg.key]);
          } else if (isObj(v) && seg.key in v) {
            next.push(v[seg.key]);
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
        case 'deep':
          plural = true;
          deepCollect(v, seg.key, next);
          break;
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
  return { values: cur, plural };
}

/** Apply prefix aliases (registry naming drift is fixed in ONE map, never in 100 fixtures). */
export function applyAliases(path: string, aliases: Record<string, string> | undefined): string {
  if (!aliases) return path;
  let best = '';
  for (const from of Object.keys(aliases)) if (path.startsWith(from) && from.length > best.length) best = from;
  return best ? aliases[best] + path.slice(best.length) : path;
}
