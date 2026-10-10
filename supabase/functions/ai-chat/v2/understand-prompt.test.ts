/**
 * Stage A's few-shots are the decisions the model will imitate, so each one is bound to the REAL
 * registry (shared/write-registry), not to a hand-typed idea of it:
 *   1. completed with the registry's own field specs, it is valid against the generated strict
 *      understand schema (the shape the provider will decode — a typo'd field or an enum the
 *      schema lacks fails here, not in production);
 *   2. run through validateDecision with a fixture context (exactly the refs its context lines
 *      show), it gets the verdict the example teaches (COMMIT / FLAG / ASK, plan, ED reading);
 *   3. its context lines use the block labels the ONE renderer (stage-a-request.ts) really emits,
 *      and a tripwire line — and every reading's hit_id — is what shared/safety-tripwires.ts renders
 *      for that very message.
 * Plus the §9.4 A/A' production failures each example was chosen for, and the Stage A budget
 * measured with the one shared token estimate.
 */
import { assert, assertEquals, assertThrows } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { asciiTurkishHits, devLeakHits, diacriticRatio, pileWords, shoutedWords } from '../../shared/prompt-lint.ts';
import {
  BLOCK_TITLES, buildUnderstandSchema, buildWriteDoc, NOT_WRITTEN_REASONS, parseRef, type RenderedRef, schemaBytes, SCHEMA_VERSION,
  type ValidationContext, validateDecision, vocab,
} from '../../shared/write-registry/mod.ts';
import type { DayTotals, ReferenceRow } from '../../shared/write-registry/dsl.ts';
import { validateJsonSchema } from '../../shared/json-schema-check.ts';
import { liveAmbiguousHits, renderTripwireFacts, scanTripwires } from '../../shared/safety-tripwires.ts';
import { renderTurnInputBlock } from './stage-a-request.ts';
import { loadTurnInput, renderTurnInput } from './input.ts';
import { fakeTurnInputDb, NOW, seedTables, USER } from './testing.ts';
import { estimateTokens, PROMPT_BUDGETS } from './prompt-size.ts';
import {
  buildUnderstandPrefix,
  completeDecision,
  FEW_SHOT_CONTEXT_LABELS,
  type FewShotDecision,
  type FewShotItem,
  renderFewShots,
  UNDERSTAND_CACHE_KEY,
  UNDERSTAND_DECISION_KEYS,
  UNDERSTAND_FEW_SHOTS,
  UNDERSTAND_PROMPT_VERSION,
  UNDERSTAND_RULES,
  type UnderstandFewShot,
} from './understand-prompt.ts';

const shot = (id: string): UnderstandFewShot => {
  const s = UNDERSTAND_FEW_SHOTS.find((x) => x.id === id);
  assert(s, `missing few-shot: ${id}`);
  return s;
};
const itemsOf = (d: FewShotDecision, ch: 'writes' | 'record_ops' | 'pending_ops' | 'commitment_ops', op?: string): FewShotItem[] =>
  (d[ch] ?? []).filter((w) => !op || w.op === op);
type Item = { name: string; as_stated?: string; grams?: number; kcal: number; reference_key?: string | null };
const mealItems = (w: FewShotItem): Item[] => (w.items as Item[] | undefined) ?? [];
const patchOf = (r: FewShotItem): FewShotItem | null => (r.patch as FewShotItem | undefined) ?? null;
const lc = (s: string) => s.toLocaleLowerCase('tr');
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// ─── fixtures: what each example's context means to the validator ────────────────────────────────

const TODAY = '2026-10-06';
const TRIPWIRE_LABEL = 'GÜVENLİK TETİKLERİ';

interface Expected {
  /** `${registry op}:${verdict}`, in decision order. */
  verdicts: string[];
  /** Issue codes on the verdicts (all of them, sorted) — a FLAG/ASK must be for the taught reason only. */
  issues?: string[];
  plan?: string;
  ed?: { accepted: boolean; escalate: string | null };
  missed_write?: boolean;
  /** The reason a reported fact was consciously not written (then it is NOT a missed write). */
  not_written_reason?: string;
}

interface Fixture {
  refs?: Record<string, RenderedRef>;
  water?: number;
  reference_rows?: Record<string, ReferenceRow>;
  expect: Expected;
}

const meal = (day: string, extra: Partial<RenderedRef> = {}): RenderedRef => ({ kind: 'm', target: 'meal', op: 'meal_log', day, ...extra });
const water = (extra: Partial<RenderedRef> = {}): RenderedRef => ({ kind: 'd', target: 'water', op: 'water_log', day: TODAY, last_turn: true, ...extra });

