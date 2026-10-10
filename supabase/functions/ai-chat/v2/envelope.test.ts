/**
 * envelope.test.ts — T8 client compatibility (AI_MIMARI_V2 §3.2 T8, §9.4 D, §11 risk 13).
 *
 * The app does not change for v2, so the envelope is pinned three ways:
 *   1. SNAPSHOTS of whole envelopes (key order = v1's responseData, read from index.ts);
 *   2. the CLIENT'S OWN PARSERS — copied here verbatim and checked against ChatThreadScreen.tsx /
 *      chat.service.ts source, so a client edit breaks this test instead of a live chat;
 *   3. the badge vocabulary — every BADGE_DEFS key has a v2 producer under the same legacy name, and
 *      the meal receipt keeps 'Öğün kaydedildi' byte-identical from the registry to the screen.
 */
import { assert, assertEquals, assertStringIncludes } from 'https://deno.land/std@0.208.0/assert/mod.ts';
import type { TurnEnvelope } from '../../shared/contracts/turn-envelope.ts';
import { CANNED_SAFETY } from '../../shared/safety-tripwires.ts';
import { MEAL_LOGGED_MARK, receiptLine, REGISTRY, validateDecision } from '../../shared/write-registry/mod.ts';
import {
  envelopeActions, mealConfidence, planHonestyLine, renderCannedEnvelope, renderEnvelope, renderMessage, stripMachineMarkers,
  v2TaskMode, VALID_NAVIGATE_ROUTES,
} from './envelope.ts';
import { validationContext } from './input.ts';
import type { V2Receipt } from './contracts.ts';
import { commit, decision, mealWrite, normalTripwire, NOW, protectiveTripwire, seededTurnInput } from './stage-b-testing.ts';

const root = new URL('../../../../', import.meta.url);
const CLIENT = Deno.readTextFileSync(new URL('src/screens/ChatThreadScreen.tsx', root));
const CHAT_SERVICE = Deno.readTextFileSync(new URL('src/services/chat.service.ts', root));
const V1 = Deno.readTextFileSync(new URL('supabase/functions/ai-chat/index.ts', root));

// ── the client's parsers, verbatim (each source line is asserted to still exist in the app) ────────

const CLIENT_LINES = [
  "const match = content.match(/<simulation>([\\s\\S]*?)<\\/simulation>/);",
  "const cleanContent = content.replace(/<simulation>[\\s\\S]*?<\\/simulation>/, '').trim();",
  "const match = content.match(/<reasoning>([\\s\\S]*?)<\\/reasoning>/);",
  "const cleanContent = content.replace(/<reasoning>[\\s\\S]*?<\\/reasoning>/, '').trim();",
  "return !!content.match(/<confirm_reject\\s*\\/?>/) || taskMode === 'plan_suggestion';",
  ".replace(/<confirm_reject\\s*\\/?>/g, '')",
];

function parseSimulationData(content: string): { cleanContent: string; data: Record<string, unknown> | null } {
  const match = content.match(/<simulation>([\s\S]*?)<\/simulation>/);
  if (!match) return { cleanContent: content, data: null };
  try {
    const data = JSON.parse(match[1]);
    const cleanContent = content.replace(/<simulation>[\s\S]*?<\/simulation>/, '').trim();
    return { cleanContent, data };
  } catch {
    return { cleanContent: content, data: null };
  }
}
function parseReasoning(content: string): { cleanContent: string; reasoning: string | null } {
  const match = content.match(/<reasoning>([\s\S]*?)<\/reasoning>/);
  if (!match) return { cleanContent: content, reasoning: null };
  const reasoning = match[1].trim();
  const cleanContent = content.replace(/<reasoning>[\s\S]*?<\/reasoning>/, '').trim();
  return { cleanContent, reasoning: reasoning || null };
}
function hasConfirmRejectIndicator(content: string, taskMode?: string): boolean {
  return !!content.match(/<confirm_reject\s*\/?>/) || taskMode === 'plan_suggestion';
}
function clientStripMachineMarkers(text: string): string {
  return text.replace(/<confirm_reject\s*\/?>/g, '').trim();
}

