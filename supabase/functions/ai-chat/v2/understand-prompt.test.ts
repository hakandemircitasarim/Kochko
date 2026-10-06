/**
 * Stage A's few-shots are the decisions the model will imitate, so each one must itself obey the
 * hard rules code enforces at T5 (refs only from the shown set, verbatim evidence quotes, as_stated
 * kept verbatim, macro/kcal agreement) and encode the eval expectations of §9.4 package A/A' for the
 * production failures it was chosen for. A few-shot that breaks a validator rule would teach the
 * model to produce writes the validator rejects.
 */
import { assert, assertEquals, assertThrows } from 'https://deno.land/std@0.168.0/testing/asserts.ts';
import { asciiTurkishHits, devLeakHits, diacriticRatio, pileWords, shoutedWords } from '../../shared/prompt-lint.ts';
import { estimateTokens, PROMPT_BUDGETS } from './prompt-size.ts';
import {
  buildUnderstandPrefix,
  FEW_SHOT_CONTEXT_LABELS,
  type FewShotDecision,
  type FewShotWrite,
  renderFewShots,
  UNDERSTAND_CACHE_KEY,
  UNDERSTAND_DECISION_KEYS,
  UNDERSTAND_FEW_SHOTS,
  UNDERSTAND_RULES,
  type UnderstandFewShot,
} from './understand-prompt.ts';

/** §4.4 water_log unit enum. */
const WATER_UNITS = ['ml', 'litre', 'bardak', 'su_bardagi', 'cay_bardagi', 'kupa', 'sise_330', 'sise_500', 'sise_1500', 'other'];
/** §4.4 "Tam liste (~24 op)". A few-shot op outside it is a typo the schema would reject. */
const KNOWN_OPS = [
  'meal_log', 'water_log', 'workout_log', 'body_weight', 'sleep_log', 'mood_log', 'step_log', 'supplement_log',
  'profile_set', 'goal_set', 'constraint_add', 'constraint_retract', 'confirm', 'food_pref', 'life_event', 'lab_value',
  'commitment_add', 'commitment_resolve', 'recipe_save', 'periodic_state', 'target_change', 'memory', 'account_erase_request',
];

const shot = (id: string): UnderstandFewShot => {
  const s = UNDERSTAND_FEW_SHOTS.find((x) => x.id === id);
  assert(s, `missing few-shot: ${id}`);
  return s;
};
const writesOf = (d: FewShotDecision, op?: string): FewShotWrite[] => (d.writes ?? []).filter((w) => !op || w.op === op);
type Item = { name: string; as_stated?: string; grams?: number; kcal: number; protein_g?: number; carbs_g?: number; fat_g?: number; reference_key?: string | null };
const itemsOf = (w: FewShotWrite): Item[] => (w.items as Item[] | undefined) ?? [];
const lc = (s: string) => s.toLocaleLowerCase('tr');

/** Every ref a decision points at — each must have been SHOWN to the model (refInRenderedSet, §4.4). */
function refsUsed(d: FewShotDecision): string[] {
  const refs: string[] = [];
  for (const w of d.writes ?? []) if (typeof w.replaces === 'string') refs.push(w.replaces);
  for (const r of d.record_ops ?? []) refs.push(r.ref);
  for (const p of d.pending_ops ?? []) refs.push(p.ref);
  for (const c of d.clarify?.candidate_refs ?? []) refs.push(c);
  if (d.plan_action?.draft_ref) refs.push(d.plan_action.draft_ref);
  return refs;
}

Deno.test('understand rules: ~1.2K tokens (§8.3) and the few-shots stay compact', () => {
  const r = estimateTokens(UNDERSTAND_RULES);
  const [rf, rc] = PROMPT_BUDGETS.understandRules;
  assert(r >= rf && r <= rc, `rules ~${r} tokens, budget [${rf}, ${rc}]`);
  const f = estimateTokens(renderFewShots());
  const [ff, fc] = PROMPT_BUDGETS.understandFewShots;
  assert(f >= ff && f <= fc, `few-shots ~${f} tokens, budget [${ff}, ${fc}]`);
});