/** One fixture per few-shot (a new example without one fails the suite). */
const FIXTURES: Record<string, Fixture> = {
  su_ekle: { water: 1.4, expect: { verdicts: ['meal_log:COMMIT', 'water_log:COMMIT'] } },
  nugget: {
    reference_rows: {
      tavuk_gogsu: { key: 'tavuk_gogsu', name_tr: 'tavuk göğsü (ızgara)', kcal_per_100g: 165, protein_per_100g: 31, carbs_per_100g: 0, fat_per_100g: 3.6 },
    },
    expect: { verdicts: ['meal_log:COMMIT'] },
  },
  cimdik_tuz: { expect: { verdicts: ['meal_log:COMMIT'] } },
  su_gun_toplami: { water: 1.6, expect: { verdicts: ['water_log:COMMIT'] } },
  su_geri_al: { refs: { m30: meal('2026-10-04'), d3: water() }, water: 3.4, expect: { verdicts: ['record_delete:COMMIT'] } },
  su_duzeltme: { refs: { d3: water() }, water: 1.6, expect: { verdicts: ['record_update:COMMIT'] } },
  duzeltme_sorusu: { refs: { m14: meal(TODAY, { last_turn: true }) }, expect: { verdicts: [] } },
  iki_aday_sil: { refs: { m14: meal(TODAY, { last_turn: true }), d3: water() }, water: 1.0, expect: { verdicts: [] } },
  supheli_kayit: { refs: { m12: meal('2026-10-01') }, expect: { verdicts: ['record_update:ASK'], issues: ['supheli_kayit'] } },
  supheli_kayit_onayi: {
    refs: { p1: { kind: 'p', target: 'pending', pending: { op: 'record_update', expires_at: '2026-10-08T00:00:00Z', replies_since: 1 } } },
    expect: { verdicts: ['pending_confirm:COMMIT'] },
  },
  plan_istegi: { expect: { verdicts: [], plan: 'generate:COMMIT' } },
  taslak_onayi: { refs: { dft1: { kind: 'dft', target: 'plan_draft' } }, expect: { verdicts: [], plan: 'approve:COMMIT' } },
  alerji_beyani: { expect: { verdicts: ['constraint_add:COMMIT', 'constraint_add:COMMIT'] } },
  baskasinin_alerjisi: { expect: { verdicts: ['constraint_add:COMMIT'] } },
  // A self injury of unknown severity is stored AND flagged (counts as severe, coach asks once).
  sakatlik: { expect: { verdicts: ['constraint_add:FLAG'], issues: ['siddet_bilinmiyor'] } },
  tetik_mecaz: { expect: { verdicts: [] } },
  // Reported but consciously not written, WITH a reason: a decision, not a miss (§5.1.10) — an
  // emergency or an illness turn must never end in a "you told me something, shall I log it?" question.
  tetik_gercek: { expect: { verdicts: [], missed_write: false, not_written_reason: 'emergency_turn' } },
  kusma_hastalik: {
    expect: { verdicts: [], ed: { accepted: true, escalate: null }, missed_write: false, not_written_reason: 'illness_not_food' },
  },
  soru_kayit_degil: { expect: { verdicts: [] } },
  bildirim_ve_soru: { expect: { verdicts: ['meal_log:COMMIT'] } },
};

function ctxFor(s: UnderstandFewShot): ValidationContext {
  const f = FIXTURES[s.id];
  const day_totals: Record<string, DayTotals> = f.water === undefined ? {} : { [TODAY]: { water_liters: f.water } };
  return {
    today: TODAY,
    now_iso: `${TODAY}T12:00:00Z`,
    user_message: s.message,
    refs: f.refs ?? {},
    day_totals,
    profile: null,
    last_weight: null,
    goal: null,
    ed_tier: 'none',
    reference_rows: f.reference_rows ?? {},
  };
}

/** Ref tokens a context line shows (our own example text, never user input). */
function shownRefs(s: UnderstandFewShot): string[] {
  const out = new Set<string>();
  for (const line of s.context) for (const tok of line.split(/[^\p{L}\p{N}]+/u)) if (parseRef(tok)) out.add(tok);
  return [...out].sort();
}

/** Every ref a decision points at — each must have been SHOWN to the model (refInRenderedSet, §4.4). */
function refsUsed(d: FewShotDecision): string[] {
  const refs: string[] = [];
  for (const w of d.writes ?? []) if (typeof w.replaces === 'string') refs.push(w.replaces);
  for (const ch of ['record_ops', 'pending_ops', 'commitment_ops'] as const) for (const r of d[ch] ?? []) if (typeof r.ref === 'string') refs.push(r.ref);
  for (const c of d.clarify?.candidate_refs ?? []) if (typeof c === 'string') refs.push(c);
  if (typeof d.plan_action?.draft_ref === 'string') refs.push(d.plan_action.draft_ref);
  return refs;
}

// ─── budget ──────────────────────────────────────────────────────────────────────────────────────

