/**
 * postcheck.test.ts — T7 (AI_MIMARI_V2 §3.2 T7, §7.1, §7.2, §5.2).
 *
 * Pinned: the suggestion invariant on TAGS ∪ the name dictionary against severe/unknown allergens and
 * injured regions; ONE regeneration naming the excluded items, then a safe fallback that keeps every
 * other notice and never repeats itself on two consecutive turns; the prose judge for severe users,
 * fail-closed; the crisis path's ready-made reply when Stage B fails; and the mandatory lines —
 * 112/referral, allergen exposure, safety-hold question — appended LAST, only when missing, without
 * removing a single character of what came before.
 */
import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { REQUIRED_SAFETY_LINE } from '../../shared/safety-tripwires.ts';
import { MODELS } from '../../shared/openai.ts';
import type { CoachRun } from './coach.ts';
import type { CoachReply, V2Hold } from './contracts.ts';
import { isSafetyHold, renderTurnEvents } from './facts.ts';
import {
  clarifyLine, JUDGE_SCHEMA, type JudgeOutcome, type JudgeRequest, lunaJudge, mandatoryLines, MIN_COACH_CALL_MS, MIN_JUDGE_CALL_MS,
  postcheckReply, type ProseJudge, RECEIPTS_BELOW_TR, referralFlagMismatch, type RegenNote, rejectLine, replyAsksHold,
  SAFE_FALLBACK_VARIANTS, safetyProfileOf, suggestionViolations, withCodeNotes, withinBudget,
} from './postcheck.ts';
import { SUGGESTION_UNVERIFIED_LINE } from './guarantees.ts';
import { fakeResponses, refusalBody, responsesBody } from './testing.ts';
import {
  coachInput, commit, decision, edFallbackTripwire, protectiveTripwire, replyJson, seededTurnInput,
} from './stage-b-testing.ts';

function run(reply: CoachReply | null, status: CoachRun['status'] = reply ? 'ok' : 'error'): CoachRun {
  return { status, reply, model: 'gpt-5.6-terra', effort: 'low', contract: null, latencyMs: 10, usage: null, attempts: 1, retries: [], detail: null, regen: false };
}

function judges(...outs: JudgeOutcome[]): { judge: ProseJudge; calls: number } {
  const st = { calls: 0, judge: null as unknown as ProseJudge };
  st.judge = (_req) => Promise.resolve(outs[Math.min(st.calls++, outs.length - 1)]);
  return st;
}
const CLEAN: JudgeOutcome = { status: 'ok', violation: false, items: [], ms: 5 };
const FAILED: JudgeOutcome = { status: 'failed', reason: 'timeout', ms: 5000 };

const PEANUT_TOAST = replyJson({
  suggested_foods: [{ name: 'fıstık ezmeli tost', allergens: [], may_contain: [] }],
  reply: 'Ara öğünde fıstık ezmeli tost iyi gider.',
});
const SAFE_SNACK = replyJson({
  suggested_foods: [{ name: 'yoğurtlu meyve', allergens: ['milk'], may_contain: [] }],
  reply: 'Ara öğünde bir kase yoğurtlu meyve iyi gider.',
});
const RETRACT_HOLD: V2Hold = {
  op: 'constraint_retract', reason_code: 'iki_adimli_kaldirma', hold_id: 'pw-5',
  question_tr: 'Bu kaydı gerçekten kaldırmamı istiyor musun? Güvenlik filtrelerin buna göre değişecek.',
};
const MEAL_HOLD: V2Hold = { op: 'meal_log', reason_code: 'ogun_toplam_yuksek', hold_id: 'pw-6', question_tr: 'Bu öğün çok yüksek kalorili çıktı; porsiyonları doğru anladım mı?' };

Deno.test('safety profile: spine severe/unknown allergens + injured regions; this turn\'s own declaration protects at once', async () => {
  const ti = await seededTurnInput();
  const p = safetyProfileOf(ti);
  assertEquals([p.severeAllergens, p.injuredRegions, p.needsJudge], [['fıstık'], ['knee'], true]);
  const withEgg = safetyProfileOf(ti, decision({ writes: [
    { op: 'constraint_add', kind: 'allergen', subject_id: 'egg', display_tr: 'yumurta', whose: 'self', polarity: 'has', severity: 'unknown', body_parts: [] },
    { op: 'constraint_add', kind: 'allergen', subject_id: 'milk', display_tr: 'süt', whose: 'other_person', polarity: 'has', severity: 'severe', body_parts: [] },
  ] }));
  assertEquals(withEgg.severeAllergens, ['fıstık', 'egg', 'yumurta'], 'a daughter\'s allergy is not the user\'s spine');
  const none = safetyProfileOf(await seededTurnInput((t) => { t.user_constraints = []; }));
  assertEquals(none.needsJudge, false);
});

