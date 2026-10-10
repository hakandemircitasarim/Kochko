/**
 * Binding of the eval to the REAL v2 pieces (docs/AI_MIMARI_V2.md §9.1: "toolPort gerçek validator
 * ve derive()'ı çalıştırır, commit'i bellekte simüle eder").
 *
 *   - validationContextFor(): a fixture's TurnInput snapshot → the registry's ValidationContext
 *     (rendered refs, day totals, profile, ED tier, reference rows). The only eval-side mapping.
 *   - postStageA(): validateDecision() verbatim → `validation`; every COMMIT/FLAG verdict's `row`
 *     (args ⊕ derive, the bytes the writer would persist) + the op's declared invariants →
 *     `commit`; the registry's toActionReceipt() with the writer assumed ok → `receipts`.
 *   - lintBoundPath(): fixture paths are checked against the registry's OWN shapes — the strict
 *     understand/reply schemas for `decision`/`reply`, live instances of validateDecision /
 *     toActionReceipt / the sample writes for `validation`/`receipts`/`commit`. A renamed field, an
 *     enum id the registry does not have ("compensatory", "fıstık" as an allergen id) or an op the
 *     schema has no branch for is a LINT error, not a model failure discovered after a paid run.
 *
 * Nothing here re-implements a rule: verdicts, derived numbers and receipt lines all come from
 * shared/write-registry. No regex, no reading of the user's words (the message only reaches the
 * validator's verbatim-quote check, as in production).
 */
import {
  buildReplySchema, buildUnderstandSchema, getOp, type JsonSchema, parseRef, type RenderedRef, type RenderedRefs,
  toActionReceipt, type DecisionValidation, type RefTarget, type ValidationContext, validateDecision, type WriteVerdict,
  type ReferenceRow, type DayTotals,
} from '../../../shared/write-registry/mod.ts';
import { sampleContext, sampleDecision, SAMPLE_MESSAGES, SAMPLE_WRITES } from '../../../shared/write-registry/samples.ts';
import type { EvalFixture, FixtureTurnInput, Json, RecordKind, StageOutputs } from './types.ts';
import { parsePath, type PathSegment } from './path.ts';
import { safetyFieldOf } from './expect.ts';

// ── ValidationContext from a fixture ──────────────────────────────────────────────────────────

const RECORD_TARGET: Readonly<Record<RecordKind, { target: RefTarget; op: string | null }>> = {
  meal: { target: 'meal', op: 'meal_log' },
  water: { target: 'water', op: 'water_log' },
  workout: { target: 'workout', op: 'workout_log' },
  sleep: { target: 'sleep', op: 'sleep_log' },
  weight: { target: 'weight', op: 'body_weight' },
  supplement: { target: 'supplement', op: 'supplement_log' },
  mood: { target: 'mood', op: 'mood_log' },
  steps: { target: 'steps', op: 'step_log' },
  venue: { target: 'other', op: null },
  profile: { target: 'profile', op: 'profile_set' },
  life_event: { target: 'life_event', op: 'life_event' },
  lab: { target: 'lab', op: 'lab_value' },
  food_pref: { target: 'food_pref', op: 'food_pref' },
};

const num = (v: Json | undefined): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: Json | undefined): string | null => (typeof v === 'string' && v ? v : null);

/** `now` as an ISO instant. Deterministic: the fixture's local wall clock read as UTC (holds and
 *  their expiry are generated against the same base, so only the difference matters). */
export function fixtureNowIso(ti: FixtureTurnInput): string {
  const d = ti.now?.local_date ?? '1970-01-01';
  const t = ti.now?.local_time ?? '12:00';
  return `${d}T${t.length === 5 ? t : '12:00'}:00Z`;
}

