/**
 * guarantees.test.ts — the handler's FINAL T7 step (AI_MIMARI_V2 §3.2 T7, §5.2, §7.1, §7.2).
 *
 * Pinned: whatever a post-check port returns, applyGuarantees appends the code-owned lines LAST and
 * only when missing — 112 / referral (by the TEXT, never the model's flag), the KVKK erase outcome,
 * the allergen-exposure acknowledgement, EVERY safety hold's template question on a normal turn (none
 * on a safety turn) — never removing a character of the port's text or notes; a reply whose suggestion
 * lists break §7.1 (or carry suggestions while the spine is unreadable) is replaced by the code's
 * fallback; with the default port's output it adds nothing (idempotent).
 */
import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { REQUIRED_SAFETY_LINE } from '../../shared/safety-tripwires.ts';
import type { CodeNote } from '../../shared/v2-db-types.ts';
import type { CoachReply, PostcheckOutput, V2Hold, V2Receipt } from './contracts.ts';
import {
  applyGuarantees, exposureLine, mandatoryLines, SAFE_FALLBACK_VARIANTS, safetyLines, safetyProfileOf, suggestionCheck, SUGGESTION_UNVERIFIED_LINE,
  withCodeNotes,
} from './guarantees.ts';
import { emptyPostcheckLog, postcheckReply } from './postcheck.ts';
import { coachInput, commit, edFallbackTripwire, protectiveTripwire, replyJson, seededTurnInput } from './stage-b-testing.ts';

const RETRACT: V2Hold = { op: 'constraint_retract', reason_code: 'iki_adimli_kaldirma', hold_id: 'pw-1', question_tr: 'Fıstık alerjini kayıtlardan kaldırmamı onaylıyor musun?' };
const GOAL: V2Hold = { op: 'goal_set', reason_code: 'hedef_degisiyor', hold_id: 'pw-2', question_tr: 'Hedefini kilo almaya çevireyim mi?' };
const IDENTITY: V2Hold = { op: 'profile_set', reason_code: 'kimlik_degisimi', hold_id: 'pw-3', question_tr: 'Doğum yılını 1990 olarak düzelteyim mi?', hold_class: 'safety' };
const PORTION: V2Hold = { op: 'meal_log', reason_code: 'ogun_toplam_yuksek', hold_id: 'pw-4', question_tr: 'Porsiyonu doğru anladım mı?' };
const EXPOSURE = { allergens: ['peanut'], source: 'meal' as const, ref: 'm4' };
const ERASE_DONE: V2Receipt = { action_type: 'pending_confirm', ok: true, rows_affected: 1, user_line: 'Onayın üzerine hakkında tuttuğum koç hafızasını sıfırladım.', failure_class: null, legacy_type: 'data_erase_confirm' };

/** What a port that kept nothing of the contract would hand back. */
function dropped(reply: CoachReply, codeNotes: CodeNote[] = []): PostcheckOutput {
  return { reply, codeNotes, codeAuthored: false, log: emptyPostcheckLog('first') };
}

Deno.test('a port that drops everything: 112, erase outcome, exposure and every safety-hold question come back LAST, in order', async () => {
  const ti = await seededTurnInput();
  const t = protectiveTripwire('emergency');
  // The protective turn: 112 + the exposure; no hold question next to a crisis reply.
  const crisis = applyGuarantees(coachInput(ti, { tripwire: t, commit: commit({ exposures: [EXPOSURE], holds: [RETRACT] }) }), dropped(replyJson({ reply: 'Hemen otur, yanında biri var mı?' })));
  assertEquals(crisis.codeNotes.map((n) => n.kind), ['emergency', 'allergen_exposure']);
  assert(crisis.text.startsWith('Hemen otur, yanında biri var mı?'), 'the reply untouched');
  assert(!crisis.text.includes(RETRACT.question_tr), 'the hold waits on a safety turn');
  // A normal turn: the erase outcome, the exposure, then EVERY safety hold — the questions last.
  const normal = applyGuarantees(
    coachInput(ti, { commit: commit({ receipts: [ERASE_DONE], exposures: [EXPOSURE], holds: [PORTION, RETRACT, GOAL, IDENTITY] }) }),
    dropped(replyJson({ reply: 'Tamam. Bugün nasılsın?' })),
  );
  assertEquals(normal.codeNotes.map((n) => n.kind), ['other', 'allergen_exposure', 'safety_hold', 'safety_hold', 'safety_hold']);
  assertEquals(normal.codeNotes.slice(2).map((n) => n.text), [RETRACT.question_tr, GOAL.question_tr, IDENTITY.question_tr]);
  assert(!normal.text.includes(PORTION.question_tr), 'the ordinary hold is the coach\'s to ask (it waits; safe by construction)');
  assertEquals(normal.text, withCodeNotes('Tamam. Bugün nasılsın?', normal.codeNotes));
  assertEquals(normal.added, normal.codeNotes, 'every line was added by the code-owned step');
  assert(normal.issues.includes('guarantee_line:safety_hold'));
});