Deno.test('Stage A budget: rules, few-shots and the whole cached prefix (rules + registry doc + few-shots + schema) — one estimator', () => {
  const r = estimateTokens(UNDERSTAND_RULES);
  const [rf, rc] = PROMPT_BUDGETS.understandRules;
  assert(r >= rf && r <= rc, `rules ~${r} tokens, budget [${rf}, ${rc}]`);
  const f = estimateTokens(renderFewShots());
  const [ff, fc] = PROMPT_BUDGETS.understandFewShots;
  assert(f >= ff && f <= fc, `few-shots ~${f} tokens, budget [${ff}, ${fc}]`);

  const prefix = buildUnderstandPrefix({ registryDoc: buildWriteDoc() });
  const schema = schemaBytes(buildUnderstandSchema());
  const total = estimateTokens(prefix) + estimateTokens(schema);
  const [pf, pc] = PROMPT_BUDGETS.stageAPrefix;
  const report = `kurallar ≈${r} · örnekler ≈${f} · önek ${prefix.length} kr ≈${estimateTokens(prefix)} · şema ≈${estimateTokens(schema)} · toplam ≈${total} tok`;
  console.log(`[Stage A önbellekli önek] ${report}`);
  assert(total >= pf && total <= pc, `Stage A prefix ~${total} tokens, budget [${pf}, ${pc}] — ${report}`);
});

// ─── rules ───────────────────────────────────────────────────────────────────────────────────────

Deno.test('understand rules: calm Turkish with diacritics, no shouting, no piles, no dev residue', () => {
  // JSON and the date format are technical names, not emphasis.
  assertEquals(shoutedWords(UNDERSTAND_RULES, ['JSON', 'YYYY-MM-DD']), []);
  assertEquals(pileWords(UNDERSTAND_RULES), []);
  assertEquals(asciiTurkishHits(UNDERSTAND_RULES), []);
  assertEquals(devLeakHits(UNDERSTAND_RULES), []);
  assert(diacriticRatio(UNDERSTAND_RULES) >= 0.05);
  for (const concept of ['as_stated', 'replaces', 'clarify', 'evidence_quote', 'tripwire_readings', 'hit_id', 'reference_key', 'self_check', 'not_written_reason', 'basis suspicious', 'basis user_correction', 'pending_ops confirm', 'draft_ref', 'illness_vomiting']) {
    assert(UNDERSTAND_RULES.includes(concept), `rules never explain ${concept}`);
  }
});

Deno.test('understand rules agree with the registry: corrections by ref, suspicious records proposed (never fixed silently)', () => {
  // wave-2a: rule 6 used to say "do not correct a suspicious old record yourself" while the registry
  // documents record_update{basis:suspicious} → hold. One story now: propose it, code holds, coach asks.
  assert(UNDERSTAND_RULES.includes("update'i basis suspicious ile öner"));
  assert(!UNDERSTAND_RULES.includes('koç sorar, kişi onaylarsa o turda düzeltirsin'), 'the old same-turn fix rule is gone');
  const doc = buildWriteDoc();
  assert(doc.includes('basis=suspicious') && doc.includes('suspicious bekletilir'), 'the doc describes the same path');
  // ONE correction path, taught by both: record_ops update. `replaces` is never taught as a way to
  // correct (it stays null; the validator still checks it if a model sends it).
  assert(doc.includes('Kayıt düzeltmenin tek yolu record_ops update; yazmalardaki replaces hep null.'), 'the doc teaches update as THE path');
  assert(!doc.includes('replaces: KAYITLAR'), 'the v3 doc line that taught replaces as a correction is gone');
  assert(UNDERSTAND_RULES.includes('Düzeltmenin tek yolu budur: yazmalardaki replaces hep null kalır'));
  for (const s of UNDERSTAND_FEW_SHOTS) {
    for (const w of s.decision.writes ?? []) assert(w.replaces === undefined || w.replaces === null, `${s.id}: a few-shot teaches replaces`);
  }
  // The elision the rules promise is exactly the one completeDecision() reverses.
  assert(UNDERSTAND_RULES.includes('boş liste, null, false ya da 0 olan alanlar, plan_action none ve varsayılan rota (coach, low)'));
});

// ─── shape: bound to the generated schema ────────────────────────────────────────────────────────

Deno.test('few-shots: well-formed — unique ids, a fixture each, decision keys from the schema, labelled context', () => {
  const ids = UNDERSTAND_FEW_SHOTS.map((s) => s.id);
  assertEquals(new Set(ids).size, ids.length);
  // 20 since the first live eval (2026-10-10: iki_aday_sil, bildirim_ve_soru); the token budget is the real cap.
  assert(UNDERSTAND_FEW_SHOTS.length >= 10 && UNDERSTAND_FEW_SHOTS.length <= 20, '§8.3 list + the review and live-eval additions; the token budget is the real cap');
  assertEquals(Object.keys(FIXTURES).sort(), [...ids].sort(), 'every few-shot has exactly one validation fixture');
  for (const s of UNDERSTAND_FEW_SHOTS) {
    assert(s.message.trim() && s.why.trim(), `${s.id}: empty message/why`);
    assert(s.decision.intent?.primary, `${s.id}: intent first`);
    for (const k of Object.keys(s.decision)) {
      assert((UNDERSTAND_DECISION_KEYS as readonly string[]).includes(k), `${s.id}: unknown decision key ${k}`);
    }
    for (const line of s.context) {
      assert(FEW_SHOT_CONTEXT_LABELS.some((l) => line.startsWith(`${l}: `)), `${s.id}: unlabelled context line "${line}"`);
    }
  }
});

