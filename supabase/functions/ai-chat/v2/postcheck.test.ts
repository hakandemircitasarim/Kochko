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
  JUDGE_SCHEMA, type JudgeOutcome, lunaJudge, mandatoryLines, postcheckReply, type ProseJudge, type RegenNote,
  replyAsksHold, SAFE_FALLBACK_VARIANTS, safetyProfileOf, suggestionViolations, withCodeNotes,
} from './postcheck.ts';
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
  assertEquals(mandatoryLines(coachInput(ti, { tripwire: ed }), replyJson({ reply: 'Yanındayım.', referral_included: true })), [], 'ED: the coach\'s structured flag counts');
  assertEquals(mandatoryLines(coachInput(ti, { tripwire: ed }), replyJson({ reply: 'Yanındayım.' })), [{ kind: 'referral', text: REQUIRED_SAFETY_LINE.ed }]);
  assertEquals(mandatoryLines(coachInput(ti, { tripwire: ed }), replyJson({ reply: 'Bir diyetisyenle görüşmen iyi olur.' })), []);
  const fb = edFallbackTripwire();
  assert(fb.kind === 'fallback');
  assertEquals(mandatoryLines(coachInput(ti, { tripwire: fb }), replyJson({ reply: 'Akşam hafif bir şey ye.' })), [{ kind: 'referral', text: fb.response.message }]);
  assertEquals(mandatoryLines(coachInput(ti), replyJson()), [], 'a normal turn adds nothing');
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

Deno.test('mandatory safety-hold question: added when the coach did not ask it; never for an ordinary hold the coach owns', async () => {
  const ti = await seededTurnInput();
  const input = coachInput(ti, { commit: commit({ holds: [RETRACT_HOLD, MEAL_HOLD] }) });
  assertEquals(isSafetyHold(RETRACT_HOLD), true);
  assertEquals(isSafetyHold(MEAL_HOLD), false);
  assertEquals(mandatoryLines(input, replyJson({ reply: 'Peki, not ettim.' })), [{ kind: 'safety_hold', text: RETRACT_HOLD.question_tr }]);
  assertEquals(mandatoryLines(input, replyJson({ reply: 'Fıstık alerjini kayıtlarından kaldırmamı istediğine emin misin?' })), []);
  assertEquals(replyAsksHold('Kaldırayım mı', RETRACT_HOLD), false, 'no question mark, not asked');
  assertEquals(replyAsksHold('Akşam ne yemek istiyorsun?', RETRACT_HOLD), false, 'an unrelated question is not the hold question');
});

Deno.test('one question per reply: the safety hold is THE question (facts and code agree), the other waits', async () => {
  const ti = await seededTurnInput();
  const c = commit({ holds: [MEAL_HOLD, RETRACT_HOLD] }); // commit order: ordinary first
  const lines = renderTurnEvents(ti, decision(), c);
  assertStringIncludes(lines[0], `sorulacak tek soru: "${RETRACT_HOLD.question_tr}"`);
  assertStringIncludes(lines[1], 'bu turun sorusu yukarıdaki, bunu sonraki bir turda sor');
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