Deno.test('the 112 / referral line is judged by the TEXT: a model flag never stands in, a real line is never doubled', async () => {
  const ti = await seededTurnInput();
  const ed = protectiveTripwire('ed');
  const flagOnly = applyGuarantees(coachInput(ti, { tripwire: ed }), dropped(replyJson({ reply: 'Yanındayım.', referral_included: true })));
  assertEquals(flagOnly.codeNotes, [{ kind: 'referral', text: REQUIRED_SAFETY_LINE.ed }]);
  const real = applyGuarantees(coachInput(ti, { tripwire: ed }), dropped(replyJson({ reply: 'Bunu bir diyetisyenle konuşman iyi gelebilir.' })));
  assertEquals(real.codeNotes, []);
  const fb = edFallbackTripwire();
  assert(fb.kind === 'fallback');
  const append = applyGuarantees(coachInput(ti, { tripwire: fb }), dropped(replyJson({ reply: 'Akşam hafif bir şey ye.' })));
  assertEquals(append.codeNotes, [{ kind: 'referral', text: fb.response.message }]);
});

Deno.test('the 112 line: a reply that merely contains "112" — even waving it away — does not count; the code-owned line is appended', async () => {
  const ti = await seededTurnInput();
  for (const cat of ['emergency', 'self_harm'] as const) {
    const t = protectiveTripwire(cat);
    for (const reply of ["112'yi aramana gerek yok, biraz uzan geçer.", "Gerekirse 112'yi ararsın ama bence önemli değil.", "Lütfen hemen 112'yi ara."]) {
      const out = applyGuarantees(coachInput(ti, { tripwire: t }), dropped(replyJson({ reply })));
      assertEquals(out.codeNotes, [{ kind: cat === 'emergency' ? 'emergency' : 'referral', text: REQUIRED_SAFETY_LINE[cat] }], `${cat}: ${reply}`);
      assert(out.text.startsWith(reply) && out.text.endsWith(REQUIRED_SAFETY_LINE[cat]), 'append-only, the line LAST');
    }
    // The canonical line already in the text (e.g. a port that appended it): never doubled.
    const has = applyGuarantees(coachInput(ti, { tripwire: t }), dropped(replyJson({ reply: `Yanındayım.\n\n${REQUIRED_SAFETY_LINE[cat]}` })));
    assertEquals(has.codeNotes, []);
  }
  // safetyLines is the single source the crash path reuses: same lines for the same text.
  const t = protectiveTripwire('emergency');
  assertEquals(safetyLines(t, "112'yi aramana gerek yok."), [{ kind: 'emergency', text: REQUIRED_SAFETY_LINE.emergency }]);
  assertEquals(safetyLines(coachInput(ti).tripwire, 'Merhaba.'), [], 'a normal turn needs no safety line');
});

Deno.test('append-only: the port\'s own notes are kept as they are, the code-owned step only adds what is missing', async () => {
  const ti = await seededTurnInput();
  const input = coachInput(ti, { commit: commit({ exposures: [EXPOSURE], holds: [RETRACT] }) });
  const portNote: CodeNote = { kind: 'other', text: 'Su kaydedilmedi: 250 L su olamaz.' };
  const exposure: CodeNote = { kind: 'allergen_exposure', text: exposureLine(EXPOSURE, true) };
  const out = applyGuarantees(input, dropped(replyJson({ reply: 'Peki.' }), [portNote, exposure]));
  assertEquals(out.codeNotes, [portNote, exposure, { kind: 'safety_hold', text: RETRACT.question_tr }], 'kept, kept, and the missing question added');
  assertEquals(out.added.map((n) => n.kind), ['safety_hold']);
  // Junk a port might hand back is not a note.
  const junk = applyGuarantees(input, dropped(replyJson({ reply: 'Peki.' }), [{ kind: 'nope', text: 'x' } as unknown as CodeNote, { kind: 'other', text: '  ' }]));
  assertEquals(junk.codeNotes.map((n) => n.kind), ['allergen_exposure', 'safety_hold']);
});

Deno.test('idempotent over the default port: postcheckReply\'s own lines leave the code-owned step nothing to add', async () => {
  const ti = await seededTurnInput((t) => { t.user_constraints = []; }); // no judge needed: the model's reply goes out
  const input = coachInput(ti, { tripwire: protectiveTripwire('ed'), commit: commit({ exposures: [EXPOSURE] }) });
  const run = { status: 'ok' as const, reply: replyJson({ reply: 'Yanındayım.', referral_included: true }), model: 'm', effort: 'low' as const, contract: null, latencyMs: 1, usage: null, attempts: 1, retries: [], detail: null, regen: false };
  const port = await postcheckReply(input, run, { judge: null, regen: () => Promise.resolve(run) });
  assertEquals([port.log.outcome, port.codeNotes.map((n) => n.kind)], ['first', ['referral', 'allergen_exposure']]);
  const final = applyGuarantees(input, port);
  assertEquals(final.added, []);
  assertEquals(final.text, port.text);
  assertEquals(final.codeNotes, port.codeNotes);
});