/** The refs the TurnInput rendered, with the facts the loader would know about each row. */
export function renderedRefsFor(ti: FixtureTurnInput): RenderedRefs {
  const refs: Record<string, RenderedRef> = {};
  const kindOf = (ref: string) => parseRef(ref)?.kind;
  for (const r of ti.records ?? []) {
    const k = kindOf(r.ref);
    if (!k) continue;
    const t = RECORD_TARGET[r.kind] ?? { target: 'other', op: null };
    refs[r.ref] = {
      kind: k, target: t.target, op: t.op, day: r.day, summary_tr: r.line,
      ...(r.last_turn ? { last_turn: true } : {}),
      ...(r.undone ? { undone: true } : {}),
      ...(r.later_write_on_same_field ? { later_write_on_same_field: true } : {}),
      ...(r.suspicion_declined ? { suspicion_declined: true } : {}),
    };
  }
  for (const c of ti.spine ?? []) {
    if (kindOf(c.ref) !== 'c') continue;
    refs[c.ref] = {
      kind: 'c', target: 'constraint', summary_tr: c.display_tr,
      // A retracted (inactive) spine row is already undone: retracting it again is a visible REJECT.
      ...(c.active === false ? { undone: true } : {}),
      constraint: { kind: c.kind, subject: c.subject_id, severity: c.severity ?? null, ...(c.body_parts ? { body_parts: c.body_parts } : {}) },
    };
  }
  const nowMs = Date.parse(fixtureNowIso(ti));
  for (const p of ti.pending ?? []) {
    if (kindOf(p.ref) !== 'p') continue;
    refs[p.ref] = {
      kind: 'p', target: 'pending', summary_tr: p.line,
      pending: { op: p.op, expires_at: p.expires_at ?? new Date(nowMs + 24 * 3_600_000).toISOString(), replies_since: p.replies_since ?? 1 },
    };
  }
  for (const k of ti.commitments ?? []) if (kindOf(k.ref) === 'k') refs[k.ref] = { kind: 'k', target: 'commitment', summary_tr: k.line };
  if (ti.draft && kindOf(ti.draft.ref) === 'dft') refs[ti.draft.ref] = { kind: 'dft', target: 'plan_draft', summary_tr: ti.draft.line };
  return refs;
}

export function validationContextFor(f: Pick<EvalFixture, 'turn_input' | 'message'>): ValidationContext {
  const ti = f.turn_input;
  const today = ti.now?.local_date ?? '1970-01-01';
  const t = ti.today ?? {};
  const totals: DayTotals = {};
  if (num(t.water_liters) !== null) totals.water_liters = num(t.water_liters);
  if (num(t.steps) !== null) totals.steps = num(t.steps);
  if (num(t.sleep_hours) !== null) totals.sleep_hours = num(t.sleep_hours);
  if (num(t.weight_kg) !== null) totals.weight_kg = num(t.weight_kg);
  const p = ti.profile ?? {};
  const reference_rows: Record<string, ReferenceRow> = {};
  for (const c of ti.reference_candidates ?? []) {
    reference_rows[c.key] = {
      key: c.key, name_tr: c.name_tr, kcal_per_100g: c.kcal_per_100g,
      protein_per_100g: c.protein_per_100g ?? null, carbs_per_100g: c.carbs_per_100g ?? null, fat_per_100g: c.fat_per_100g ?? null,
    };
  }
  return {
    today,
    now_iso: fixtureNowIso(ti),
    user_message: f.message,
    refs: renderedRefsFor(ti),
    day_totals: Object.keys(totals).length ? { [today]: totals } : {},
    profile: {
      birth_year: num(p.birth_year), height_cm: num(p.height_cm), weight_kg: num(p.weight_kg),
      gender: str(p.gender), periodic_state: str(p.periodic_state),
    },
    last_weight: ti.last_weight ?? null,
    goal: { goal_type: str(p.goal_type), target_weight_kg: num(p.target_weight_kg) },
    ed_tier: ti.tier ?? 'none',
    reference_rows,
  };
}

// ── after Stage A: validate, simulate the commit, build receipts ───────────────────────────────