Deno.test('understand rules: calm Turkish with diacritics, no shouting, no piles, no dev residue', () => {
  // JSON and the date format are technical names, not emphasis.
  assertEquals(shoutedWords(UNDERSTAND_RULES, ['JSON', 'YYYY-MM-DD']), []);
  assertEquals(pileWords(UNDERSTAND_RULES), []);
  assertEquals(asciiTurkishHits(UNDERSTAND_RULES), []);
  assertEquals(devLeakHits(UNDERSTAND_RULES), []);
  assert(diacriticRatio(UNDERSTAND_RULES) >= 0.05);
  for (const concept of ['as_stated', 'replaces', 'clarify', 'evidence_quote', 'tripwire_reading', 'reference_key', 'self_check']) {
    assert(UNDERSTAND_RULES.includes(concept), `rules never explain ${concept}`);
  }
});

Deno.test('few-shots: well-formed — unique ids, decision keys from the schema, labelled context', () => {
  const ids = UNDERSTAND_FEW_SHOTS.map((s) => s.id);
  assertEquals(new Set(ids).size, ids.length);
  assert(UNDERSTAND_FEW_SHOTS.length >= 10 && UNDERSTAND_FEW_SHOTS.length <= 16, 'about ten few-shots (§8.3)');
  for (const s of UNDERSTAND_FEW_SHOTS) {
    assert(s.message.trim() && s.why.trim(), `${s.id}: empty message/why`);
    assert(s.decision.intent?.primary, `${s.id}: intent first`);
    for (const k of Object.keys(s.decision)) {
      assert((UNDERSTAND_DECISION_KEYS as readonly string[]).includes(k), `${s.id}: unknown decision key ${k}`);
    }
    for (const w of s.decision.writes ?? []) assert(KNOWN_OPS.includes(w.op), `${s.id}: unknown op ${w.op}`);
    for (const line of s.context) {
      assert(FEW_SHOT_CONTEXT_LABELS.some((l) => line.startsWith(`${l}:`)), `${s.id}: unlabelled context line "${line}"`);
    }
  }
});

Deno.test('few-shots obey the validator: refs only from the shown set', () => {
  for (const s of UNDERSTAND_FEW_SHOTS) {
    const shown = s.context.join('\n');
    for (const ref of refsUsed(s.decision)) {
      assert(new RegExp(`(?<![\\p{L}\\p{N}])${ref}(?![\\p{L}\\p{N}])`, 'u').test(shown), `${s.id}: ref ${ref} was never shown`);
    }
  }
});

Deno.test('few-shots obey the validator: evidence quotes and as_stated are verbatim from the message', () => {
  for (const s of UNDERSTAND_FEW_SHOTS) {
    const msg = lc(s.message);
    const quotes: string[] = [];
    for (const w of s.decision.writes ?? []) if (typeof w.evidence_quote === 'string') quotes.push(w.evidence_quote);
    if (s.decision.safety?.ed_signal) quotes.push(s.decision.safety.ed_signal.evidence_quote);
    for (const q of quotes) assert(msg.includes(lc(q)), `${s.id}: evidence_quote "${q}" is not in the message`);

    const stated: string[] = [];
    for (const w of s.decision.writes ?? []) {
      if (typeof w.as_stated === 'string') stated.push(w.as_stated);
      for (const it of itemsOf(w)) if (it.as_stated) stated.push(it.as_stated);
    }
    for (const r of s.decision.record_ops ?? []) {
      const patch = r.patch as { items?: Item[] } | undefined;
      for (const it of patch?.items ?? []) if (it.as_stated) stated.push(it.as_stated);
    }
    for (const a of stated) assert(msg.includes(lc(a)), `${s.id}: as_stated "${a}" is not the user's wording`);
  }
});