Deno.test('the safety-hold question counts as asked only when the TEMPLATE is in the text (an unrelated "?" never does)', async () => {
  const ti = await seededTurnInput();
  const input = coachInput(ti, { commit: commit({ holds: [RETRACT] }) });
  assertEquals(applyGuarantees(input, dropped(replyJson({ reply: 'Kaç kalori aldın bugün?' }))).added.map((n) => n.kind), ['safety_hold']);
  assertEquals(applyGuarantees(input, dropped(replyJson({ reply: `Bekletiyorum. ${RETRACT.question_tr}` }))).added, []);
});

Deno.test('§7.1 re-checked on structure: a violating suggestion list never goes out, whatever the port claims', async () => {
  const ti = await seededTurnInput();
  const peanut = replyJson({ reply: 'Fıstık ezmeli tost ye.', suggested_foods: [{ name: 'fıstık ezmeli tost', allergens: [], may_contain: [] }], memory: [{ x: 1 }], why: 'gizli' });
  const out = applyGuarantees(coachInput(ti, { commit: commit({ holds: [PORTION] }) }), dropped(peanut));
  assertEquals(out.codeAuthored, true);
  assertEquals(out.reply.suggested_foods, []);
  assertEquals(out.reply.memory, [], 'no durable note from a draft that failed the check');
  assertEquals(out.reply.why, null);
  assertStringIncludes(out.reply.reply, SAFE_FALLBACK_VARIANTS[0]('fıstık alerjin ve diz sakatlığın'));
  assertEquals(out.codeNotes, [{ kind: 'other', text: PORTION.question_tr }], 'a code-authored reply asks the one ordinary question too');
  assert(out.issues.includes('guarantee_suggestion_violation'));
  // On the protective path: the ready-made safety reply instead.
  const t = protectiveTripwire('self_harm');
  assert(t.kind === 'protective');
  const crisis = applyGuarantees(coachInput(ti, { tripwire: t }), dropped(peanut));
  assertEquals(crisis.reply.reply, t.fallback.message);
  assertEquals(crisis.codeNotes, [], 'the ready-made reply already carries 112');
});

Deno.test('an unreadable spine: suggestions are unverifiable → the honest "could not check" reply; prose alone passes', async () => {
  const ti = await seededTurnInput();
  ti.load_errors.push({ section: 'constraints', message: 'timeout' });
  const profile = safetyProfileOf(ti);
  assertEquals(profile.unknown, true);
  const withList = replyJson({ suggested_foods: [{ name: 'yoğurt', allergens: ['milk'], may_contain: [] }] });
  assertEquals(suggestionCheck(withList, profile), { ok: false, reason: 'unverified' });
  const out = applyGuarantees(coachInput(ti), dropped(withList));
  assertEquals(out.reply.reply, SUGGESTION_UNVERIFIED_LINE);
  assertEquals(applyGuarantees(coachInput(ti), dropped(replyJson({ reply: 'Merhaba!' }))).reply.reply, 'Merhaba!');
});

Deno.test('an unusable port output (no reply text) → the code\'s honest reply, and the code-owned lines still', async () => {
  const ti = await seededTurnInput();
  const input = coachInput(ti, { commit: commit({ holds: [RETRACT] }) });
  const out = applyGuarantees(input, { reply: { reply: '   ' } as CoachReply, codeNotes: [], codeAuthored: false, log: emptyPostcheckLog('first') });
  assert(out.issues.includes('guarantee_unusable_reply'));
  assert(out.text.endsWith(RETRACT.question_tr));
  const none = applyGuarantees(input, null);
  assertEquals(none.codeAuthored, true);
  assert(none.text.endsWith(RETRACT.question_tr));
});

Deno.test('mandatoryLines with existing notes is idempotent; the erase outcome is never doubled', async () => {
  const ti = await seededTurnInput();
  const input = coachInput(ti, { commit: commit({ receipts: [ERASE_DONE], exposures: [EXPOSURE], holds: [RETRACT] }) });
  const reply = replyJson({ reply: 'Tamam.' });
  const first = mandatoryLines(input, reply);
  assertEquals(first.map((n) => n.kind), ['other', 'allergen_exposure', 'safety_hold']);
  assertEquals(mandatoryLines(input, reply, { existing: first }), []);
  assertEquals(mandatoryLines(input, replyJson({ reply: `Tamam. ${ERASE_DONE.user_line}` })).map((n) => n.kind), ['allergen_exposure', 'safety_hold']);
});

Deno.test('exposureLine: one label per allergen (a same-turn declaration is in the spine by id and by word)', () => {
  const line = exposureLine({ allergens: ['sesame', 'susam'], source: 'meal', ref: 'm9' }, true);
  assertStringIncludes(line, 'ciddi susam alerjisi kayıtlı ve kaydettiğin öğün susam içeriyor');
});