/** Receipt fields the simulated commit cannot produce yet (expectations on them are skipped). */
export const UNBOUND_RECEIPT_FIELDS: Readonly<Record<string, string>> = {
  allergen_exposure: 'tüketim denetimi commit katmanında çalışır (allergen_consumption_check); commit katmanı bağlanınca değerlendirilir',
};

export interface CommitRow extends Record<string, unknown> {
  verdict: 'COMMIT' | 'FLAG';
  invariants: readonly string[];
}

/** commit.<op type> = rows the writers would persist this turn (COMMIT and FLAG store the same). */
export function simulateCommit(v: DecisionValidation): Record<string, CommitRow[]> {
  const out: Record<string, CommitRow[]> = {};
  for (const w of v.verdicts) {
    if (w.verdict !== 'COMMIT' && w.verdict !== 'FLAG') continue;
    if (w.noop || !w.row) continue;
    (out[w.op] ??= []).push({ ...w.row, verdict: w.verdict, invariants: getOp(w.op)?.invariants ?? [] });
  }
  return out;
}

/** Receipts as the commit layer would build them with every writer reporting ok (one row each). */
export function simulateReceipts(v: DecisionValidation, ctx: ValidationContext): unknown[] {
  return v.verdicts
    .map((w: WriteVerdict) => toActionReceipt(w, { ok: true, rows_affected: 1 }, { today: ctx.today, refs: ctx.refs }))
    .filter((r): r is NonNullable<typeof r> => r !== null);
}

export interface PostStageA {
  outputs: StageOutputs;
  unbound: { receipts: Readonly<Record<string, string>> };
  validation: DecisionValidation;
}

export function postStageA(fixture: Pick<EvalFixture, 'turn_input' | 'message'>, decision: unknown): PostStageA {
  const ctx = validationContextFor(fixture);
  const validation = validateDecision(decision, ctx);
  return {
    outputs: { validation, commit: simulateCommit(validation), receipts: simulateReceipts(validation, ctx) },
    unbound: { receipts: UNBOUND_RECEIPT_FIELDS },
    validation,
  };
}

// ── the T2 root's shape ───────────────────────────────────────────────────────────────────────

export const T2_KEYS = ['canned', 'category', 'explicit', 'hits', 'facts'] as const;
export const T2_HIT_KEYS = ['hit_id', 'trigger', 'category', 'tier', 'negated'] as const;

// ── lint: fixture paths against the registry's shapes ─────────────────────────────────────────

type S = Record<string, unknown>;
const isObj = (v: unknown): v is S => typeof v === 'object' && v !== null && !Array.isArray(v);

let UNDERSTAND: S | null = null;
let REPLY: S | null = null;
const understandSchema = () => UNDERSTAND ??= buildUnderstandSchema() as S;
const replySchema = () => REPLY ??= buildReplySchema() as S;

function deref(node: S, root: S): S {
  let cur = node;
  for (let i = 0; i < 16 && typeof cur.$ref === 'string'; i++) {
    const parts = (cur.$ref as string).replace('#/', '').split('/');
    let t: unknown = root;
    for (const p of parts) t = isObj(t) ? t[p] : undefined;
    if (!isObj(t)) return cur;
    cur = t;
  }
  return cur;
}

/** Concrete alternatives of a node: $ref followed, anyOf flattened, the bare null branch dropped. */
function alts(node: unknown, root: S): S[] {
  if (!isObj(node)) return [];
  const d = deref(node, root);
  if (Array.isArray(d.anyOf)) return (d.anyOf as unknown[]).flatMap((a) => alts(a, root));
  if (d.type === 'null') return [];
  return [d];
}

const typesOf = (s: S): string[] => (Array.isArray(s.type) ? s.type as string[] : typeof s.type === 'string' ? [s.type] : []);
const isArrayNode = (s: S) => typesOf(s).includes('array');
const isObjectNode = (s: S) => typesOf(s).includes('object') || isObj(s.properties);
const props = (s: S): Record<string, unknown> => (isObj(s.properties) ? s.properties : {});