Deno.test('few-shots obey the validator: meal numbers are physically coherent (no FLAG in a teaching example)', () => {
  for (const s of UNDERSTAND_FEW_SHOTS) {
    const items: Item[] = [];
    for (const w of writesOf(s.decision, 'meal_log')) items.push(...itemsOf(w));
    for (const r of s.decision.record_ops ?? []) items.push(...((r.patch as { items?: Item[] } | undefined)?.items ?? []));
    for (const it of items) {
      const p = it.protein_g ?? 0, c = it.carbs_g ?? 0, f = it.fat_g ?? 0;
      if (it.kcal === 0) {
        assert(p + c + f <= 0.5, `${s.id}/${it.name}: 0 kcal but has macros`);
        continue;
      }
      const fromMacros = 4 * p + 4 * c + 9 * f;
      assert(Math.abs(fromMacros - it.kcal) / it.kcal <= 0.25, `${s.id}/${it.name}: macros ${fromMacros} vs kcal ${it.kcal}`);
      if (it.grams) assert(it.kcal / it.grams <= 9.5, `${s.id}/${it.name}: energy density above 9.5 kcal/g`);
    }
  }
});

Deno.test('few-shots: self_check is honest — reported facts are marked, unwritten ones carry a reason (§5.1 #10)', () => {
  for (const s of UNDERSTAND_FEW_SHOTS) {
    const d = s.decision;
    const wrote = (d.writes?.length ?? 0) + (d.record_ops?.length ?? 0) > 0;
    const reported = d.self_check?.reported_new_facts === true;
    if (wrote) assert(reported, `${s.id}: wrote a record but did not mark reported_new_facts`);
    if (reported && !wrote && !d.clarify) {
      assert((d.self_check?.not_written_reason ?? '').length > 0, `${s.id}: reported but unwritten without a reason → Stage B would ask blindly`);
    }
    if (d.intent.primary === 'question' && !wrote) assert(!reported, `${s.id}: a question is not a reported fact`);
  }
});

Deno.test('few-shots: water writes use the unit enum, never litres for glasses', () => {
  for (const s of UNDERSTAND_FEW_SHOTS) {
    for (const w of writesOf(s.decision, 'water_log')) {
      assert(WATER_UNITS.includes(String(w.unit)), `${s.id}: unit ${w.unit}`);
      assert(['add', 'set_day_total'].includes(String(w.mode)), `${s.id}: mode ${w.mode}`);
      if (/bardak/u.test(String(w.as_stated))) assertEquals(w.unit, 'bardak', `${s.id}: a glass is a glass, code converts`);
    }
  }
});