Deno.test('UNDERSTAND_DECISION_KEYS is the generated schema\'s top-level order, and completion follows it', () => {
  const schemaKeys = Object.keys(buildUnderstandSchema().properties as object);
  assertEquals([...UNDERSTAND_DECISION_KEYS], schemaKeys);
  for (const s of UNDERSTAND_FEW_SHOTS) assertEquals(Object.keys(completeDecision(s.decision)), schemaKeys, s.id);
});

Deno.test('every few-shot, completed from the registry, is valid against the generated strict understand schema', () => {
  const schema = buildUnderstandSchema();
  for (const s of UNDERSTAND_FEW_SHOTS) {
    assertEquals(validateJsonSchema(schema, completeDecision(s.decision), { maxIssues: 20 }), [], `${s.id}: not decodable under strict mode`);
  }
});

Deno.test('the schema check is a real gate: typos, foreign ids and missing required fields are caught', () => {
  const schema = buildUnderstandSchema();
  const bad = (d: FewShotDecision) => validateJsonSchema(schema, completeDecision(d), { maxIssues: 5 });
  // A field the op does not have (the v1 "liters" shape) survives completion and fails the schema.
  assert(bad({ intent: { primary: 'report' }, writes: [{ op: 'water_log', day: 'today', as_stated: '1 bardak', quantity: 1, unit: 'bardak', mode: 'add', liters: 1 }] }).length > 0);
  // Enum values the registry lacks (the pre-binding plan few-shot used intent 'request').
  assert(bad({ intent: { primary: 'request' as never } }).length > 0, "'request' is not an intent");
  assert(bad({ intent: { primary: 'report' }, writes: [{ op: 'water_log', day: 'today', as_stated: 'x', quantity: 1, unit: 'litres', mode: 'add' }] }).length > 0);
  // A required field with no empty value cannot be left out: completion refuses, loudly.
  assertThrows(() => completeDecision({ intent: { primary: 'report' }, writes: [{ op: 'water_log', day: 'today', as_stated: '1 bardak', quantity: 1, mode: 'add' }] }), Error, 'writes[0].unit');
  assertThrows(() => completeDecision({ intent: { primary: 'question' }, record_ops: [{ op: 'update', ref: 'm1', basis: 'suspicious', reason: 'x' }] }), Error, 'record_ops[0].patch');
});

Deno.test('schema-valid is not enough: the pre-binding allergen id passes the schema and is rejected by the validator', () => {
  // wave-1/2a: the few-shot taught subject_id 'tree_nut:hazelnut' (free text, so strict decoding
  // accepts it) while constraint_add only takes ALLERGENS ids — a repairable REJECT on every such
  // turn. This is why every few-shot also runs through validateDecision.
  const s = shot('alerji_beyani');
  const wrong: FewShotDecision = {
    ...s.decision,
    writes: (s.decision.writes ?? []).map((w) => (w.subject_id === 'hazelnut' ? { ...w, subject_id: 'tree_nut:hazelnut' } : w)),
  };
  assertEquals(validateJsonSchema(buildUnderstandSchema(), completeDecision(wrong)), []);
  const v = validateDecision(completeDecision(wrong), ctxFor(s));
  assertEquals(v.verdicts.map((x) => x.verdict), ['COMMIT', 'REJECT']);
  assertEquals(v.verdicts[1].issues.map((i) => i.code), ['alerjen_kimligi']);
  assertEquals(v.repair.needed, true, 'it would cost a repair call on every allergy declaration');
});

const STATED_DEFAULTS: Record<string, unknown> = { 'plan_action.op': 'none', 'reply_route.contract': 'coach', 'reply_route.effort_hint': 'low' };

/** Is `v` what the rules say an omitted field means (empty value, or a stated default at `path`)? */
function isElided(v: unknown, path: string): boolean {
  if (v === null || v === false || v === 0) return true;
  if (Array.isArray(v)) return v.length === 0;
  if (isObj(v)) return Object.entries(v).every(([k, x]) => isElided(x, `${path}.${k}`));
  return STATED_DEFAULTS[path] === v;
}

function addedByCompletion(sparse: unknown, full: unknown, path: string, out: Array<[string, unknown]>): void {
  if (Array.isArray(full)) {
    full.forEach((x, i) => addedByCompletion(Array.isArray(sparse) ? sparse[i] : undefined, x, `${path}[${i}]`, out));
    return;
  }
  if (!isObj(full)) return;
  for (const [k, v] of Object.entries(full)) {
    const p = path ? `${path}.${k}` : k;
    if (!isObj(sparse) || !(k in sparse)) out.push([p, v]);
    else addedByCompletion(sparse[k], v, p, out);
  }
}