/** Array → its item alternatives; anything else stays itself (a filter on an object, §path.ts). */
function elements(nodes: S[], root: S): S[] {
  return nodes.flatMap((n) => (isArrayNode(n) ? alts(n.items, root) : [n]));
}

function deepFind(nodes: S[], key: string, root: S): S[] {
  const out: S[] = [];
  const seen = new Set<S>();
  const walk = (n: S) => {
    if (seen.has(n)) return;
    seen.add(n);
    const p = props(n);
    if (key in p) out.push(...alts(p[key], root));
    for (const v of Object.values(p)) for (const a of alts(v, root)) walk(a);
    if (isArrayNode(n)) for (const a of alts(n.items, root)) walk(a);
  };
  for (const n of nodes) walk(n);
  return out;
}

function enumOf(s: S): unknown[] | null {
  return Array.isArray(s.enum) ? s.enum as unknown[] : null;
}

/** Walk a path's segments (after the root) through a JSON schema; issues name the first misfit. */
export function walkSchema(segs: PathSegment[], schema: S): { leaves: S[]; issues: string[] } {
  let cur = alts(schema, schema);
  for (const seg of segs) {
    if (!cur.length) break;
    switch (seg.kind) {
      case 'key': {
        const next = elements(cur, schema).filter(isObjectNode).flatMap((n) => (seg.key in props(n) ? alts(props(n)[seg.key], schema) : []));
        if (!next.length) return { leaves: [], issues: [`"${seg.key}" şemada yok`] };
        cur = next;
        break;
      }
      case 'index':
        cur = cur.filter(isArrayNode).flatMap((n) => alts(n.items, schema));
        if (!cur.length) return { leaves: [], issues: [`[${seg.index}] bir dizi değil`] };
        break;
      case 'wild':
        cur = cur.flatMap((n) => (isArrayNode(n) ? alts(n.items, schema) : Object.values(props(n)).flatMap((v) => alts(v, schema))));
        break;
      case 'deep': {
        const next = deepFind(cur, seg.key, schema);
        if (!next.length) return { leaves: [], issues: [`"..${seg.key}" şemanın hiçbir yerinde yok`] };
        cur = next;
        break;
      }
      case 'filter': {
        const els = elements(cur, schema).filter(isObjectNode);
        const withKey = els.filter((n) => seg.key in props(n));
        if (!withKey.length) return { leaves: [], issues: [`filtre alanı "${seg.key}" şemada yok`] };
        if (seg.op === '=') {
          const kept = withKey.filter((n) => {
            const e = alts(props(n)[seg.key], schema).map(enumOf);
            return e.some((x) => x === null) || e.some((x) => x!.some((v) => (v === null ? 'null' : String(v)) === seg.value));
          });
          if (!kept.length) return { leaves: [], issues: [`[${seg.key}=${seg.value}] şemadaki hiçbir seçenekle eşleşmiyor`] };
          cur = kept;
        } else {
          cur = withKey;
        }
        break;
      }
    }
  }
  return { leaves: cur, issues: [] };
}

const fmtList = (xs: unknown[]) => {
  const v = xs.filter((x) => x !== null).map(String);
  return v.length > 12 ? `${v.slice(0, 12).join('|')}|… (${v.length})` : v.join('|');
};

