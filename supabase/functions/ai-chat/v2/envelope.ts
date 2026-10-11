/**
 * ai-chat/v2/envelope.ts — T8: the response the app reads today, rendered from v2's structures
 * (AI_MIMARI_V2 §3.2 T8, §11 risk 13). No client release is needed for v2, so this must be byte-for-
 * byte what ChatThreadScreen.tsx and shared/contracts/turn-envelope.ts expect from v1:
 *
 *   message      the coach's prose (+ code notes, already appended LAST by postcheck.ts) and the
 *                in-message machine blocks the client still parses from the TEXT, on both the live
 *                and the history-reload path: <reasoning> (the "Neden?" toggle, from Stage B's `why`),
 *                <simulation> (the SimulationCard JSON) and <confirm_reject/> (Onayla/Değiştir — only
 *                when a plan draft was really persisted and awaits a decision; v1 index.ts rule)
 *   actions[]    one per receipt, typed with the LEGACY name (weight_log, undo, profile_update …) so
 *                BADGE_DEFS keeps working; feedback = the receipt line ('Öğün kaydedildi — …' keeps the
 *                registry's byte-identical prefix, which the client's receipt row and badge key on)
 *   receipts[]   the typed receipts, action_type = the same legacy name (the client marks a badge red
 *                when a receipt of that type is ok:false; receipts[action_type='undo'] for undo)
 *   task_mode    a canonical mode string the client already knows, chosen from facts code holds
 *   plan_*       draft identity for the approve round-trip (plan_type also drives task_mode)
 *   navigate_to  only routes the app can open (v1's VALID_NAVIGATE_ROUTES)
 *
 * Machine blocks are the ENVELOPE's: a block or marker that appears inside the model's prose is
 * removed before ours are written (a stray <confirm_reject/> would show approve buttons under no
 * plan, a stray <simulation> would render a card with the model's own numbers). That is marker
 * hygiene, not prose deletion — no sentence is touched. Implemented with index scans: ai-chat/v2
 * carries no regex (arch-guard G13).
 *
 * Pure: no I/O.
 */
import type {
  ActionReceipt, EnvelopeAction, EnvelopeSimulation, TaskCompletionEnvelope, TurnEnvelope,
} from '../../shared/contracts/turn-envelope.ts';
import type { CannedSafetyResponse } from '../../shared/safety-tripwires.ts';
import { failureLine } from '../../shared/turn-failures.ts';
import type { CodeNote } from '../../shared/v2-db-types.ts';
import type { CommitResult, TripwireResolution, UnderstandDecision, V2Receipt } from './contracts.ts';

/** v1 index.ts VALID_NAVIGATE_ROUTES (envelope.test.ts pins the two lists together). */
export const VALID_NAVIGATE_ROUTES: ReadonlySet<string> = new Set([
  '/plan/diet', '/plan/workout', '/(tabs)', '/(tabs)/chat', '/(tabs)/profile',
  '/settings/coach-memory', '/settings/goals', '/settings/premium',
]);

/** Paired machine blocks the client strips (ChatThreadScreen sanitizeAssistantText). */
export const MACHINE_BLOCK_TAGS: readonly string[] = [
  'actions', 'layer2_update', 'task_completion', 'plan_snapshot', 'plan_finalize', 'reasoning', 'navigate_to',
  'simulation', 'quick_select', 'recipe', 'commitment', 'persona_detected',
];

/** Remove every `<tag>…</tag>` block (non-greedy, all occurrences) — a missing close leaves the text as is. */
function stripBlock(text: string, tag: string): string {
  const open = `<${tag}>`;
  const close = `</${tag}>`;
  let out = '';
  let from = 0;
  for (;;) {
    const s = text.indexOf(open, from);
    if (s < 0) break;
    const e = text.indexOf(close, s + open.length);
    if (e < 0) break;
    out += text.slice(from, s);
    from = e + close.length;
  }
  return out + text.slice(from);
}