Deno.test('completion only adds what the rules say is elided (empty list / null / false / 0, plan none, route coach-low)', () => {
  for (const s of UNDERSTAND_FEW_SHOTS) {
    const added: Array<[string, unknown]> = [];
    addedByCompletion(s.decision, completeDecision(s.decision), '', added);
    for (const [path, v] of added) {
      const top = path.replace(/\[\d+\]/g, '');
      assert(isElided(v, top), `${s.id}: ${path} = ${JSON.stringify(v)} is not an elided value — write it out`);
    }
  }
});

// ─── semantics: bound to validateDecision ────────────────────────────────────────────────────────

Deno.test('every few-shot gets the verdict it teaches from validateDecision (fixture ctx = exactly the refs shown)', () => {
  for (const s of UNDERSTAND_FEW_SHOTS) {
    const f = FIXTURES[s.id];
    assertEquals(Object.keys(f.refs ?? {}).sort(), shownRefs(s), `${s.id}: fixture refs must be exactly the refs its context shows`);
    const v = validateDecision(completeDecision(s.decision), ctxFor(s));
    const issues = v.verdicts.flatMap((x) => x.issues);
    assertEquals(v.verdicts.map((x) => `${x.op}:${x.verdict}`), f.expect.verdicts, `${s.id}: ${JSON.stringify(issues)}`);
    assertEquals(issues.map((i) => i.code).sort(), [...(f.expect.issues ?? [])].sort(), `${s.id}: unexpected issues ${JSON.stringify(issues)}`);
    assertEquals(v.decision_issues, [], `${s.id}: envelope issues`);
    assertEquals(v.repair.needed, false, `${s.id}: a teaching example never needs a repair call`);
    assert(v.plan, `${s.id}: plan_action is always present after completion`);
    assertEquals(`${v.plan.op}:${v.plan.verdict}`, f.expect.plan ?? 'none:COMMIT', `${s.id}: plan ${JSON.stringify(v.plan.issues)}`);
    if (f.expect.ed) {
      assert(v.safety.ed_signal, `${s.id}: ED reading expected`);
      assertEquals([v.safety.ed_signal.accepted, v.safety.ed_signal.escalate], [f.expect.ed.accepted, f.expect.ed.escalate]);
    } else {
      assertEquals(v.safety.ed_signal, null, `${s.id}: no ED reading`);
    }
    assertEquals(v.missed_write, f.expect.missed_write ?? false, `${s.id}: missed_write`);
    assertEquals(v.not_written_reason, f.expect.not_written_reason ?? null, `${s.id}: not_written_reason`);
  }
});

Deno.test('few-shots obey the validator: refs only from the shown set', () => {
  for (const s of UNDERSTAND_FEW_SHOTS) {
    const shown = shownRefs(s);
    for (const ref of refsUsed(s.decision)) assert(shown.includes(ref), `${s.id}: ref ${ref} was never shown`);
  }
});

Deno.test('few-shots obey the validator: quotes, as_stated and raw are the user\'s words (or the shown record\'s, for a suspicion)', () => {
  for (const s of UNDERSTAND_FEW_SHOTS) {
    const msg = lc(s.message);
    const shown = lc(s.context.join('\n'));
    const quotes: string[] = [];
    const stated: Array<[string, string]> = [];
    for (const w of s.decision.writes ?? []) {
      if (typeof w.evidence_quote === 'string') quotes.push(w.evidence_quote);
      if (typeof w.as_stated === 'string') stated.push([w.as_stated, msg]);
      if (typeof w.raw === 'string') stated.push([w.raw, msg]);
      for (const it of mealItems(w)) if (it.as_stated) stated.push([it.as_stated, msg]);
    }
    for (const r of s.decision.record_ops ?? []) {
      if (typeof r.evidence_quote === 'string') quotes.push(r.evidence_quote);
      const p = patchOf(r);
      if (!p) continue;
      // A user correction carries the user's words; a suspicion re-states the record the model was shown.
      const source = r.basis === 'suspicious' ? shown : msg;
      if (typeof p.as_stated === 'string') stated.push([p.as_stated, source]);
      if (typeof p.raw === 'string') stated.push([p.raw, source]);
      for (const it of mealItems(p)) if (it.as_stated) stated.push([it.as_stated, source]);
    }
    if (s.decision.safety?.ed_signal?.evidence_quote) quotes.push(s.decision.safety.ed_signal.evidence_quote);
    for (const q of quotes) assert(msg.includes(lc(q)), `${s.id}: evidence_quote "${q}" is not in the message`);
    for (const [a, src] of stated) assert(src.includes(lc(a)), `${s.id}: "${a}" is not verbatim from its source`);
  }
});