Deno.test('suggestion invariant: tags, may_contain and the NAME dictionary against severe allergens; loads against injuries', async () => {
  const p = safetyProfileOf(await seededTurnInput());
  const hits = suggestionViolations(replyJson({
    suggested_foods: [
      { name: 'fıstık ezmeli tost', allergens: [], may_contain: [] },          // name dictionary
      { name: 'satay tavuk', allergens: ['peanut'], may_contain: [] },          // certain tag
      { name: 'granola', allergens: ['gluten'], may_contain: ['peanut'] },      // may_contain
      { name: 'yulaf lapası', allergens: ['gluten', 'milk'], may_contain: [] }, // clean
    ],
    suggested_exercises: [{ name: 'squat', loads: ['knee', 'hip'] }, { name: 'şınav', loads: ['shoulder', 'wrist'] }],
  }), p);
  assertEquals(hits.map((h) => [h.kind, h.name]), [['food', 'fıstık ezmeli tost'], ['food', 'satay tavuk'], ['food', 'granola'], ['exercise', 'squat']]);
});

Deno.test('ONE regen naming the excluded items; the clean regen goes out', async () => {
  const ti = await seededTurnInput();
  const j = judges(CLEAN);
  const notes: RegenNote[] = [];
  const r = await postcheckReply(coachInput(ti), run(PEANUT_TOAST), {
    judge: j.judge,
    regen: (n) => { notes.push(n); return Promise.resolve(run(SAFE_SNACK)); },
  });
  assertEquals(notes.length, 1);
  assertEquals(notes[0].excluded, [{ name: 'fıstık ezmeli tost', why: 'fıstık alerjisi' }]);
  assertEquals(r.log.outcome, 'regen');
  assertEquals(r.reply, SAFE_SNACK);
  assertEquals(r.text, SAFE_SNACK.reply);
  assertEquals(r.log.invariant_hits, [['fıstık ezmeli tost'], []]);
  assertEquals(r.log.judge, ['clean', 'clean']);
});

Deno.test('regen still violating → safe fallback: no suggestion, other notices kept, never the same sentence twice in a row', async () => {
  const ti = await seededTurnInput();
  const input = coachInput(ti, {
    commit: commit({
      receipts: [{ action_type: 'meal_log', legacy_type: 'meal_log', ok: true, rows_affected: 1, user_line: 'Öğün kaydedildi — kraker ~120 kcal · toplam 120 kcal', failure_class: null, ref: 'm4' }],
      exposures: [{ allergens: ['fıstık'], source: 'meal', ref: 'm4' }],
      holds: [RETRACT_HOLD],
    }),
  });
  const r = await postcheckReply(input, run(PEANUT_TOAST), { judge: judges(CLEAN).judge, regen: () => Promise.resolve(run(PEANUT_TOAST)) });
  assertEquals(r.log.outcome, 'safe_fallback');
  assertEquals([r.reply.suggested_foods, r.reply.suggested_exercises], [[], []]);
  assert(r.reply.reply.startsWith('Bu turdaki kaydın yerinde. '), r.reply.reply);
  assertStringIncludes(r.reply.reply, SAFE_FALLBACK_VARIANTS[0]('fıstık alerjin ve diz sakatlığın'));
  assertEquals(r.codeNotes.map((n) => n.kind), ['allergen_exposure', 'safety_hold'], 'the exposure and the hold question survive the fallback');
  // The next turn, if it falls back again, uses the other wording.
  const again = await postcheckReply({ ...input, history: [{ role: 'assistant', content: r.text }] }, run(PEANUT_TOAST), {
    judge: judges(CLEAN).judge, regen: () => Promise.resolve(run(PEANUT_TOAST)),
  });
  assertStringIncludes(again.reply.reply, SAFE_FALLBACK_VARIANTS[1]('fıstık alerjin ve diz sakatlığın'));
});

