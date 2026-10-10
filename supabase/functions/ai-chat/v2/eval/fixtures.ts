/**
 * Fixture loading + lint (§9.2).
 *
 * A file under fixtures/ is one of:
 *   - a single fixture object (the §9.2 example shape),
 *   - an array of fixtures,
 *   - a group `{ "group", "defaults": { persona?, source?, package?, turn_input?, tags? }, "fixtures": [...] }`.
 * Files starting with "_" are not fixtures; `_personas.json` holds named TurnInput bases.
 * Merge order: persona.turn_input → group defaults.turn_input → fixture.turn_input (objects merge,
 * arrays and scalars are replaced, an explicit null clears).
 *
 * The lint is the harness's own unit test of the DATA: a typo'd operator, a ref the TurnInput
 * never rendered, or an impossible day would otherwise surface as a model "failure".
 */
import {
  type EvalFixture,
  type Expectation,
  type FixtureTurnInput,
  PACKAGE_IDS,
  type PackageId,
  type PathExpectation,
  RECORD_KINDS,
  RUBRIC_IDS,
  SET_OPERATORS,
  STAGE_ROOTS,
  VALUE_OPERATORS,
} from './types.ts';
import { parsePath, wordTokens } from './path.ts';
import { isAllOf, isAnyOf } from './expect.ts';
import { lintBoundPath } from './bind.ts';

export interface PersonaDef { description?: string; turn_input: FixtureTurnInput }
export interface LintIssue { file: string; fixture: string; message: string }
export interface LoadedFixtures { fixtures: EvalFixture[]; issues: LintIssue[]; files: string[]; personas: Record<string, PersonaDef> }

const isPlainObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function deepMerge<T>(base: T, over: unknown): T {
  if (over === undefined) return structuredClone(base);
  if (!isPlainObj(base) || !isPlainObj(over)) return structuredClone(over) as T;
  const out: Record<string, unknown> = structuredClone(base) as Record<string, unknown>;
  for (const [k, v] of Object.entries(over)) out[k] = k in out ? deepMerge(out[k], v) : structuredClone(v);
  return out as T;
}

/** Expand one parsed file into fixtures (pure; personas resolved here). */
export function expandFixtureDoc(doc: unknown, personas: Record<string, PersonaDef>, file: string): { fixtures: EvalFixture[]; issues: LintIssue[] } {
  const issues: LintIssue[] = [];
  let defaults: Record<string, unknown> = {};
  let raw: unknown[];
  if (Array.isArray(doc)) raw = doc;
  else if (isPlainObj(doc) && Array.isArray(doc.fixtures)) {
    raw = doc.fixtures;
    defaults = isPlainObj(doc.defaults) ? doc.defaults : {};
  } else if (isPlainObj(doc) && typeof doc.id === 'string') raw = [doc];
  else return { fixtures: [], issues: [{ file, fixture: '-', message: 'dosya biçimi tanınmadı (nesne, dizi ya da {defaults, fixtures})' }] };

  const fixtures: EvalFixture[] = [];
  for (const item of raw) {
    if (!isPlainObj(item)) {
      issues.push({ file, fixture: '-', message: 'fixture bir nesne değil' });
      continue;
    }
    const id = typeof item.id === 'string' ? item.id : '?';
    const personaName = (item.persona ?? defaults.persona) as string | undefined;
    let ti: FixtureTurnInput = {};
    if (personaName !== undefined) {
      const p = personas[personaName];
      if (!p) issues.push({ file, fixture: id, message: `bilinmeyen persona "${personaName}"` });
      else ti = deepMerge(ti, p.turn_input);
    }
    ti = deepMerge(ti, defaults.turn_input);
    ti = deepMerge(ti, item.turn_input);
    const tags = [...((defaults.tags as string[] | undefined) ?? []), ...((item.tags as string[] | undefined) ?? [])];
    fixtures.push({
      ...(item as unknown as EvalFixture),
      source: (item.source ?? defaults.source) as string,
      package: (item.package ?? defaults.package) as PackageId,
      pipeline: (item.pipeline ?? defaults.pipeline ?? 'chat') as EvalFixture['pipeline'],
      persona: personaName,
      turn_input: ti,
      tags: tags.length ? [...new Set(tags)] : undefined,
    });
  }
  return { fixtures, issues };
}

// ── lint ───────────────────────────────────────────────────────────────────────────────────────