Deno.test('few-shots: self_check is honest — reported ⇔ a user-stated fact was written or its non-write is explained (§5.1 #10)', () => {
  for (const s of UNDERSTAND_FEW_SHOTS) {
    const d = s.decision;
    const userFacts = (d.writes?.length ?? 0) > 0 || (d.record_ops ?? []).some((r) => r.op === 'update' && r.basis === 'user_correction');
    const given = d.self_check?.not_written_reason;
    if (given !== undefined && given !== null) assert(Object.prototype.hasOwnProperty.call(NOT_WRITTEN_REASONS, given), `${s.id}: "${given}" is not a declared reason id`);
    const reason = typeof given === 'string' && given.length > 0;
    const reported = d.self_check?.reported_new_facts === true;
    assertEquals(reported, userFacts || reason, `${s.id}: reported_new_facts must mean "the user told a new fact" (undo, approval and a model-noticed suspicion are not)`);
    if (reason) assert(!userFacts, `${s.id}: a not_written_reason on a turn that wrote the fact`);
  }
});

Deno.test('few-shots: water quantities use the unit enum — a glass is a glass, code converts', () => {
  for (const s of UNDERSTAND_FEW_SHOTS) {
    const waters = [...itemsOf(s.decision, 'writes', 'water_log'), ...itemsOf(s.decision, 'record_ops').map(patchOf).filter((p): p is FewShotItem => p?.op === 'water_log')];
    for (const w of waters) if (/bardak/u.test(String(w.as_stated))) assertEquals(w.unit, 'bardak', `${s.id}: a glass is a glass`);
  }
});

// ─── context: bound to the renderers ─────────────────────────────────────────────────────────────

Deno.test('few-shot context labels are the block titles the ONE renderer really emits (stage-a-request.ts, shadow and eval alike)', async () => {
  const labels = FEW_SHOT_CONTEXT_LABELS as readonly string[];
  for (const t of Object.values(BLOCK_TITLES)) assert(labels.includes(t), `registry block ${t} has no few-shot label`);
  const block = renderTurnInputBlock({
    now: { today: TODAY, local_date: TODAY, local_time: '12:00', tz: 'Europe/Istanbul' },
    ed_tier: 'none',
    profile: [],
    gates: [],
    today: ['su 1,40 L'],
    records: [{ ref: 'd3', line: 'bugün su: gün toplamı 1,40 L', last_turn: true }],
    constraints: [{ ref: 'c1', line: 'alerji · yer fıstığı · ciddi' }],
    pending: [{ ref: 'p1', line: 'record_update · düzeltme' }],
    commitments: [{ ref: 'k1', line: '"akşam 8’den sonra yememe"' }],
    drafts: [{ ref: 'dft1', line: 'beslenme taslağı v2 · haftalık plan' }],
    active_plans: [],
    references: [{ key: 'tavuk_gogsu', line: '165 kcal/100 g' }],
    image: false,
    last_turn_writes: [],
    history: [{ role: 'assistant', content: 'Bu kayıt yanlış görünüyor, düzelteyim mi?' }],
  }).split('\n');
  for (const l of labels.filter((x) => x !== TRIPWIRE_LABEL)) assert(block.some((line) => line.startsWith(l)), `the renderer never emits "${l}"`);
  assert(block.some((line) => line.endsWith('(son tur)')), 'last-turn records are a suffix, not a block');
  assert(block.includes('BUGÜN: su 1,40 L'), 'the su_ekle context line is a line the renderer emits');
  assert(block.includes('koç: "Bu kayıt yanlış görünüyor, düzelteyim mi?"'), 'SON KONUŞMA lines read "koç: …" as the few-shot shows');
  // The shadow's real TurnInput goes through the same renderer: the history block is there too.
  const live = renderTurnInput(await loadTurnInput(fakeTurnInputDb(seedTables()), { userId: USER, now: NOW })).split('\n');
  for (const l of labels.filter((x) => x !== TRIPWIRE_LABEL && x !== BLOCK_TITLES.references)) {
    assert(live.some((line) => line.startsWith(l)), `the loader's block never carries "${l}"`);
  }
  assert(renderTripwireFacts(scanTripwires('antrenmanda bayıldım')).startsWith(TRIPWIRE_LABEL), 'tripwire facts heading');
});

Deno.test('tripwire context is what the scanner really renders for that message — and no example hides a live trigger', () => {
  for (const s of UNDERSTAND_FEW_SHOTS) {
    const scan = scanTripwires(s.message);
    const lines = s.context.filter((l) => l.startsWith(`${TRIPWIRE_LABEL}: `));
    const readings = s.decision.safety?.tripwire_readings ?? [];
    if (lines.length === 0) {
      assertEquals(liveAmbiguousHits(scan).map((h) => h.trigger), [], `${s.id}: the message trips a tripwire its context does not show`);
      assertEquals(readings, [], `${s.id}: tripwire_readings without a tripwire`);
      continue;
    }
    const facts = renderTripwireFacts(scan);
    for (const l of lines) assert(facts.includes(`- ${l.slice(TRIPWIRE_LABEL.length + 2)}`), `${s.id}: "${l}" is not in:\n${facts}`);
    // ONE reading per live ambiguous hit, by the hit_id the scan really gave it, each reasoned.
    assertEquals(readings.map((r) => r.hit_id).sort(), liveAmbiguousHits(scan).map((h) => h.hit_id).sort(), `${s.id}: readings ↔ hits`);
    for (const r of readings) {
      assert(r.reading === 'positive' || r.reading === 'benign', `${s.id}: reading`);
      assert(typeof r.reason === 'string' && r.reason.length > 10, `${s.id}: a tripwire needs a reasoned reading`);
    }
  }
});