Deno.test('code-authored fallbacks: "in place" only when every write landed; no memory from a rejected draft', async () => {
  const ti = await seededTurnInput();
  const OK = { action_type: 'meal_log', legacy_type: 'meal_log', ok: true, rows_affected: 1, user_line: 'Öğün kaydedildi — kraker ~120 kcal · toplam 120 kcal', failure_class: null, ref: 'm4' };
  const BAD = { action_type: 'water_log', legacy_type: 'water_log', ok: false, rows_affected: 0, user_line: 'Kaydedilmedi (Su)', failure_class: 'write_failed' };
  const deps = { judge: judges(CLEAN).judge, regen: () => Promise.resolve(run({ ...PEANUT_TOAST, memory: [{ note: 'regen draft' }] })) };
  const firstDraft = { ...PEANUT_TOAST, memory: [{ note: 'first draft' }] };

  const partial = await postcheckReply(coachInput(ti, { commit: commit({ receipts: [OK, BAD] }) }), run(firstDraft), deps);
  assertEquals(partial.log.outcome, 'safe_fallback');
  assert(partial.reply.reply.startsWith(`${RECEIPTS_BELOW_TR} `), partial.reply.reply);
  assert(!partial.reply.reply.includes('yerinde'), 'a partly failed turn is never called "in place"');
  assertEquals(partial.reply.memory, [], 'memory[] of a draft that failed the safety check is dropped');

  const two = await postcheckReply(coachInput(ti, { commit: commit({ receipts: [OK, { ...OK, ref: 'm5' }] }) }), run(firstDraft), deps);
  assert(two.reply.reply.startsWith('Bu turdaki kayıtların yerinde. '), two.reply.reply);
  const none = await postcheckReply(coachInput(ti), run(firstDraft), deps);
  assert(none.reply.reply.startsWith(SAFE_FALLBACK_VARIANTS[0]('fıstık alerjin ve diz sakatlığın')), 'no writes, no receipts lead');

  const crisis = await postcheckReply(coachInput(ti, { tripwire: protectiveTripwire('ed') }), run(firstDraft), { ...deps, regen: () => Promise.resolve(run(firstDraft)) });
  assertEquals([crisis.log.outcome, crisis.reply.memory], ['crisis_canned', []]);
});

Deno.test('code-authored reply on a normal turn: reject reasons first, then the mandatory lines; the clarify question when no hold is asked', async () => {
  const ti = await seededTurnInput();
  const REJECT = { op: 'water_log', reason_code: 'litre_araligi', reason_tr: '250 L su fiziksel olarak mümkün değil' };
  const BAD = { action_type: 'water_log', legacy_type: 'water_log', ok: false, rows_affected: 0, user_line: 'Kaydedilmedi (Su)', failure_class: 'out_of_range' };
  const input = coachInput(ti, {
    commit: commit({ receipts: [BAD], rejects: [REJECT], exposures: [{ allergens: ['fıstık'], source: 'meal', ref: 'm4' }], holds: [RETRACT_HOLD] }),
  });
  const failed = await postcheckReply(input, run(null, 'error'), { judge: null, regen: () => Promise.resolve(run(null)) });
  assertEquals(failed.log.outcome, 'coach_failed');
  assertEquals(failed.codeNotes.map((n) => n.kind), ['other', 'allergen_exposure', 'safety_hold'], 'reasons, then exposure, then the hold question LAST');
  assertEquals(failed.codeNotes[0].text, 'Su kaydedilmedi: 250 L su fiziksel olarak mümkün değil.');
  assertEquals(rejectLine({ op: 'water_log', reason_code: 'x', reason_tr: '' }), 'Su kaydedilmedi: denetimden geçmedi.');
  assert(failed.text.endsWith(RETRACT_HOLD.question_tr));

  // No hold: the clarify topic becomes the reply's one question.
  const clarify = decision({ clarify: { topic: 'hangi kaydın silineceği', candidate_refs: ['m2', 'm3'] } });
  const asked = await postcheckReply(coachInput(ti, { decision: clarify }), run(null, 'timeout'), { judge: null, regen: () => Promise.resolve(run(null)) });
  assertEquals(asked.codeNotes.length, 1);
  assertEquals(asked.codeNotes[0].kind, 'other');
  assertStringIncludes(asked.codeNotes[0].text, 'Devam etmeden önce netleştirmem gereken bir şey var: hangi kaydın silineceği (');
  assertStringIncludes(asked.codeNotes[0].text, 'haşlanmış yumurta');
  assert(!asked.codeNotes[0].text.includes('m2'), 'internal refs never reach the user');
  // A hold outranks the clarify question (one question per reply).
  const both = await postcheckReply(coachInput(ti, { decision: clarify, commit: commit({ holds: [MEAL_HOLD] }) }), run(null), { judge: null, regen: () => Promise.resolve(run(null)) });
  assertEquals(both.codeNotes, [{ kind: 'other', text: MEAL_HOLD.question_tr }]);
  assertEquals(clarifyLine(coachInput(ti)), null);

  // The coach's own reply carries the rejects itself (facts): code adds no reason line to it.
  const coachSaid = await postcheckReply(input, run(replyJson({ reply: `250 litre su olamaz, kaydetmedim. ${RETRACT_HOLD.question_tr}` })), { judge: judges(CLEAN).judge, regen: () => Promise.resolve(run(null)) });
  assertEquals(coachSaid.codeNotes.map((n) => n.kind), ['allergen_exposure']);
  // A safety turn gets no reason lines next to the ready-made reply.
  const safety = await postcheckReply({ ...input, tripwire: protectiveTripwire('self_harm') }, run(null), { judge: null, regen: () => Promise.resolve(run(null)) });
  assert(!safety.codeNotes.some((n) => n.kind === 'other'), JSON.stringify(safety.codeNotes));
});