const ALLOWED_EXPECT_KEYS = new Set<string>([...VALUE_OPERATORS, ...SET_OPERATORS, 'path', 'quantifier', 'why']);
const REF_KEYS = new Set(['ref', 'replaces', 'target', 'draft_ref', 'candidate_refs', 'refs']);

/** m12, d3, c1, p1, k1, dft1, w2, t4 — 1-3 lower-case ASCII letters then digits. */
export function isRefToken(s: string): boolean {
  let i = 0;
  while (i < s.length && s[i] >= 'a' && s[i] <= 'z') i++;
  if (i < 1 || i > 3 || i === s.length) return false;
  for (let j = i; j < s.length; j++) if (s[j] < '0' || s[j] > '9') return false;
  return true;
}

const isIsoDay = (s: unknown): s is string =>
  typeof s === 'string' && s.length === 10 && s[4] === '-' && s[7] === '-' && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

const dayDiff = (a: string, b: string) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

export function renderedRefs(ti: FixtureTurnInput): Set<string> {
  const s = new Set<string>();
  for (const r of ti.records ?? []) s.add(r.ref);
  for (const c of ti.spine ?? []) s.add(c.ref);
  for (const p of ti.pending ?? []) s.add(p.ref);
  for (const k of ti.commitments ?? []) s.add(k.ref);
  if (ti.draft) s.add(ti.draft.ref);
  return s;
}