// ─── the production failures each example was chosen for ────────────────────────────────────────

Deno.test('few-shots encode the production failures they were chosen for (§1, §8.3, §9.4 A/A\'/B−)', () => {
  // final2#3: "1 bardak su" became +1 L. §9.4 A (live eval 2026-10-10): the tea next to the water is
  // its own report — written as a meal even without a stated amount, never dropped for the water.
  const suShot = shot('su_ekle').decision;
  const su = itemsOf(suShot, 'writes', 'water_log')[0];
  assertEquals([su.quantity, su.unit, su.mode], [1, 'bardak', 'add']);
  assertEquals(mealItems(itemsOf(suShot, 'writes', 'meal_log')[0]).map((i) => i.name), ['çay']);

  // §9.4 A / §6.2: "sonuncuyu sil" with two last-turn writes → clarify with both, nothing deleted.
  const two = shot('iki_aday_sil').decision;
  assertEquals([two.record_ops, two.writes], [undefined, undefined]);
  assertEquals([...(two.clarify?.candidate_refs ?? [])].sort(), ['d3', 'm14']);

  // devir §6 (live eval 2026-10-10): a report that ends in a question is still written, not question_only.
  const rq = shot('bildirim_ve_soru').decision;
  assertEquals(itemsOf(rq, 'writes', 'meal_log').map((w) => w.day), ['yesterday']);
  assertEquals(rq.self_check?.not_written_reason, undefined);

  // final2#4: 6 nugget became 900 g tavuk göğsü / 1708 kcal.
  const nug = mealItems(itemsOf(shot('nugget').decision, 'writes', 'meal_log')[0])[0];
  assertEquals(nug.reference_key, null, 'tavuk göğsü is a candidate, not the food');
  assert(nug.kcal >= 220 && nug.kcal <= 450);

  // "2 çimdik tuz": kept verbatim, tiny, 0 kcal, no question.
  const tuz = shot('cimdik_tuz');
  const salt = mealItems(itemsOf(tuz.decision, 'writes', 'meal_log')[0]).find((i) => i.name === 'tuz');
  assert(salt && salt.as_stated === '2 çimdik' && (salt.grams ?? 99) <= 3 && salt.kcal === 0);
  assertEquals(tuz.decision.clarify, undefined);

  // diff#1/#2: "bugün toplam 2 litre" is a day total, not an addition.
  const tot = itemsOf(shot('su_gun_toplami').decision, 'writes', 'water_log')[0];
  assertEquals([tot.quantity, tot.unit, tot.mode], [2, 'litre', 'set_day_total']);

  // final2#2: "geri al" right after a water log deleted the dinner from 45 min earlier.
  const undo = shot('su_geri_al').decision;
  assertEquals(undo.record_ops?.map((r) => [r.op, r.ref]), [['delete', 'd3']]);
  assertEquals(undo.writes, undefined);

  // diff#5 + "update by ref": the water correction targets d3 and adds no second water.
  const fix = shot('su_duzeltme').decision;
  assertEquals(fix.record_ops?.map((r) => [r.op, r.ref, r.basis]), [['update', 'd3', 'user_correction']]);
  const fp = patchOf(fix.record_ops![0])!;
  assertEquals([fp.op, fp.quantity, fp.unit, fp.mode], ['water_log', 2, 'bardak', 'add']);
  assertEquals(fix.writes, undefined, 'no new water_log next to the correction (double count)');

  // final2#1: "nasıl düzeltebilirim?" deleted the last meal. A question writes nothing.
  const q = shot('duzeltme_sorusu').decision;
  assertEquals(q.intent.primary, 'question');
  assertEquals([q.writes, q.record_ops], [undefined, undefined]);

  // final2#6 + owner decision 2026-10-06: a noticed suspicious record is PROPOSED (held, asked once)…
  const sus = shot('supheli_kayit').decision;
  assertEquals(sus.record_ops?.map((r) => [r.op, r.ref, r.basis]), [['update', 'm12', 'suspicious']]);
  assertEquals(sus.record_ops![0].evidence_quote, undefined, 'suspicious → evidence_quote null');
  assertEquals(sus.writes, undefined);
  // …and the "evet" next turn confirms the hold; it does not write a second meal.
  const yes = shot('supheli_kayit_onayi').decision;
  assertEquals(yes.pending_ops?.map((p) => [p.op, p.ref]), [['confirm', 'p1']]);
  assertEquals([yes.writes, yes.record_ops], [undefined, undefined]);

  const plan = shot('plan_istegi').decision;
  assertEquals([plan.plan_action?.op, plan.reply_route?.contract], ['generate', 'plan']);
  // mem#7: typed approval while a draft is open approves THAT draft; nothing is generated.
  const ok = shot('taslak_onayi').decision;
  assertEquals([ok.plan_action?.op, ok.plan_action?.draft_ref], ['approve', 'dft1']);

  // "fıstık yok ama fındık var": two writes with opposite polarity, ids from the registry's ALLERGENS.
  const al = itemsOf(shot('alerji_beyani').decision, 'writes', 'constraint_add');
  assertEquals(al.map((w) => [w.subject_id, w.polarity]), [['peanut', 'does_not_have'], ['hazelnut', 'has']]);
  for (const w of al) assert(Object.prototype.hasOwnProperty.call(vocab.ALLERGENS, String(w.subject_id)), `${w.subject_id} is an ALLERGENS id`);

  // Third-person allergy never reaches the user's safety spine.
  const other = shot('baskasinin_alerjisi').decision;
  assertEquals(other.intent.about_other_person, true);
  assertEquals(itemsOf(other, 'writes', 'constraint_add')[0].whose, 'other_person');

  const inj = itemsOf(shot('sakatlik').decision, 'writes', 'constraint_add')[0];
  assertEquals([inj.kind, inj.severity], ['injury', 'unknown']);
  assert((inj.body_parts as string[]).every((b) => Object.prototype.hasOwnProperty.call(vocab.BODY_PARTS, b)) && (inj.body_parts as string[]).includes('knee'));

  // Same tripwire, opposite readings — each with a reason.
  const mecaz = shot('tetik_mecaz').decision.safety?.tripwire_readings ?? [];
  const gercek = shot('tetik_gercek').decision;
  assert(mecaz.length === 1 && mecaz[0].reading === 'benign' && (mecaz[0].reason ?? '').length > 10);
  assert((gercek.safety?.tripwire_readings ?? []).every((r) => r.reading === 'positive') && gercek.safety?.acute_medical === true);
  assertEquals(gercek.reply_route?.contract, 'emergency');
  assertEquals(gercek.self_check?.not_written_reason, 'emergency_turn', 'an emergency turn never ends in a data-entry question');

  // §7.2: "dün gece kustum, zehirlendim galiba" is illness, not an ED signal — no escalation, no crisis route.
  const kus = shot('kusma_hastalik').decision;
  assertEquals(kus.safety?.ed_signal?.category, 'illness_vomiting');
  assertEquals(kus.reply_route, undefined, 'coach route (default), not crisis');

  assertEquals(shot('soru_kayit_degil').decision.writes, undefined, 'a question about water is not a water log');
});