Deno.test('prose judge: a food the lists missed triggers the regen; a failing judge is fail-closed', async () => {
  const ti = await seededTurnInput();
  const hidden = replyJson({ reply: 'Akşam için Tayland usulü fıstık soslu erişte dene.' }); // nothing in suggested_foods
  const flagged: JudgeOutcome = { status: 'ok', violation: true, items: [{ name: 'fıstık soslu erişte', kind: 'food', constraint: 'fıstık', reason: 'sosunda yer fıstığı var' }], ms: 9 };
  const notes: RegenNote[] = [];
  const r = await postcheckReply(coachInput(ti), run(hidden), { judge: judges(flagged, CLEAN).judge, regen: (n) => { notes.push(n); return Promise.resolve(run(SAFE_SNACK)); } });
  assertEquals(r.log.outcome, 'regen');
  assertEquals(notes[0].excluded, [{ name: 'fıstık soslu erişte', why: 'sosunda yer fıstığı var' }]);

  const failing = await postcheckReply(coachInput(ti), run(SAFE_SNACK), { judge: judges(FAILED).judge, regen: (n) => { notes.push(n); return Promise.resolve(run(SAFE_SNACK)); } });
  assertEquals(notes[1].judgeFailed, true);
  assertEquals(failing.log.judge, ['failed', 'failed']);
  assertEquals(failing.log.outcome, 'safe_fallback', 'an unconfirmable reply never goes out to a severe user');

  const noJudge = await postcheckReply(coachInput(ti), run(SAFE_SNACK), { judge: null, regen: () => Promise.resolve(run(SAFE_SNACK)) });
  assertEquals(noJudge.log.outcome, 'safe_fallback', 'no judge configured = cannot confirm');
});

Deno.test('an unreadable spine: a suggestion list cannot be verified → the honest "could not check" reply, no regen, no judge', async () => {
  const ti = await seededTurnInput();
  ti.load_errors.push({ section: 'constraints', message: 'timeout' });
  const r = await postcheckReply(coachInput(ti), run(SAFE_SNACK), { judge: judges(CLEAN).judge, regen: () => { throw new Error('no regen expected'); } });
  assertEquals([r.log.outcome, r.log.regens, r.log.judge], ['safe_fallback', 0, ['skipped']]);
  assertEquals(r.reply.reply, SUGGESTION_UNVERIFIED_LINE);
  const crisis = await postcheckReply(coachInput(ti, { tripwire: protectiveTripwire('self_harm') }), run(SAFE_SNACK), { judge: null, regen: () => { throw new Error('no regen expected'); } });
  assertEquals(crisis.log.outcome, 'crisis_canned', 'the protective path still answers with the ready-made reply');
});

Deno.test('a judge or a regen that throws SYNCHRONOUSLY is a failed call, never an escape from "never throws"', async () => {
  const ti = await seededTurnInput();
  const r = await postcheckReply(coachInput(ti), run(PEANUT_TOAST), {
    judge: () => { throw new Error('sync judge bug'); },
    regen: () => { throw new Error('sync regen bug'); },
  });
  assertEquals([r.log.outcome, r.log.regens, r.log.judge_fail_reasons[0]], ['safe_fallback', 1, 'sync judge bug']);
});

Deno.test('no severe constraint: no judge, nothing to regenerate', async () => {
  const ti = await seededTurnInput((t) => { t.user_constraints = []; });
  const j = judges(FAILED);
  const r = await postcheckReply(coachInput(ti), run(PEANUT_TOAST), { judge: j.judge, regen: () => { throw new Error('no regen expected'); } });
  assertEquals([r.log.outcome, r.log.judge, j.calls], ['first', ['skipped'], 0]);
  const scoped = await postcheckReply(coachInput(await seededTurnInput()), run(replyJson()), { judge: j.judge, judgeScope: 'suggestions', regen: () => Promise.resolve(run(SAFE_SNACK)) });
  assertEquals(scoped.log.judge, ['skipped'], "'suggestions' scope skips a reply with empty lists");
});

Deno.test('crisis path: Stage B failure/late → the ready-made reply (with 112); a regen that fails too → the same', async () => {
  const ti = await seededTurnInput();
  const t = protectiveTripwire('self_harm');
  assert(t.kind === 'protective');
  const r = await postcheckReply(coachInput(ti, { tripwire: t }), run(null, 'timeout'), { judge: judges(CLEAN).judge, regen: () => Promise.resolve(run(null)) });
  assertEquals(r.log.outcome, 'crisis_canned');
  assertEquals(r.reply.reply, t.fallback.message);
  assertStringIncludes(r.text, '112');
  assertEquals(r.codeNotes, [], 'the canned reply already carries the 112 line');
  const viol = await postcheckReply(coachInput(ti, { tripwire: t }), run(replyJson({ ...PEANUT_TOAST, reply: "Yalnız değilsin, 112'yi ara. Fıstık ezmeli tost ye." })), {
    judge: judges(CLEAN).judge, regen: () => Promise.resolve(run(null)),
  });
  assertEquals(viol.log.outcome, 'crisis_canned', 'a protective turn never falls back to a food fallback');
  assertEquals(viol.log.judge, ['skipped'], 'no judge latency on a crisis turn');
});