/** ChatThreadScreen's live path (≈1371-1404): what the user sees, the card, the "Neden?" text, the buttons. */
function clientLive(env: TurnEnvelope) {
  let messageContent = env.message;
  let simulationData = env.simulation ?? null;
  const sim = parseSimulationData(messageContent);
  messageContent = sim.cleanContent;
  if (!simulationData) simulationData = sim.data as typeof simulationData;
  const r = parseReasoning(messageContent);
  messageContent = r.cleanContent;
  const hasPlanSuggestion = hasConfirmRejectIndicator(messageContent, env.task_mode);
  messageContent = clientStripMachineMarkers(messageContent);
  return { visible: messageContent, reasoning: r.reasoning, simulationData, hasPlanSuggestion };
}

/** The history-reload path (toUIMessage + parseSimulationData fallback): the stored text alone. */
function clientReload(stored: string, taskMode: string) {
  let content = stored;
  const r = content.includes('<reasoning>') ? parseReasoning(content) : { cleanContent: content, reasoning: null };
  content = r.cleanContent;
  const hasPlan = hasConfirmRejectIndicator(content, taskMode);
  content = clientStripMachineMarkers(content);
  const sim = parseSimulationData(content);
  return { visible: sim.cleanContent, reasoning: r.reasoning, simulation: sim.data, hasPlan };
}

Deno.test('the copied client parsers are still the app\'s parsers (drift guard)', () => {
  for (const line of CLIENT_LINES) {
    assert(CLIENT.includes(line) || CHAT_SERVICE.includes(line), `client no longer contains: ${line}`);
  }
});

// ── fixtures ───────────────────────────────────────────────────────────────────────────────────────

const MEAL_RECEIPT: V2Receipt = {
  action_type: 'meal_log', legacy_type: 'meal_log', ok: true, rows_affected: 1, failure_class: null, ref: 'm4', write_id: 'tw-1',
  user_line: 'Öğün kaydedildi — tavuk nugget (6 adet) ~300 kcal · toplam 300 kcal',
};
const WEIGHT_FAILED: V2Receipt = {
  action_type: 'body_weight', legacy_type: 'weight_log', ok: false, rows_affected: 0, failure_class: 'write_failed', user_line: 'Tartı kaydedilemedi',
};

const V1_KEYS = (() => {
  const s = V1.indexOf('const responseData = {');
  const e = V1.indexOf('\n    };', s);
  // `key: value` and shorthand `key,` (v1 writes `simulation,`).
  return [...V1.slice(s, e).matchAll(/^\s{6}([a-z_]+)(?::|,$)/gm)].map((m) => m[1]);
})();

// ── snapshots ──────────────────────────────────────────────────────────────────────────────────────

Deno.test('snapshot: a meal turn — v1 key order, legacy action types, receipts, reasoning in the message', () => {
  const env = renderEnvelope({
    text: '~300 kcal saydım; akşam için proteinin tamam.',
    why: 'Bugün proteinin hedefin altındaydı.',
    commit: commit({ receipts: [MEAL_RECEIPT, WEIGHT_FAILED] }),
    decision: decision({ intent: { primary: 'report' }, writes: [mealWrite([['tavuk nugget', 300, 18]])] }),
    tripwire: normalTripwire(),
    remaining: -1,
    assistantMessageId: 'msg-1',
  });
  assertEquals(Object.keys(env), V1_KEYS, 'same keys, same order as v1 responseData');
  assertEquals(JSON.stringify(env), JSON.stringify({
    message: '~300 kcal saydım; akşam için proteinin tamam.\n<reasoning>Bugün proteinin hedefin altındaydı.</reasoning>',
    actions: [
      { type: 'meal_log', feedback: 'Öğün kaydedildi — tavuk nugget (6 adet) ~300 kcal · toplam 300 kcal', confidence: 'medium' },
      { type: 'weight_log', feedback: 'Tartı kaydedilemedi' },
    ],
    receipts: [
      { action_type: 'meal_log', ok: true, rows_affected: 1, user_line: 'Öğün kaydedildi — tavuk nugget (6 adet) ~300 kcal · toplam 300 kcal', failure_class: null },
      { action_type: 'weight_log', ok: false, rows_affected: 0, user_line: 'Tartı kaydedilemedi', failure_class: 'write_failed' },
    ],
    assistant_message_id: 'msg-1',
    task_mode: 'register',
    task_completion: null,
    plan_snapshot: null,
    plan_draft_id: null,
    plan_type: null,
    plan_reasoning: null,
    plan_persist_error: null,
    plan_approved: null,
    navigate_to: null,
    simulation: null,
    remaining: -1,
  }));
  const live = clientLive(env);
  assertEquals(live.visible, '~300 kcal saydım; akşam için proteinin tamam.');
  assertEquals(live.reasoning, 'Bugün proteinin hedefin altındaydı.');
  assertEquals(live.hasPlanSuggestion, false);
  const reload = clientReload(env.message, env.task_mode);
  assertEquals([reload.visible, reload.reasoning, reload.hasPlan], [live.visible, live.reasoning, false]);
});