/** Operator ↔ leaf type: the values a check compares with must be values the field can hold. */
function leafIssues(op: string, arg: unknown, leaves: S[], root: S): string[] {
  if (!leaves.length) return [];
  const out: string[] = [];
  const types = new Set(leaves.flatMap(typesOf));
  const enums = leaves.map(enumOf);
  const allEnum = enums.every((e) => e !== null);
  const enumValues = allEnum ? [...new Set(enums.flatMap((e) => e!))] : [];
  const itemEnums = leaves.filter(isArrayNode).flatMap((n) => alts(n.items, root)).map(enumOf);
  const listEnumValues = itemEnums.length && itemEnums.every((e) => e !== null) ? [...new Set(itemEnums.flatMap((e) => e!))] : null;

  const scalarArgs = op === 'in' || op === 'not_in' ? (Array.isArray(arg) ? arg : []) : op === 'eq' || op === 'ne' ? [arg] : [];
  for (const v of scalarArgs) {
    if (typeof v === 'string' && allEnum && !enumValues.includes(v)) out.push(`"${v}" bu alanın değeri olamaz (registry: ${fmtList(enumValues)})`);
    if (typeof v === 'number' && !types.has('number') && !types.has('integer') && types.size) out.push(`${v} sayı, alan ${[...types].join('|')}`);
    if (typeof v === 'string' && !allEnum && types.size && !types.has('string')) out.push(`"${v}" metin, alan ${[...types].join('|')}`);
  }
  if (['contains_any', 'not_contains_any', 'contains_word_any', 'not_contains_word_any', 'contains', 'not_contains'].includes(op) && listEnumValues) {
    const needles = (Array.isArray(arg) ? arg : [arg]).filter((x): x is string => typeof x === 'string');
    for (const n of needles) if (!listEnumValues.includes(n)) out.push(`"${n}" registry id'si değil (liste: ${fmtList(listEnumValues)})`);
  }
  if (['between', 'gte', 'lte', 'gt', 'lt'].includes(op) && !types.has('number') && !types.has('integer')) out.push(`${op} sayı alanı ister, alan ${[...types].join('|') || '?'}`);
  if (op === 'verbatim_in_message' && !types.has('string')) out.push('verbatim_in_message metin alanı ister');
  if (op === 'flag') {
    const ok = leaves.every((s) => typesOf(s).includes('boolean') || 'category' in props(s) || 'benign' in props(s));
    if (!ok) out.push('flag yalnız registry safety alanlarına (acute_medical, self_harm, ed_signal, tripwire_reading) uygulanır');
    if (typeof arg !== 'boolean') out.push('flag true ya da false ister');
  }
  return out;
}

// Instance shapes for the roots that have no JSON schema: taken from the real functions' output.
let INSTANCES: { validation: S; verdict: S; verdictValues: string[]; receipt: S; commitKeys: Record<string, Set<string>> } | null = null;
function instances() {
  if (INSTANCES) return INSTANCES;
  const msg = Object.values(SAMPLE_MESSAGES).join(' ');
  const commitKeys: Record<string, Set<string>> = {};
  for (const [type, w] of Object.entries(SAMPLE_WRITES)) {
    const reg = getOp(type);
    if (!reg) continue;
    const v = validateDecision(sampleDecision({ [reg.channel]: [w] }), sampleContext({ user_message: msg }));
    const keys = new Set<string>([...Object.keys(reg.fields), 'verdict', 'invariants']);
    for (const vd of v.verdicts) for (const k of Object.keys(vd.row ?? {})) keys.add(k);
    commitKeys[type] = keys;
  }
  const v = validateDecision(sampleDecision({ writes: [SAMPLE_WRITES.water_log] }), sampleContext());
  const verdict = (v.verdicts[0] ?? {}) as unknown as S;
  const receipt = (toActionReceipt(v.verdicts[0], { ok: true, rows_affected: 1 }) ?? {}) as unknown as S;
  INSTANCES = { validation: v as unknown as S, verdict, verdictValues: Object.keys(v.counts), receipt, commitKeys };
  return INSTANCES;
}

function keyChain(segs: PathSegment[]): string[] {
  return segs.filter((s) => s.kind === 'key' || s.kind === 'filter' || s.kind === 'deep').map((s) => (s as { key: string }).key);
}

/**
 * Lint one expectation's path (and value) against the shape of the root it reads. Returns
 * Turkish issues; [] = the path is one the bound pipeline can produce.
 */