Deno.test('few-shots encode the production failures they were chosen for (§1, §9.4 A/A\')', () => {
  // final2#3: "1 bardak su" became +1 L.
  const su = writesOf(shot('su_ekle').decision, 'water_log')[0];
  assertEquals([su.quantity, su.unit, su.mode], [1, 'bardak', 'add']);

  // final2#4: 6 nugget became 900 g tavuk göğsü / 1708 kcal.
  const nug = itemsOf(writesOf(shot('nugget').decision, 'meal_log')[0])[0];
  assertEquals(nug.reference_key, null, 'tavuk göğsü is a candidate, not the food');
  assert(nug.kcal >= 220 && nug.kcal <= 450);

  // "2 çimdik tuz": kept verbatim, tiny, 0 kcal, no question.
  const tuz = shot('cimdik_tuz');
  const salt = itemsOf(writesOf(tuz.decision, 'meal_log')[0]).find((i) => i.name === 'tuz');
  assert(salt && salt.as_stated === '2 çimdik' && (salt.grams ?? 99) <= 3 && salt.kcal === 0);
  assertEquals(tuz.decision.clarify, undefined);

  // "bugün toplam 2 litre": a day total, not an addition.
  const tot = writesOf(shot('su_gun_toplami').decision, 'water_log')[0];
  assertEquals([tot.quantity, tot.unit, tot.mode], [2, 'litre', 'set_day_total']);

  // final2#1: "nasıl düzeltebilirim?" deleted the last meal. A question writes nothing.
  const q = shot('duzeltme_sorusu').decision;
  assertEquals(q.intent.primary, 'question');
  assertEquals([q.writes, q.record_ops], [undefined, undefined]);

  // diff#5: "su yanlış" must target the water ref, never a meal by time window.
  const fix = writesOf(shot('su_duzeltme').decision, 'water_log')[0];
  assertEquals([fix.quantity, fix.unit, fix.replaces], [2, 'bardak', 'd3']);

  // final2#6 + owner decision: the confirmed fix updates m12 in place; no second meal.
  const upd = shot('supheli_kayit_onayi').decision;
  assertEquals(upd.record_ops?.map((r) => [r.op, r.ref]), [['update', 'm12']]);
  assertEquals(upd.writes, undefined);

  const plan = shot('plan_istegi').decision;
  assertEquals([plan.plan_action?.op, plan.reply_route?.contract], ['generate', 'plan']);

  // "fıstık yok ama fındık var": two writes with opposite polarity (whole-message negation missed it).
  const al = writesOf(shot('alerji_beyani').decision, 'constraint_add');
  assertEquals(al.map((w) => [w.subject_id, w.polarity]), [['peanut', 'does_not_have'], ['tree_nut:hazelnut', 'has']]);

  // Third-person allergy never reaches the user's safety spine.
  const other = shot('baskasinin_alerjisi').decision;
  assertEquals(other.intent.about_other_person, true);
  assertEquals(writesOf(other, 'constraint_add')[0].whose, 'other_person');

  const inj = writesOf(shot('sakatlik').decision, 'constraint_add')[0];
  assertEquals([inj.kind, inj.severity], ['injury', 'unknown']);
  assert((inj.body_parts as string[]).includes('knee'));

  // Same tripwire, opposite readings — each with a reason.
  const mecaz = shot('tetik_mecaz').decision.safety?.tripwire_reading;
  const gercek = shot('tetik_gercek').decision;
  assert(mecaz?.benign === true && mecaz.reason.length > 10);
  assert(gercek.safety?.tripwire_reading?.benign === false && gercek.safety.acute_medical === true);
  assertEquals(gercek.reply_route?.contract, 'emergency');

  assertEquals(shot('soru_kayit_degil').decision.writes, undefined, 'a question about water is not a water log');
});

Deno.test('renderFewShots: decisions render in schema (decision-first) order whatever the literal order', () => {
  const s: UnderstandFewShot = {
    id: 'x',
    context: [],
    message: 'm',
    // deliberately out of order
    decision: { reply_route: { contract: 'coach', effort_hint: 'low' }, writes: [], intent: { primary: 'chat' } } as FewShotDecision,
    why: 'w',
  };
  const out = renderFewShots([s]);
  const i = out.indexOf('"intent"'), w = out.indexOf('"writes"'), r = out.indexOf('"reply_route"');
  assert(i > -1 && i < w && w < r, out);
});

Deno.test('understand prefix: rules → registry doc → few-shots, byte-stable, refuses an empty doc', () => {
  const doc = 'YAZILABİLİR KAYITLAR\nwater_log: ...';
  const a = buildUnderstandPrefix({ registryDoc: doc });
  assertEquals(buildUnderstandPrefix({ registryDoc: doc }), a, 'global cache needs identical bytes');
  assertEquals(a, [UNDERSTAND_RULES, doc, renderFewShots()].join('\n\n'));
  assertThrows(() => buildUnderstandPrefix({ registryDoc: '' }));
  assertThrows(() => buildUnderstandPrefix({ registryDoc: ' \n' }));
  assertEquals(UNDERSTAND_CACHE_KEY, 'kochko-understand:v1');
});