Deno.test('snapshot: a what-if — <simulation> JSON parses to the same card on the live AND the reload path', () => {
  const simulation = { foodName: 'pizza', calories: 900, remaining: -75, weeklyImpact: 'Yersen bugünkü hedefi 75 kcal aşar.' };
  const env = renderEnvelope({
    text: 'Dilim başı ~300 kcal; iki dilimde kalırsan rahat sığar.',
    decision: decision({ intent: { primary: 'hypothetical', is_hypothetical: true }, simulation: { food: 'pizza', kcal_estimate: 900, target_day: '2026-10-07' } }),
    simulation,
  });
  assertEquals(env.task_mode, 'simulation');
  assertEquals(env.message, `Dilim başı ~300 kcal; iki dilimde kalırsan rahat sığar.\n<simulation>${JSON.stringify(simulation)}</simulation>`);
  assertEquals(clientLive(env).simulationData, simulation);
  const reload = clientReload(env.message, env.task_mode);
  assertEquals(reload.simulation, simulation);
  assertEquals(reload.visible, 'Dilim başı ~300 kcal; iki dilimde kalırsan rahat sığar.');
});

Deno.test('confirm_reject: exactly once, only for a persisted draft awaiting a decision; a stray model marker never survives', () => {
  const plan = { snapshot: { days: [1, 2, 3, 4, 5, 6, 7], targets: { kcal: 1850 } }, draftId: 'wp-9', type: 'workout' as const };
  const proposal = renderEnvelope({ text: 'Taslak hazır <confirm_reject/> göz at.', plan });
  assertEquals(proposal.message.split('<confirm_reject/>').length - 1, 1);
  assert(proposal.message.endsWith('\n<confirm_reject/>'));
  assertEquals(proposal.task_mode, 'plan_workout', 'the client derives the plan type from task_mode');
  assertEquals([proposal.plan_draft_id, proposal.plan_type], ['wp-9', 'workout']);
  const live = clientLive(proposal);
  assertEquals(live.hasPlanSuggestion, true);
  assertEquals(live.visible, 'Taslak hazır  göz at.');
  assertEquals(clientReload(proposal.message, proposal.task_mode).hasPlan, true, 'history reload still draws the buttons');

  for (const env of [
    renderEnvelope({ text: 'Onaylandı <confirm_reject />', plan: { ...plan, approvalTurn: true, approved: { id: 'wp-9' } } }),
    renderEnvelope({ text: 'Plan yok ama <confirm_reject> yazdım' }),
    renderEnvelope({ text: 'taslak <confirm_reject/>', plan: { ...plan, snapshot: null } }),
  ]) {
    assert(!hasConfirmRejectIndicator(env.message, env.task_mode), env.message);
  }
});