Deno.test('ONE budget for coach + judge + regen: no regen that cannot finish, no judge that cannot run (fail-closed)', async () => {
  const ti = await seededTurnInput();
  const ed = protectiveTripwire('ed');
  assert(ed.kind === 'protective');
  // A fake budget: `left` ms remain; the fakes below spend it.
  let left = 1_500;
  const clock = () => left;
  // ED-support turn: the first reply violates; the judge eats the rest of the budget → no regen, canned.
  const slowJudge: ProseJudge = (req: JudgeRequest) => {
    assertEquals(req.timeoutMs, 1_500, 'the judge is told what is left of the turn');
    left -= 1_200;
    return Promise.resolve(CLEAN);
  };
  let regens = 0;
  const r = await postcheckReply(coachInput(ti, { tripwire: ed }), run(PEANUT_TOAST), {
    judge: slowJudge, remainingMs: clock, regen: () => { regens++; return Promise.resolve(run(SAFE_SNACK)); },
  });
  assertEquals([r.log.outcome, regens, r.log.regens, r.log.budget_exhausted], ['crisis_canned', 0, 0, true]);
  assertEquals(r.reply.reply, ed.fallback.message);
  assert(left < MIN_COACH_CALL_MS);

  // Too little left for a judge call: the reply is unconfirmed (failed, not skipped) and nothing late goes out.
  left = MIN_JUDGE_CALL_MS - 1;
  const j = judges(CLEAN);
  const starved = await postcheckReply(coachInput(ti, { tripwire: ed }), run(SAFE_SNACK), { judge: j.judge, remainingMs: clock, regen: () => Promise.resolve(run(SAFE_SNACK)) });
  assertEquals([starved.log.judge, starved.log.judge_fail_reasons, j.calls, starved.log.outcome], [['failed'], ['budget_exhausted'], 0, 'crisis_canned']);

  // Enough left: the ONE regen runs and is told how long it has.
  left = 4_000;
  const budgets: (number | undefined)[] = [];
  const ok = await postcheckReply(coachInput(ti, { tripwire: ed }), run(PEANUT_TOAST), {
    judge: judges(CLEAN).judge, remainingMs: clock, regen: (_n, ms) => { budgets.push(ms); return Promise.resolve(run(SAFE_SNACK)); },
  });
  assertEquals([ok.log.outcome, budgets], ['regen', [4_000]]);

  // A normal turn whose budget is spent goes to the safe fallback, never to a late regen.
  left = MIN_COACH_CALL_MS - 1;
  const normal = await postcheckReply(coachInput(ti), run(PEANUT_TOAST), { judge: judges(CLEAN).judge, remainingMs: clock, regen: () => { throw new Error('no regen expected'); } });
  assertEquals([normal.log.outcome, normal.log.budget_exhausted], ['safe_fallback', true]);
});

Deno.test('a judge or regen that ignores its timeout cannot stretch the turn (fail-closed at the deadline)', async () => {
  const ti = await seededTurnInput();
  const never = <T>() => new Promise<T>(() => { /* never settles, holds no timer */ });
  const started = Date.now();
  const r = await postcheckReply(coachInput(ti, { tripwire: protectiveTripwire('ed') }), run(SAFE_SNACK), {
    judge: () => never<JudgeOutcome>(), remainingMs: () => MIN_JUDGE_CALL_MS, regen: () => never<CoachRun>(),
  });
  const ms = Date.now() - started;
  assertEquals([r.log.judge, r.log.judge_fail_reasons, r.log.outcome], [['failed'], ['timeout'], 'crisis_canned']);
  assert(ms < MIN_JUDGE_CALL_MS + 1_000, `bounded by the budget (${ms} ms)`);
  // The regen race: enough budget to start it, but it never answers → the fallback at the deadline.
  const started2 = Date.now();
  const late = await postcheckReply(coachInput(ti), run(PEANUT_TOAST), { judge: judges(CLEAN).judge, remainingMs: () => MIN_COACH_CALL_MS, regen: () => never<CoachRun>() });
  assertEquals([late.log.outcome, late.log.regens], ['safe_fallback', 1]);
  assert(Date.now() - started2 < MIN_COACH_CALL_MS + 1_000);
  assertEquals(await withinBudget(Promise.resolve(7), Infinity, () => 0), 7, 'no budget = no bound');
});