/** Remove `<confirm_reject/>`, `<confirm_reject />`, `<confirm_reject>` (the client's `<confirm_reject\s*\/?>`). */
function stripConfirmReject(text: string): string {
  const head = '<confirm_reject';
  let out = '';
  let from = 0;
  for (;;) {
    const s = text.indexOf(head, from);
    if (s < 0) break;
    let i = s + head.length;
    while (i < text.length && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i++;
    if (text[i] === '/') i++;
    if (text[i] !== '>') { out += text.slice(from, s + head.length); from = s + head.length; continue; }
    out += text.slice(from, s);
    from = i + 1;
  }
  return out + text.slice(from);
}

/** The model's prose without any client machine block or marker (see header). */
export function stripMachineMarkers(text: string): string {
  let t = text ?? '';
  for (const tag of MACHINE_BLOCK_TAGS) t = stripBlock(t, tag);
  return stripConfirmReject(t).trim();
}

/** Text that goes INSIDE one of our blocks must not be able to close it early. */
function blockSafe(text: string): string {
  return text.replaceAll('<', '‹').replaceAll('>', '›').trim();
}

// ─── task_mode ─────────────────────────────────────────────────────────────────────────────────────

export interface EnvelopePlan {
  snapshot: Record<string, unknown> | null;
  /** weekly_plans row id of the persisted draft (the identity Onayla carries back). */
  draftId: string | null;
  type: 'diet' | 'workout';
  reasoning?: string | null;
  persistError?: string | null;
  approved?: { id: string } | null;
  /** The user approved this turn (no buttons: nothing awaits a decision). */
  approvalTurn?: boolean;
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * The canonical mode string, from facts code holds (never from the user's words). Precedence: the
 * safety path, a plan turn, a what-if, onboarding, a turn that wrote, a question, plain coaching.
 * The values are ones the client already branches on (plan_* → plan type, simulation/plan → feedback
 * buttons, emergency/safety → v1 parity); v1's keyword modes (recipe, eating_out, plateau …) have
 * no v2 source and are not produced.
 */
export function v2TaskMode(p: {
  decision?: UnderstandDecision | null;
  tripwire?: TripwireResolution | null;
  plan?: EnvelopePlan | null;
  simulation?: EnvelopeSimulation | null;
  commit?: CommitResult | null;
}): string {
  const t = p.tripwire;
  if (t?.kind === 'canned') return t.response.task_mode;
  if (t?.kind === 'fallback' && t.mode === 'replace') return t.response.task_mode;
  if (t?.kind === 'protective') return t.fallback.task_mode;
  if (p.plan) return p.plan.type === 'workout' ? 'plan_workout' : 'plan_diet';
  const d = p.decision ?? null;
  const planOp = isRec(d?.plan_action) ? d!.plan_action!.op : null;
  if (typeof planOp === 'string' && planOp !== 'none') return 'plan';
  if (p.simulation || isRec(d?.simulation)) return 'simulation';
  const contract = isRec(d?.reply_route) ? d!.reply_route!.contract : null;
  if (contract === 'onboarding') return 'onboarding';
  const primary = isRec(d?.intent) ? d!.intent!.primary : null;
  if ((p.commit?.receipts.length ?? 0) > 0 || primary === 'report' || primary === 'correction') return 'register';
  if (primary === 'question') return 'qa';
  return 'coaching';
}

// ─── actions / receipts ────────────────────────────────────────────────────────────────────────────

/** The ConfidenceBadge bucket for meal_log actions: the weakest item of this turn's meals (v1 parity). */
export function mealConfidence(decision: UnderstandDecision | null | undefined): 'high' | 'medium' | 'low' | null {
  const confs: number[] = [];
  for (const w of Array.isArray(decision?.writes) ? decision!.writes! : []) {
    if (!isRec(w) || w.op !== 'meal_log' || w.status === 'restatement') continue;
    for (const it of Array.isArray(w.items) ? w.items : []) {
      if (isRec(it)) confs.push(typeof it.confidence === 'number' ? it.confidence : 0.75);
    }
  }
  if (confs.length === 0) return null;
  const min = Math.min(...confs);
  return min >= 0.85 ? 'high' : min >= 0.65 ? 'medium' : 'low';
}

/**
 * Typed receipts under the legacy names. allergen_exposure is not filled: no client reads it, v1's
 * server net was its only reader, and in v2 the exposure acknowledgement is postcheck.ts's job.
 */
export function envelopeReceipts(commit: CommitResult | null | undefined): ActionReceipt[] {
  if (!commit) return [];
  return commit.receipts.map((r: V2Receipt) => ({
    action_type: r.legacy_type,
    ok: r.ok,
    rows_affected: r.rows_affected,
    user_line: r.user_line,
    failure_class: r.failure_class,
  }));
}

export function envelopeActions(commit: CommitResult | null | undefined, decision?: UnderstandDecision | null): EnvelopeAction[] {
  if (!commit) return [];
  const conf = mealConfidence(decision);
  return commit.receipts.map((r) => {
    const a: EnvelopeAction = { type: r.legacy_type, feedback: r.user_line };
    if (r.legacy_type === 'meal_log' && r.ok && conf) a.confidence = conf;
    return a;
  });
}

// ─── the envelope ──────────────────────────────────────────────────────────────────────────────────

export interface RenderEnvelopeInput {
  /** Final visible text: Stage B's reply + postcheck's code notes (already appended LAST). */
  text: string;
  /**
   * The code notes `text` ends with (coachTurn's codeNotes). Given, a plan-honesty line goes BEFORE
   * them, so the mandatory safety lines (112 / exposure / hold question) stay last (§3.2 T7, §7.1).
   */
  codeNotes?: readonly CodeNote[];
  /** Stage B's `why` → <reasoning> (the "Neden?" toggle). */
  why?: string | null;
  commit?: CommitResult | null;
  decision?: UnderstandDecision | null;
  tripwire?: TripwireResolution | null;
  /** The SimulationCard numbers (server-computed). */
  simulation?: EnvelopeSimulation | null;
  plan?: EnvelopePlan | null;
  /** Stage B's ui.navigate_to (validated here). */
  navigateTo?: string | null;
  taskCompletion?: TaskCompletionEnvelope | null;
  /** Rate-limit remaining (-1 = exempt), as v1. */
  remaining?: number;
  assistantMessageId?: string | null;
}

/** Stage B's ui.navigate_to as a route string (renderEnvelope still validates it). */
export function navigateOf(ui: unknown): string | null {
  return isRec(ui) && typeof ui.navigate_to === 'string' && ui.navigate_to.trim() !== '' ? ui.navigate_to.trim() : null;
}

/** `message` exactly as stored and as the client parses it (live AND history reload). */
export function renderMessage(p: { text: string; why?: string | null; simulation?: EnvelopeSimulation | null; confirmReject: boolean }): string {
  const parts: string[] = [stripMachineMarkers(p.text)];
  const why = p.why ? blockSafe(stripMachineMarkers(p.why)) : '';
  if (why) parts.push(`<reasoning>${why}</reasoning>`);
  if (p.simulation) parts.push(`<simulation>${JSON.stringify(p.simulation)}</simulation>`);
  let message = parts.filter((s) => s !== '').join('\n');
  if (p.confirmReject) message = `${message}\n<confirm_reject/>`.trim();
  return message;
}

/**
 * v1 parity: a plan meant to be saved whose persistence FAILED gets one honest line (the prose may
 * claim success) and no "planına git" button. An ED-gate refusal is not a failed save — its reply
 * already says why. The line is added, never replacing anything (§5.3 "plan dürüstlük satırı"),
 * between the coach's text and the mandatory code notes; the handler records it as the
 * 'plan_honesty' code note (planHonestyNote).
 */
export function planHonestyLine(plan: EnvelopePlan | null | undefined): string | null {
  return plan && plan.persistError && !plan.snapshot && plan.persistError !== 'ed_gate_blocked'
    ? `(Not: ${failureLine('persist_failed')})`
    : null;
}

/** planHonestyLine as the CodeNote the handler stores (chat_messages.code_notes kind 'plan_honesty'). */
export function planHonestyNote(plan: EnvelopePlan | null | undefined): CodeNote | null {
  const line = planHonestyLine(plan);
  return line ? { kind: 'plan_honesty', text: line } : null;
}

/**
 * `line` inserted between the coach's text and the trailing code notes (joined as withCodeNotes
 * joins them). Without notes — or when the text does not end with them — the line is simply last.
 */
export function insertBeforeCodeNotes(text: string, notes: readonly CodeNote[] | undefined, line: string): string {
  const body = stripMachineMarkers(text);
  const tail = (notes ?? []).map((n) => n.text.trim()).filter((s) => s !== '').join('\n\n');
  if (tail !== '' && body.endsWith(tail)) {
    const head = body.slice(0, body.length - tail.length).trimEnd();
    return [head, line, tail].filter((s) => s !== '').join('\n\n');
  }
  return body === '' ? line : `${body}\n\n${line}`;
}

/** The normal-turn envelope (TurnEnvelope, v1 key order). */
export function renderEnvelope(input: RenderEnvelopeInput): TurnEnvelope {
  const plan = input.plan ?? null;
  // v1 rule: the marker means EXACTLY "a real plan-proposal snapshot was persisted this turn and
  // awaits the user's decision" — never on an approval turn, never without a draft.
  const confirmReject = !!(plan && plan.snapshot && plan.draftId && plan.approvalTurn !== true);
  const receipts = envelopeReceipts(input.commit);
  const honesty = planHonestyLine(plan);
  const nav = input.navigateTo && VALID_NAVIGATE_ROUTES.has(input.navigateTo) && honesty === null ? input.navigateTo : null;
  const text = honesty ? insertBeforeCodeNotes(input.text, input.codeNotes, honesty) : input.text;
  const env: TurnEnvelope = {
    message: renderMessage({ text, why: input.why, simulation: input.simulation ?? null, confirmReject }),
    actions: envelopeActions(input.commit, input.decision),
    receipts: receipts.length > 0 ? receipts : null,
    assistant_message_id: input.assistantMessageId ?? null,
    task_mode: v2TaskMode({ decision: input.decision, tripwire: input.tripwire, plan, simulation: input.simulation, commit: input.commit }),
    task_completion: input.taskCompletion ?? null,
    plan_snapshot: plan?.snapshot ?? null,
    plan_draft_id: plan?.draftId ?? null,
    plan_type: plan ? plan.type : null,
    plan_reasoning: plan?.reasoning ?? null,
    plan_persist_error: plan?.persistError ?? null,
    plan_approved: plan?.approved ?? null,
    navigate_to: nav,
    simulation: input.simulation ?? null,
  };
  if (typeof input.remaining === 'number') env.remaining = input.remaining;
  return env;
}

/**
 * The explicit-tripwire / fail-closed reply (§7.1: no LLM). v1 returned {message, actions: [],
 * task_mode}; the v2 extras are the persisted row id and any receipt of facts salvaged before it.
 * `text` is the FINAL text — coachTurn's `text` (the ready-made message + its code notes, e.g. an
 * allergen-exposure line), or `response.message` on a path with no notes — never re-derived from
 * `response`, so no appended line is dropped on the way to the screen.
 */
export function renderCannedEnvelope(
  response: CannedSafetyResponse,
  text: string,
  extra: { remaining?: number; assistantMessageId?: string | null; commit?: CommitResult | null } = {},
): TurnEnvelope {
  const receipts = envelopeReceipts(extra.commit);
  const env: TurnEnvelope = {
    message: stripMachineMarkers(text) || response.message,
    actions: envelopeActions(extra.commit),
    task_mode: response.task_mode,
  };
  if (receipts.length > 0) env.receipts = receipts;
  if (extra.assistantMessageId) env.assistant_message_id = extra.assistantMessageId;
  if (typeof extra.remaining === 'number') env.remaining = extra.remaining;
  return env;
}