function lintExpectation(e: Expectation, f: EvalFixture, refs: Set<string>, say: (m: string) => void, depth = 0): void {
  if (depth > 4) return say('any_of/all_of çok derin');
  if (isAnyOf(e) || isAllOf(e)) {
    const kids = isAnyOf(e) ? e.any_of : e.all_of;
    if (!Array.isArray(kids) || kids.length < 2) say('any_of/all_of en az iki çocuk ister');
    else kids.forEach((k) => lintExpectation(k, f, refs, say, depth + 1));
    return;
  }
  const pe = e as PathExpectation & Record<string, unknown>;
  for (const k of Object.keys(pe)) if (!ALLOWED_EXPECT_KEYS.has(k)) say(`bilinmeyen anahtar "${k}" (${pe.path})`);
  if (typeof pe.path !== 'string') return say('path eksik');
  let segs;
  try {
    segs = parsePath(pe.path);
  } catch (err) {
    return say((err as Error).message);
  }
  const root = (segs[0] as { key: string }).key;
  if (!(STAGE_ROOTS as readonly string[]).includes(root)) say(`bilinmeyen kök "${root}" (${pe.path})`);
  const ops = [...VALUE_OPERATORS, ...SET_OPERATORS].filter((k) => pe[k] !== undefined);
  if (ops.length !== 1) return say(`tam olarak bir operatör gerekir, bulunan: ${ops.join(',') || 'yok'} (${pe.path})`);
  const op = ops[0];
  const arg = pe[op];
  const bad = (why: string) => say(`${op} ${why} (${pe.path})`);
  switch (op) {
    case 'between': {
      const ok = Array.isArray(arg) && arg.length === 2 && typeof arg[0] === 'number' && typeof arg[1] === 'number' && arg[0] <= arg[1];
      if (!ok) bad('[alt, üst] sayı çifti olmalı');
      break;
    }
    case 'in': case 'not_in':
      if (!Array.isArray(arg) || arg.length === 0) bad('boş olmayan dizi olmalı');
      break;
    case 'contains_any': case 'not_contains_any':
      if (!Array.isArray(arg) || arg.length === 0 || !arg.every((x) => typeof x === 'string')) bad('metin dizisi olmalı');
      break;
    case 'contains': case 'not_contains':
      if (typeof arg !== 'string' || !arg) bad('boş olmayan metin olmalı');
      break;
    case 'gte': case 'lte': case 'gt': case 'lt':
      if (typeof arg !== 'number') bad('sayı olmalı');
      break;
    case 'count': case 'count_gte': case 'count_lte':
      if (typeof arg !== 'number' || arg < 0 || !Number.isInteger(arg)) bad('negatif olmayan tam sayı olmalı');
      break;
    case 'exists': case 'absent': case 'empty': case 'flag': case 'verbatim_in_message':
      if (typeof arg !== 'boolean') bad('true/false olmalı');
      break;
    case 'contains_word_any': case 'not_contains_word_any':
      if (!Array.isArray(arg) || arg.length === 0 || !arg.every((x) => typeof x === 'string' && x.trim())) bad('boş olmayan metin dizisi olmalı');
      break;
    case 'contains_prefix_any': case 'not_contains_prefix_any': {
      const oneWord = (x: unknown): x is string => typeof x === 'string' && wordTokens(x).length === 1;
      const m = isPlainObj(arg) ? arg : null;
      const prefixes = m && Array.isArray(m.prefixes) && m.prefixes.length > 0 && m.prefixes.every(oneWord) ? m.prefixes as string[] : null;
      if (!m || !prefixes) {
        bad('{ "prefixes": [tek kelimelik metinler], "except"?: [...] } olmalı');
        break;
      }
      for (const k of Object.keys(m)) if (k !== 'prefixes' && k !== 'except') bad(`bilinmeyen alan "${k}"`);
      const except = m.except === undefined ? [] : m.except;
      if (!Array.isArray(except) || !except.every(oneWord)) {
        bad('except tek kelimelik metin dizisi olmalı');
        break;
      }
      // An exception that extends no prefix can never apply: it would only look like a safeguard.
      for (const e of except) {
        const et = wordTokens(e)[0];
        if (!prefixes.some((p) => { const pt = wordTokens(p)[0]; return et.startsWith(pt) && et !== pt; })) bad(`except "${e}" hiçbir önekin uzantısı değil`);
      }
      break;
    }
    case 'eq_path':
      try {
        parsePath(arg as string);
        for (const m of lintBoundPath(arg as string, 'eq_path', undefined)) say(`bağlama: ${m}`);
      } catch (err) {
        bad((err as Error).message);
      }
      break;
  }
  if (pe.quantifier !== undefined && !['any', 'all', 'none'].includes(pe.quantifier)) say(`geçersiz quantifier "${pe.quantifier}"`);
  // The path must fit what the bound pipeline produces (registry schema / validator / receipts).
  for (const m of lintBoundPath(pe.path, op, arg)) say(`bağlama: ${m}`);

  // Refs the expectation names must be refs the TurnInput actually rendered (§5.1/4).
  const last = segs[segs.length - 1];
  const lastKey = last.kind === 'key' || last.kind === 'deep' ? last.key : '';
  if (REF_KEYS.has(lastKey)) {
    const named = (Array.isArray(arg) ? arg : [arg]).filter((x): x is string => typeof x === 'string' && isRefToken(x));
    for (const r of named) if (!refs.has(r)) say(`"${r}" ref'i turn_input'ta yok (${pe.path})`);
  }
  // A logged day must be a day f.day() accepts: not in the future, at most 7 days back (the
  // model's `day` or the validator's resolved `derived.date`).
  const now = f.turn_input.now?.local_date;
  if ((lastKey === 'day' || lastKey === 'date') && now && (op === 'eq' || op === 'in')) {
    for (const d of (Array.isArray(arg) ? arg : [arg]).filter(isIsoDay)) {
      const diff = dayDiff(d, now);
      if (diff > 0 || diff < -7) say(`gün ${d} f.day() aralığı dışında (şimdi ${now})`);
    }
  }
}