Deno.test('normal turn: Stage B failure → an honest code reply; an ORDINARY hold question is then asked by code', async () => {
  const ti = await seededTurnInput();
  const input = coachInput(ti, { commit: commit({ holds: [MEAL_HOLD] }) });
  const r = await postcheckReply(input, run(null, 'refused'), { judge: judges(CLEAN).judge, regen: () => Promise.resolve(run(null)) });
  assertEquals(r.log.outcome, 'coach_failed');
  assertEquals(r.codeNotes, [{ kind: 'other', text: MEAL_HOLD.question_tr }]);
  assert(r.text.endsWith(`\n\n${MEAL_HOLD.question_tr}`));
});

Deno.test('mandatory 112/referral: only when the resolution demands it and the reply lacks it', async () => {
  const ti = await seededTurnInput();
  const sh = protectiveTripwire('self_harm');
  const without = mandatoryLines(coachInput(ti, { tripwire: sh }), replyJson({ reply: 'Bunu paylaştığın için teşekkür ederim, buradayım.', referral_included: true }));
  assertEquals(without, [{ kind: 'referral', text: REQUIRED_SAFETY_LINE.self_harm }], '112 is a literal requirement; the flag alone is not enough');
  assertEquals(mandatoryLines(coachInput(ti, { tripwire: sh }), replyJson({ reply: "Güvende değilsen hemen 112'yi ara." })), []);
  const em = protectiveTripwire('emergency');
  assertEquals(mandatoryLines(coachInput(ti, { tripwire: em }), replyJson({ reply: 'Hemen dinlen.' }))[0].kind, 'emergency');
  const ed = protectiveTripwire('ed');
  assertEquals(
    mandatoryLines(coachInput(ti, { tripwire: ed }), replyJson({ reply: 'Yanındayım.', referral_included: true })),
    [{ kind: 'referral', text: REQUIRED_SAFETY_LINE.ed }],
    'ED: the coach\'s flag never stands in for the referral — the TEXT has none, so code appends it (§7.2)',
  );
  assertEquals(mandatoryLines(coachInput(ti, { tripwire: ed }), replyJson({ reply: 'Yanındayım.' })), [{ kind: 'referral', text: REQUIRED_SAFETY_LINE.ed }]);
  assertEquals(mandatoryLines(coachInput(ti, { tripwire: ed }), replyJson({ reply: 'Bir diyetisyenle görüşmen iyi olur.' })), []);
  assertEquals(mandatoryLines(coachInput(ti, { tripwire: ed }), replyJson({ reply: 'Bir diyetisyenle görüşmen iyi olur.', referral_included: true })), [], 'a real referral in the text: no duplicate');
  assertEquals(
    mandatoryLines(coachInput(ti, { tripwire: ed }), replyJson({ reply: 'Diyetisyene gitmene hiç gerek yok, yanındayım.', referral_included: true })),
    [{ kind: 'referral', text: REQUIRED_SAFETY_LINE.ed }],
    'a profession waved away is not a referral, whatever the flag says',
  );
  const fb = edFallbackTripwire();
  assert(fb.kind === 'fallback');
  assertEquals(mandatoryLines(coachInput(ti, { tripwire: fb }), replyJson({ reply: 'Akşam hafif bir şey ye.' })), [{ kind: 'referral', text: fb.response.message }]);
  assertEquals(
    mandatoryLines(coachInput(ti, { tripwire: fb }), replyJson({ reply: 'Akşam hafif bir şey ye.', referral_included: true })),
    [{ kind: 'referral', text: fb.response.message }],
    'the fail-closed ED referral is appended even when the coach claims it included one',
  );
  assertEquals(mandatoryLines(coachInput(ti), replyJson()), [], 'a normal turn adds nothing');
  assertEquals(mandatoryLines(coachInput(ti), replyJson({ referral_included: true })), [], 'a stray flag on a normal turn adds nothing either');
});

Deno.test('referral_included is logged against the text, never trusted: a flag-only reply still gets the line', async () => {
  const ti = await seededTurnInput((t) => { t.user_constraints = []; }); // no judge: the referral path alone
  const input = coachInput(ti, { tripwire: protectiveTripwire('ed') });
  const lying = await postcheckReply(input, run(replyJson({ reply: 'Yanındayım, istediğin zaman yaz.', referral_included: true })), {
    judge: null, regen: () => { throw new Error('no regen expected'); },
  });
  assertEquals(lying.log.outcome, 'first');
  assertEquals(lying.codeNotes, [{ kind: 'referral', text: REQUIRED_SAFETY_LINE.ed }]);
  assert(lying.text.endsWith(`\n\n${REQUIRED_SAFETY_LINE.ed}`), 'the referral is the last line');
  assertEquals(lying.log.referral_flag_mismatch, true, 'the shadow sees the flag/text mismatch');
  const honest = await postcheckReply(input, run(replyJson({ reply: 'Bunu bir psikologla konuşman iyi gelebilir.', referral_included: true })), {
    judge: null, regen: () => { throw new Error('no regen expected'); },
  });
  assertEquals([honest.codeNotes, honest.log.referral_flag_mismatch], [[], false]);
  assertEquals(referralFlagMismatch(input, replyJson({ reply: 'Yanındayım.', referral_included: false })), false, 'no claim, no mismatch (the line is still appended)');
});