export function lintBoundPath(path: string, op: string, arg: unknown): string[] {
  let segs: PathSegment[];
  try {
    segs = parsePath(path);
  } catch {
    return []; // the generic lint reports parse errors
  }
  const root = (segs[0] as { key: string }).key;
  const rest = segs.slice(1);
  const tag = (xs: string[]) => xs.map((x) => `${x} (${path})`);
  // `flag` reads one registry safety field by its declaration (expect.ts) — on any root.
  if (op === 'flag' && safetyFieldOf(path) === null) {
    return tag(['flag yalnız registry safety alanlarına (acute_medical, self_harm, ed_signal, tripwire_reading) uygulanır']);
  }
  if (root === 'decision' || root === 'reply') {
    const schema = root === 'decision' ? understandSchema() : replySchema();
    const w = walkSchema(rest, schema);
    if (w.issues.length) return tag(w.issues);
    return tag(leafIssues(op, arg, w.leaves, schema));
  }
  if (root === 'validation') {
    const inst = instances();
    const first = rest[0];
    if (first && first.kind === 'key' && !(first.key in inst.validation)) return tag([`"${first.key}" validateDecision çıktısında yok (${Object.keys(inst.validation).join('|')})`]);
    if (first?.kind === 'key' && first.key === 'verdicts') {
      // Filters and the first field after `verdicts` are WriteVerdict fields; below that (derived,
      // row, args, issues…) the shape is the op's own and is checked at run time.
      for (const s of rest.slice(1)) {
        if (s.kind === 'filter' && !(s.key in inst.verdict)) return tag([`"${s.key}" bir WriteVerdict alanı değil`]);
        if (s.kind === 'key' || s.kind === 'deep') {
          if (s.kind === 'key' && !(s.key in inst.verdict)) return tag([`"${s.key}" bir WriteVerdict alanı değil (${Object.keys(inst.verdict).join('|')})`]);
          break;
        }
      }
      const last = rest[rest.length - 1];
      if (last.kind === 'key' && last.key === 'verdict') {
        const vals = (op === 'in' || op === 'not_in') && Array.isArray(arg) ? arg : op === 'eq' || op === 'ne' ? [arg] : [];
        const bad = vals.filter((v) => typeof v !== 'string' || !inst.verdictValues.includes(v));
        if (bad.length) return tag([`verdict ${bad.map(String).join(',')} geçersiz (${inst.verdictValues.join('|')})`]);
      }
      for (const s of rest) {
        if (s.kind === 'filter' && s.key === 'op' && s.op === '=' && !getOp(s.value)) return tag([`[op=${s.value}] bir registry op tipi değil`]);
      }
    }
    return [];
  }
  if (root === 'commit') {
    const first = rest[0];
    if (!first || first.kind !== 'key') return tag(['commit.<op tipi> ile başlamalı']);
    const keys = instances().commitKeys[first.key];
    if (!keys) return tag([`"${first.key}" bir registry op tipi değil`]);
    const second = rest[1];
    if (second && (second.kind === 'key' || second.kind === 'filter') && !keys.has(second.key)) return tag([`"${second.key}" ${first.key} satırında yok (${[...keys].join('|')})`]);
    return [];
  }
  if (root === 'receipts') {
    const inst = instances().receipt;
    for (const k of keyChain(rest)) if (!(k in inst) && !(k in UNBOUND_RECEIPT_FIELDS)) return tag([`"${k}" bir makbuz alanı değil`]);
    return [];
  }
  if (root === 't2') {
    const ks = keyChain(rest);
    if (ks[0] && !(T2_KEYS as readonly string[]).includes(ks[0])) return tag([`"${ks[0]}" T2 çıktısında yok (${T2_KEYS.join('|')})`]);
    if (ks[0] === 'hits' && ks[1] && !(T2_HIT_KEYS as readonly string[]).includes(ks[1])) return tag([`"${ks[1]}" bir T2 hit alanı değil`]);
    return [];
  }
  return [];
}

/** Re-exported for the tests: the schema the lint walks for `decision`. */
export function understandSchemaForLint(): JsonSchema {
  return understandSchema();
}