// ─── rendering and the prefix ────────────────────────────────────────────────────────────────────

Deno.test('renderFewShots: decisions render in schema order at every level, whatever the literal order', () => {
  const s: UnderstandFewShot = {
    id: 'x',
    context: [],
    message: '1 bardak su',
    // deliberately out of order, top level and inside the write
    decision: {
      reply_route: { contract: 'coach', effort_hint: 'low' },
      writes: [{ mode: 'add', unit: 'bardak', op: 'water_log', quantity: 1, as_stated: '1 bardak', day: 'today' }],
      intent: { primary: 'report' },
    },
    why: 'w',
  };
  const out = renderFewShots([s]);
  const order = (keys: string[]) => keys.map((k) => out.indexOf(`"${k}"`));
  const top = order(['intent', 'writes', 'reply_route']);
  assert(top.every((x, i) => x > -1 && (i === 0 || x > top[i - 1])), out);
  const inner = order(['op', 'day', 'as_stated', 'quantity', 'unit', 'mode']);
  assert(inner.every((x, i) => x > -1 && (i === 0 || x > inner[i - 1])), out);
  assert(!out.includes('"other_ml_each"'), 'elided fields stay elided in the rendering');
});

Deno.test('understand prefix: rules → registry doc → few-shots, byte-stable, refuses an empty doc; cache key names both versions', () => {
  const doc = buildWriteDoc();
  const a = buildUnderstandPrefix({ registryDoc: doc });
  assertEquals(buildUnderstandPrefix({ registryDoc: doc }), a, 'global cache needs identical bytes');
  assertEquals(a, [UNDERSTAND_RULES, doc, renderFewShots()].join('\n\n'));
  assertThrows(() => buildUnderstandPrefix({ registryDoc: '' }));
  assertThrows(() => buildUnderstandPrefix({ registryDoc: ' \n' }));
  assertEquals(UNDERSTAND_CACHE_KEY, `kochko-understand:${UNDERSTAND_PROMPT_VERSION}-${SCHEMA_VERSION}`);
  assert(a.includes(`kochko_understand_${SCHEMA_VERSION}`), 'the prefix carries the doc of the schema it is sent with');
});
