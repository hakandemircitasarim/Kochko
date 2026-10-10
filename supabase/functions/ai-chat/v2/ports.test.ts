/**
 * ports.test.ts — the default T7 post-checks and T8 envelope. Pinned: post-checks only APPEND
 * (each appended line is a code note), the required 112/referral line on a protective turn, the
 * KVKK question/outcome lines, the one hold question when the coach asked none, the allergen
 * exposure acknowledgement unless the coach already gave it; the envelope speaks the client's
 * contract (legacy badge names, typed receipts, in-message <reasoning>, whitelisted navigate_to).
 */
import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import { resolveTripwires, scanTripwires } from '../../shared/safety-tripwires.ts';
import type { CommitResult, V2Receipt } from './contracts.ts';
import { defaultEnvelope, defaultPostcheck, messageWithReasoning, navigateToOf, toEnvelopeActions, toEnvelopeReceipts } from './ports.ts';
import { coachReply } from './turn-testing.ts';

const normal = resolveTripwires({ scan: scanTripwires('6 tavuk nugget yedim'), stageA: { status: 'ok', readings: [], positives: [] } });
const commitOf = (over: Partial<CommitResult> = {}): CommitResult => ({ turnId: 't', receipts: [], holds: [], rejects: [], flags: [], writtenRefs: [], exposures: [], ...over });
const meal: V2Receipt = { action_type: 'meal_log', ok: true, rows_affected: 1, user_line: 'Öğün kaydedildi — nugget (6 adet) ~300 kcal · toplam 300 kcal', failure_class: null, ref: 'm4', write_id: 'w', legacy_type: 'meal_log' };
const failedWater: V2Receipt = { action_type: 'water_log', ok: false, rows_affected: 0, user_line: 'Su kaydedilemedi: …', failure_class: 'later_write', legacy_type: 'water_log' };

Deno.test('postcheck: an ordinary reply passes untouched', async () => {
  const out = await defaultPostcheck({ reply: coachReply('Afiyet olsun!'), text: 'Afiyet olsun!', commit: commitOf({ receipts: [meal] }), tripwire: normal, turnInput: null, message: 'x' });
  assertEquals(out.text, 'Afiyet olsun!');
  assertEquals(out.code_notes, []);
});

Deno.test('postcheck: a protective ED turn without a referral gets the line appended LAST (nothing removed)', async () => {
  const msg = 'aç kalmak istiyorum';
  const hit = scanTripwires(msg).hits[0].hit_id;
  const t = resolveTripwires({ scan: scanTripwires(msg), stageA: { status: 'ok', readings: [{ hit_id: hit, reading: 'positive', reason: 'kısıtlama' }], positives: [] } });
  assertEquals(t.kind, 'protective');
  const out = await defaultPostcheck({ reply: coachReply('Bunu duyduğuma üzüldüm.'), text: 'Bunu duyduğuma üzüldüm.', commit: commitOf(), tripwire: t, turnInput: null, message: msg });
  assert(out.text.startsWith('Bunu duyduğuma üzüldüm.'));
  assertStringIncludes(out.text, 'uzman');
  assertEquals(out.code_notes[0].kind, 'referral');
  const already = await defaultPostcheck({ reply: coachReply('Bir diyetisyenle görüşmeni öneririm.'), text: 'Bir diyetisyenle görüşmeni öneririm.', commit: commitOf(), tripwire: t, turnInput: null, message: msg });
  assertEquals(already.code_notes, [], 'the reply already refers: nothing appended');
});

Deno.test('postcheck: a hold whose question the coach did not ask → the question appended once; asked → nothing', async () => {
  const hold = { op: 'water_log', reason_code: 'tek_seferde_cok', question_tr: 'Bu kadarını tek seferde mi içtin, yoksa günün toplamı mı?', hold_id: 'pw' };
  const silent = await defaultPostcheck({ reply: coachReply('Not aldım.'), text: 'Not aldım.', commit: commitOf({ holds: [hold] }), tripwire: normal, turnInput: null, message: 'x' });
  assert(silent.text.endsWith(hold.question_tr));
  assertEquals(silent.code_notes.map((n) => n.kind), ['safety_hold']);
  const asked = await defaultPostcheck({ reply: coachReply('2 litreyi tek seferde mi içtin?'), text: '2 litreyi tek seferde mi içtin?', commit: commitOf({ holds: [hold] }), tripwire: normal, turnInput: null, message: 'x' });
  assertEquals(asked.code_notes, []);
});