Deno.test('model-emitted machine blocks are removed before ours are written (marker hygiene, prose kept)', () => {
  const dirty = 'Merhaba <simulation>{"foodName":"x","calories":1,"remaining":1,"weeklyImpact":"uydurma"}</simulation>dünya <reasoning>gizli</reasoning><navigate_to>{"route":"/x"}</navigate_to> sonu <confirm_reject  />';
  assertEquals(stripMachineMarkers(dirty), 'Merhaba dünya  sonu');
  const env = renderEnvelope({ text: dirty, why: 'neden </reasoning><confirm_reject/> böyle' });
  const live = clientLive(env);
  assertEquals(live.simulationData, null, 'no card from model numbers');
  assertEquals(live.reasoning, 'neden ‹/reasoning› böyle', 'a why cannot close its own block early');
  assertEquals(live.hasPlanSuggestion, false);
  // Unclosed blocks are prose, not markers: left alone.
  assertEquals(stripMachineMarkers('a <reasoning> b'), 'a <reasoning> b');
  assertEquals(renderMessage({ text: 'x', confirmReject: false }), 'x');
});

Deno.test('Öğün kaydedildi: byte-identical from the registry receipt line, through the envelope, to the client badge', async () => {
  assertEquals(MEAL_LOGGED_MARK, 'Öğün kaydedildi');
  assertStringIncludes(V1, "const MEAL_LOGGED_MARK = 'Öğün kaydedildi';");
  assertStringIncludes(CLIENT, "meal_log: { icon: 'restaurant-outline', done: 'Öğün kaydedildi'");
  const ti = await seededTurnInput();
  const d = decision({ intent: { primary: 'report' }, writes: [mealWrite([['tavuk nugget', 300, 18]], { raw: '6 tavuk nugget' })] });
  const v = validateDecision(d, validationContext(ti, '6 tavuk nugget yedim', NOW)).verdicts.find((x) => x.op === 'meal_log')!;
  assert(v.verdict === 'COMMIT' || v.verdict === 'FLAG', v.verdict);
  const line = receiptLine(v, { today: ti.day })!;
  const env = renderEnvelope({ text: 'Afiyet olsun.', decision: d, commit: commit({ receipts: [{ ...MEAL_RECEIPT, user_line: line, legacy_type: v.envelope }] }) });
  const fb = env.actions[0].feedback!;
  assert(fb.startsWith(`${MEAL_LOGGED_MARK} — `), fb);
  assertEquals(new TextEncoder().encode(fb.slice(0, MEAL_LOGGED_MARK.length)), new TextEncoder().encode('Öğün kaydedildi'));
  assertEquals(env.actions[0].type, 'meal_log');
});