export function lintFixture(f: EvalFixture, file = '-'): LintIssue[] {
  const issues: LintIssue[] = [];
  const say = (message: string) => issues.push({ file, fixture: f.id ?? '?', message });
  if (typeof f.id !== 'string' || !f.id) say('id eksik');
  else if (![...f.id].every((c) => (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c === '-')) say('id yalnız a-z, 0-9 ve "-" içermeli');
  if (typeof f.source !== 'string' || !f.source) say('source eksik');
  if (!PACKAGE_IDS.includes(f.package)) say(`geçersiz package "${f.package}"`);
  if (typeof f.title !== 'string' || !f.title.trim()) say('title eksik');
  if (typeof f.message !== 'string' || !f.message.trim()) say('message eksik');
  if (f.pipeline && !['chat', 'report', 'plan'].includes(f.pipeline)) say(`geçersiz pipeline "${f.pipeline}"`);
  if (f.client && !['undo_button', 'plan_approve'].includes(f.client.protocol)) say(`geçersiz client.protocol "${f.client.protocol}"`);
  const ti: FixtureTurnInput = f.turn_input;
  const tiOk = isPlainObj(f.turn_input as unknown);
  if (!tiOk) say('turn_input nesne olmalı');
  else {
    if (!isIsoDay(ti.now?.local_date)) say('turn_input.now.local_date YYYY-MM-DD olmalı');
    if (ti.tier && !['none', 'watch', 'amber', 'red'].includes(ti.tier)) say(`geçersiz tier "${ti.tier}"`);
    for (const h of ti.history ?? []) if (h.role !== 'user' && h.role !== 'assistant') say(`geçersiz history rolü "${h.role}"`);
    if ('tripwires' in (ti as Record<string, unknown>)) say('turn_input.tripwires kaldırıldı: T2 mesajdan scanTripwires() ile hesaplanır (üretimdeki gibi)');
    for (const r of ti.records ?? []) if (!(RECORD_KINDS as readonly string[]).includes(r.kind)) say(`${r.ref}: geçersiz kayıt türü "${r.kind}" (${RECORD_KINDS.join('|')})`);
    for (const c of ti.reference_candidates ?? []) {
      if (typeof c.name_tr !== 'string' || typeof c.kcal_per_100g !== 'number') say(`referans adayı "${c.key}": name_tr ve kcal_per_100g gerekli (validateDecision'ın ReferenceRow'u)`);
    }
    const seen = new Set<string>();
    for (const r of [...(ti.records ?? []), ...(ti.spine ?? []), ...(ti.pending ?? []), ...(ti.commitments ?? [])]) {
      if (!isRefToken(r.ref)) say(`geçersiz ref "${r.ref}"`);
      if (seen.has(r.ref)) say(`ref iki kez kullanılmış "${r.ref}"`);
      seen.add(r.ref);
    }
    for (const r of ti.records ?? []) {
      if (!isIsoDay(r.day)) say(`${r.ref}: day YYYY-MM-DD olmalı`);
      else if (ti.now?.local_date && dayDiff(r.day, ti.now.local_date) > 0) say(`${r.ref}: gelecekte kayıt`);
    }
  }
  if (!Array.isArray(f.expect) || f.expect.length === 0) say('expect boş olamaz');
  else {
    const refs = tiOk ? renderedRefs(ti) : new Set<string>();
    f.expect.forEach((e) => lintExpectation(e, f, refs, say));
  }
  for (const r of f.reply_rubric ?? []) if (!RUBRIC_IDS.includes(r)) say(`bilinmeyen rubrik "${r}"`);
  return issues;
}

export function lintFixtures(list: { fixture: EvalFixture; file: string }[]): LintIssue[] {
  const issues: LintIssue[] = [];
  const ids = new Map<string, string>();
  for (const { fixture, file } of list) {
    issues.push(...lintFixture(fixture, file));
    const prev = ids.get(fixture.id);
    if (prev) issues.push({ file, fixture: fixture.id, message: `id tekrar ediyor (ilk: ${prev})` });
    else ids.set(fixture.id, file);
  }
  return issues;
}

/** Read every *.json under `dir` (non-recursive), personas first. Needs --allow-read. */
export async function loadFixtureDir(dir: string | URL): Promise<LoadedFixtures> {
  const base = typeof dir === 'string' ? dir : dir;
  const names: string[] = [];
  for await (const e of Deno.readDir(base)) if (e.isFile && e.name.endsWith('.json')) names.push(e.name);
  names.sort();
  const join = (n: string) => (typeof base === 'string' ? `${base.endsWith('/') || base.endsWith('\\') ? base : base + '/'}${n}` : new URL(n, base));
  let personas: Record<string, PersonaDef> = {};
  if (names.includes('_personas.json')) personas = JSON.parse(await Deno.readTextFile(join('_personas.json'))) as Record<string, PersonaDef>;
  const all: { fixture: EvalFixture; file: string }[] = [];
  const issues: LintIssue[] = [];
  const files: string[] = [];
  for (const n of names) {
    if (n.startsWith('_')) continue;
    files.push(n);
    let doc: unknown;
    try {
      doc = JSON.parse(await Deno.readTextFile(join(n)));
    } catch (err) {
      issues.push({ file: n, fixture: '-', message: `JSON okunamadı: ${(err as Error).message}` });
      continue;
    }
    const ex = expandFixtureDoc(doc, personas, n);
    issues.push(...ex.issues);
    for (const fx of ex.fixtures) all.push({ fixture: fx, file: n });
  }
  issues.push(...lintFixtures(all));
  return { fixtures: all.map((x) => x.fixture), issues, files, personas };
}