Deno.test('mandatory allergen-exposure acknowledgement: added unless the reply already warns', async () => {
  const ti = await seededTurnInput();
  const input = coachInput(ti, { commit: commit({ exposures: [{ allergens: ['fıstık'], source: 'meal', ref: 'm4' }] }) });
  const lines = mandatoryLines(input, replyJson({ reply: 'Afiyet olsun, öğle yemeğin kaydedildi.' }));
  assertEquals(lines.length, 1);
  assertEquals(lines[0].kind, 'allergen_exposure');
  assertStringIncludes(lines[0].text, 'ciddi fıstık alerjisi');
  assertStringIncludes(lines[0].text, "112'yi ara", 'a severe allergen gets the reaction line');
  assertEquals(mandatoryLines(input, replyJson({ reply: 'Fıstık alerjin var; bu öğünde fıstık vardı, kendini nasıl hissediyorsun?' })), []);
  const supp = mandatoryLines(coachInput(ti, { commit: commit({ exposures: [{ allergens: ['fıstık'], source: 'supplement', ref: 's2' }] }) }), replyJson({ reply: 'Tamam.' }));
  assertStringIncludes(supp[0].text, 'kaydettiğin takviye');
});

Deno.test('mandatory safety-hold question: appended unless the reply carries the TEMPLATE; never for an ordinary hold the coach owns', async () => {
  const ti = await seededTurnInput();
  const input = coachInput(ti, { commit: commit({ holds: [RETRACT_HOLD, MEAL_HOLD] }) });
  assertEquals(isSafetyHold(RETRACT_HOLD), true);
  assertEquals(isSafetyHold(MEAL_HOLD), false);
  assertEquals(mandatoryLines(input, replyJson({ reply: 'Peki, not ettim.' })), [{ kind: 'safety_hold', text: RETRACT_HOLD.question_tr }]);
  // The coach's own paraphrase is not proof the hold was asked: the template goes in anyway.
  assertEquals(
    mandatoryLines(input, replyJson({ reply: 'Fıstık alerjini kayıtlarından kaldırmamı istediğine emin misin?' })),
    [{ kind: 'safety_hold', text: RETRACT_HOLD.question_tr }],
  );
  // The template itself — case, diacritics and spacing aside — is asked: nothing added.
  assertEquals(mandatoryLines(input, replyJson({ reply: `Tamam, bekletiyorum. ${RETRACT_HOLD.question_tr}` })), []);
  assertEquals(replyAsksHold('BU KAYDI GERCEKTEN kaldirmami  istiyor\nmusun? Guvenlik filtrelerin buna gore degisecek.', RETRACT_HOLD), true);
  assertEquals(replyAsksHold('Kaldırayım mı', RETRACT_HOLD), false, 'no template, not asked');
  assertEquals(replyAsksHold('Akşam ne yemek istiyorsun?', RETRACT_HOLD), false, 'an unrelated question is not the hold question');
  assertEquals(replyAsksHold('Her şey yolunda?', { ...RETRACT_HOLD, question_tr: '' }), false, 'an empty template is never "asked"');
});

Deno.test('safety-hold question: no keyword guess — an unrelated question never stands in for the hold (review cases)', async () => {
  const ti = await seededTurnInput();
  const ERASE: V2Hold = { op: 'account_erase_request', reason_code: 'kvkk_onay', hold_id: 'pw-7', question_tr: 'Hesabını ve tüm verilerini kalıcı olarak silmemi onaylıyor musun?' };
  const BAND: V2Hold = { op: 'target_change', reason_code: 'bant_degisimi', hold_id: 'pw-8', question_tr: 'Günlük aralığını 1.300–1.500 kcal olarak değiştirmemi onaylıyor musun?' };
  const cases: Array<[V2Hold, string]> = [
    [ERASE, 'Anladım. Bugün nasılsın?'],            // "nasılsın" contains "sil"
    [BAND, 'Öğlen kaç kalori aldın?'],             // "kalori"
    [RETRACT_HOLD, 'Bugün ağırlık kaldırdın mı?'], // "kaldır"
  ];
  for (const [hold, reply] of cases) {
    assertEquals(isSafetyHold(hold), true, hold.op);
    assertEquals(replyAsksHold(reply, hold), false, `${hold.op}: "${reply}" is not the hold question`);
    const lines = mandatoryLines(coachInput(ti, { commit: commit({ holds: [hold] }) }), replyJson({ reply }));
    assertEquals(lines, [{ kind: 'safety_hold', text: hold.question_tr }], `${hold.op}: the template is appended, the hold cannot lapse unasked`);
    assert(withCodeNotes(reply, lines).endsWith(hold.question_tr), 'and it is the last line');
  }
});