Deno.test('BADGE_DEFS: every client badge type has a v2 producer under the same legacy name; receipts use it too', () => {
  const start = CLIENT.indexOf('const BADGE_DEFS');
  const block = CLIENT.slice(start, CLIENT.indexOf('};', start));
  const badgeKeys = [...block.matchAll(/^\s{4}([a-z_]+): \{ icon:/gm)].map((m) => m[1]);
  assert(badgeKeys.length >= 9, badgeKeys.join(','));
  const legacy = new Set<string>();
  for (const o of REGISTRY) {
    for (const args of [{}, { kind: 'allergen' }, { kind: 'injury' }, { kind: 'dietary' }, { program: 'maintenance_start' }]) {
      try { legacy.add(o.envelopeFor(args)); } catch { /* an args-dependent envelope that needs other fields */ }
    }
  }
  for (const k of badgeKeys) assert(legacy.has(k), `BADGE_DEFS.${k} has no v2 producer`);
  // A failed weigh-in is red on the screen: receipts carry the SAME legacy name as the action.
  const env = renderEnvelope({ text: 'x', commit: commit({ receipts: [WEIGHT_FAILED] }) });
  assertEquals(env.actions.map((a) => a.type), ['weight_log']);
  assertEquals(env.receipts!.map((r) => [r.action_type, r.ok]), [['weight_log', false]]);
  // The undo receipt the client looks up by action_type.
  const undo = renderEnvelope({ text: 'x', commit: commit({ receipts: [{ action_type: 'record_delete', legacy_type: 'undo', ok: true, rows_affected: 1, user_line: 'Kayıt geri alındı: su', failure_class: null }] }) });
  assertEquals(undo.receipts!.find((r) => r.action_type === 'undo')?.ok, true);
});

Deno.test('ConfidenceBadge: the weakest meal item of the turn, only on a stored meal', () => {
  const d = decision({ writes: [mealWrite([['a', 100, 1]]), { ...mealWrite([['b', 100, 1]]), items: [{ ...(mealWrite([['b', 100, 1]]).items as Record<string, unknown>[])[0], confidence: 0.5 }] }] });
  assertEquals(mealConfidence(d), 'low');
  assertEquals(mealConfidence(decision()), null);
  const acts = envelopeActions(commit({ receipts: [{ ...MEAL_RECEIPT, ok: false, user_line: 'Öğün kaydedilemedi', failure_class: 'write_failed' }] }), d);
  assertEquals(acts[0].confidence, undefined);
});

Deno.test('navigate_to: only routes the app can open (= v1 VALID_NAVIGATE_ROUTES)', () => {
  const s = V1.indexOf('const VALID_NAVIGATE_ROUTES = new Set([');
  const v1Routes = [...V1.slice(s, V1.indexOf(']);', s)).matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assertEquals([...VALID_NAVIGATE_ROUTES].sort(), v1Routes.sort());
  assertEquals(renderEnvelope({ text: 'x', navigateTo: '/plan/diet' }).navigate_to, '/plan/diet');
  assertEquals(renderEnvelope({ text: 'x', navigateTo: '/(tabs)/index' }).navigate_to, null);
});

Deno.test('plan honesty: a failed draft save gets one appended line and no navigation (v1 parity); an ED-gate refusal does not', () => {
  const failed = { snapshot: null, draftId: null, type: 'diet' as const, persistError: 'persist_failed' };
  const env = renderEnvelope({ text: 'Planını hazırladım.', plan: failed, navigateTo: '/plan/diet' });
  assert(env.message.startsWith('Planını hazırladım.\n\n(Not: '), env.message);
  assertEquals(env.navigate_to, null);
  assertEquals(env.plan_persist_error, 'persist_failed');
  assertEquals(planHonestyLine({ ...failed, persistError: 'ed_gate_blocked' }), null);
});

Deno.test('task_mode: canonical strings from facts code holds', () => {
  assertEquals(v2TaskMode({ tripwire: protectiveTripwire('emergency') }), 'emergency');
  assertEquals(v2TaskMode({ tripwire: protectiveTripwire('self_harm') }), 'safety');
  assertEquals(v2TaskMode({ tripwire: protectiveTripwire('ed') }), 'safety');
  assertEquals(v2TaskMode({ decision: decision({ plan_action: { op: 'generate', plan_type: 'diet', draft_ref: null } }) }), 'plan');
  assertEquals(v2TaskMode({ decision: decision({ reply_route: { contract: 'onboarding', effort_hint: 'low' } }) }), 'onboarding');
  assertEquals(v2TaskMode({ decision: decision({ intent: { primary: 'question' } }) }), 'qa');
  assertEquals(v2TaskMode({ decision: decision({ intent: { primary: 'correction' } }) }), 'register');
  assertEquals(v2TaskMode({ decision: decision() }), 'coaching');
  assertEquals(v2TaskMode({ decision: decision({ intent: { primary: 'question' } }), commit: commit({ receipts: [MEAL_RECEIPT] }) }), 'register');
});

Deno.test('canned envelope: v1\'s {message, actions: [], task_mode} plus only what v2 really has', () => {
  assertEquals(renderCannedEnvelope(CANNED_SAFETY.emergency), { message: CANNED_SAFETY.emergency.message, actions: [], task_mode: 'emergency' });
  const env = renderCannedEnvelope(CANNED_SAFETY.self_harm, { remaining: 3, assistantMessageId: 'msg-7' });
  assertEquals(env, { message: CANNED_SAFETY.self_harm.message, actions: [], task_mode: 'safety', assistant_message_id: 'msg-7', remaining: 3 });
});