Deno.test('postcheck: the KVKK erase question and outcome are code-owned lines, always appended', async () => {
  const erase = { op: 'account_erase_request', reason_code: 'kvkk_onay', question_tr: 'Emin olmak için soruyorum: …?', hold_id: 'pw' };
  const out = await defaultPostcheck({ reply: coachReply('Tamam, anladım?'), text: 'Tamam, anladım?', commit: commitOf({ holds: [erase] }), tripwire: normal, turnInput: null, message: 'x' });
  assert(out.text.endsWith(erase.question_tr), 'even when the coach asked something else');
  const done: V2Receipt = { action_type: 'pending_confirm', ok: true, rows_affected: 1, user_line: 'Onayın üzerine … sıfırladım.', failure_class: null, legacy_type: 'data_erase_confirm' };
  const out2 = await defaultPostcheck({ reply: coachReply('Tamam.'), text: 'Tamam.', commit: commitOf({ receipts: [done] }), tripwire: normal, turnInput: null, message: 'evet' });
  assert(out2.text.endsWith('sıfırladım.'));
});

Deno.test('postcheck: allergen exposure acknowledged by code unless the coach already warned', async () => {
  const exp = { allergens: ['fıstık'], source: 'meal' as const, ref: 'm4' };
  const out = await defaultPostcheck({ reply: coachReply('Afiyet olsun!'), text: 'Afiyet olsun!', commit: commitOf({ exposures: [exp] }), tripwire: normal, turnInput: null, message: 'x' });
  assertStringIncludes(out.text, "112'yi ara");
  assertEquals(out.code_notes[0].kind, 'allergen_exposure');
  const warned = await defaultPostcheck({ reply: coachReply('Dikkat, fıstık alerjin var!'), text: 'Dikkat, fıstık alerjin var!', commit: commitOf({ exposures: [exp] }), tripwire: normal, turnInput: null, message: 'x' });
  assertEquals(warned.code_notes, []);
});

Deno.test('envelope: legacy badge names, typed receipts (a failed write has no green action), reasoning, navigate whitelist', () => {
  const commit = commitOf({ receipts: [meal, failedWater] });
  assertEquals(toEnvelopeActions(commit), [{ type: 'meal_log', feedback: meal.user_line }]);
  assertEquals(toEnvelopeReceipts(commit).map((r) => [r.action_type, r.ok, r.failure_class]), [['meal_log', true, null], ['water_log', false, 'later_write']]);
  const env = defaultEnvelope({ text: 'Afiyet olsun!', commit, reply: coachReply('Afiyet olsun!', { why: 'öğün kaydı', ui: { navigate_to: '/plan/diet' } }), taskMode: 'register', assistantMessageId: 'a1', remaining: -1 });
  assertEquals(env.message, '<reasoning>öğün kaydı</reasoning>\nAfiyet olsun!');
  assertEquals(env.navigate_to, '/plan/diet');
  assertEquals(env.remaining, -1);
  assertEquals(env.assistant_message_id, 'a1');
  assertEquals(env.task_mode, 'register');
  assertEquals(navigateToOf(coachReply('x', { ui: { navigate_to: 'https://evil.example' } })), null);
  assertEquals(messageWithReasoning('m', 'a</reasoning>b'), '<reasoning>ab</reasoning>\nm');
  const none = defaultEnvelope({ text: 'x', commit: null, reply: null, taskMode: 'coaching', assistantMessageId: null, remaining: undefined });
  assertEquals(none.receipts, null);
  assert(!('remaining' in none));
});