Deno.test('one question per reply: the safety hold is THE question (facts and code agree), the other waits', async () => {
  const ti = await seededTurnInput();
  const c = commit({ holds: [MEAL_HOLD, RETRACT_HOLD] }); // commit order: ordinary first
  const lines = renderTurnEvents(ti, decision(), c);
  assertStringIncludes(lines[0], `bu bir güvenlik onayı, sorusunu kod cevabın sonuna aynen ekler: "${RETRACT_HOLD.question_tr}"`);
  assertStringIncludes(lines[0], 'Bu soruyu kendin tekrar sorma');
  assertStringIncludes(lines[1], 'bu turun sorusu yukarıdaki, bunu sonraki bir turda sor');
  // An ORDINARY hold that is the turn's question stays the coach's to ask in its own words.
  assertStringIncludes(renderTurnEvents(ti, decision(), commit({ holds: [MEAL_HOLD] }))[0], `sorulacak tek soru: "${MEAL_HOLD.question_tr}"`);
  const failed = await postcheckReply(coachInput(ti, { commit: c }), run(null), { judge: null, regen: () => Promise.resolve(run(null)) });
  assertEquals(failed.codeNotes, [{ kind: 'safety_hold', text: RETRACT_HOLD.question_tr }], 'even a code-authored reply asks only one');
});

Deno.test('lines are appended LAST in order (referral → exposure → hold) and nothing before them changes', async () => {
  const ti = await seededTurnInput();
  const c = commit({ exposures: [{ allergens: ['fıstık'], source: 'meal', ref: 'm4' }], holds: [RETRACT_HOLD] });
  const reply = replyJson({ reply: 'Bunu söylemen kolay değildi.\n\nYanındayım.' });
  // A safety turn: referral, then the exposure; the hold is NOT this turn's question (it waits).
  const safety = mandatoryLines(coachInput(ti, { tripwire: protectiveTripwire('ed'), commit: c }), reply);
  assertEquals(safety.map((n) => n.kind), ['referral', 'allergen_exposure']);
  const facts = renderTurnEvents(ti, decision(), c, true).join('\n');
  assertStringIncludes(facts, 'bu bir güvenlik turu, bu turda sorulmaz');
  // A normal turn: the exposure, then the safety-hold question.
  const normal = mandatoryLines(coachInput(ti, { commit: c }), reply);
  assertEquals(normal.map((n) => n.kind), ['allergen_exposure', 'safety_hold']);
  for (const notes of [safety, normal]) {
    const text = withCodeNotes(reply.reply, notes);
    assert(text.startsWith(reply.reply), 'the coach\'s text is untouched');
    assertEquals(text, [reply.reply, ...notes.map((n) => n.text)].join('\n\n'));
  }
});

Deno.test('lunaJudge: strict schema on the fast tier, store:false; a refusal or an HTTP error is FAILED (fail-closed)', async () => {
  const p = safetyProfileOf(await seededTurnInput());
  const req = { reply: 'Satay dene.', suggested_foods: [{ name: 'satay', allergens: ['peanut'], may_contain: [] }], suggested_exercises: [], profile: p };
  const ok = fakeResponses(() => responsesBody({ violation: true, items: [{ name: 'satay', kind: 'food', constraint: 'fıstık', reason: 'fıstık sosu' }] }));
  const out = await lunaJudge({ transport: ok.transport })(req);
  assertEquals(out.status, 'ok');
  assert(out.status === 'ok' && out.violation && out.items[0].name === 'satay');
  const body = ok.calls[0].body;
  assertEquals(body.model, MODELS.fallback);
  assertEquals(body.store, false);
  assertEquals((body.text as { format: { name: string; strict: boolean } }).format.name, JUDGE_SCHEMA.name);
  assertEquals((body.text as { format: { strict: boolean } }).format.strict, true);
  const user = ((body.input as { role: string; content: string }[])[1]).content;
  assertStringIncludes(user, 'Ciddi alerjiler: fıstık');
  assertStringIncludes(user, 'Sakat bölgeler: diz');
  assertStringIncludes(user, 'satay [peanut]');
  const refused = await lunaJudge({ transport: fakeResponses(() => refusalBody('hayır')).transport })(req);
  assertEquals(refused.status, 'failed');
  const http = await lunaJudge({ transport: fakeResponses(() => new Response('{"error":{"message":"bad"}}', { status: 400 })).transport })(req);
  assertEquals(http.status, 'failed');
});
