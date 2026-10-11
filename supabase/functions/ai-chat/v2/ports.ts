/**
 * ai-chat/v2/ports.ts — the T6/T7/T8 seams of the v2 turn (AI_MIMARI_V2 §3.2) and their DEFAULTS.
 *
 *   CoachPort      T6 Stage B — coach.ts runCoach (the coach builder's module).
 *   PostcheckPort  T7 structural post-checks: required safety lines, the safety-hold question, the
 *                  allergen-exposure acknowledgement. Append-only: code never deletes from a reply
 *                  (§5.3); every appended line is a CodeNote, stored apart from the model's text.
 *   EnvelopePort   T8 the TurnEnvelope the app reads today (message, actions[] with legacy type
 *                  names for BADGE_DEFS, receipts[], task_mode, remaining, assistant_message_id).
 *
 * defaultPostcheck / defaultEnvelope are the conservative implementations the handler runs with
 * until the coach builder's postcheck/envelope modules are wired in live.ts (one line each). They
 * read structure (receipts, holds, exposures, the tripwire resolution) — the only prose they look
 * at is the coach's reply, to avoid appending a line it already carries (the shared, tested
 * helpers hasRequiredSafetyLine / replyWarnsAboutExposure).
 */
import type { ActionReceipt, EnvelopeAction, TurnEnvelope } from '../../shared/contracts/turn-envelope.ts';
import { ensureRequiredSafetyLine, hasRequiredSafetyLine, type SafetyCategory } from '../../shared/safety-tripwires.ts';
import { replyWarnsAboutExposure } from '../../shared/supplement-allergens.ts';
import type { CodeNote } from '../../shared/v2-db-types.ts';
import { isSafetyHold } from './commit.ts';
import type { CoachInput, CoachReply, CommitResult, TripwireResolution } from './contracts.ts';
import type { TurnInput } from './input.ts';

export type CoachPort = (input: CoachInput) => Promise<CoachReply>;

export interface PostcheckInput {
  /** Stage B's reply, or null when Stage B failed (then `text` is the code's fallback). */
  reply: CoachReply | null;
  /** The text to check: reply.reply, or the fallback text. */
  text: string;
  commit: CommitResult | null;
  tripwire: TripwireResolution;
  turnInput: TurnInput | null;
  message: string;
}

export interface PostcheckOutput {
  /** Final text = the model's text + the code notes, appended in order. */
  text: string;
  code_notes: CodeNote[];
  issues: string[];
}

export type PostcheckPort = (input: PostcheckInput) => Promise<PostcheckOutput>;

export interface EnvelopeInput {
  /** Final text (after T7). */
  text: string;
  commit: CommitResult | null;
  reply: CoachReply | null;
  taskMode: string;
  assistantMessageId: string | null;
  remaining: number | undefined;
}

export type EnvelopePort = (input: EnvelopeInput) => TurnEnvelope;

// ─── default T7 ──────────────────────────────────────────────────────────────────────────────────

/** The protective path's category, when the turn is on it. */
export function protectiveCategory(t: TripwireResolution): SafetyCategory | null {
  if (t.kind === 'protective') return t.category;
  if (t.kind === 'canned' || t.kind === 'fallback') return t.category;
  return null;
}

function exposureLine(e: CommitResult['exposures'][number]): string {
  const what = e.source === 'meal' ? 'öğün' : 'takviye';
  return `⚠️ Dikkat: profilinde ${e.allergens.join(', ')} alerjisi ya da hassasiyeti kayıtlı ve kaydettiğin ${what} bunu içeriyor olabilir. Kaydettim; kaşıntı, şişlik ya da nefes darlığı olursa hemen 112'yi ara.`;
}

/**
 * Code's guaranteed lines, appended LAST, never removing anything (§5.2, §7.1, §7.2):
 *   112 / referral on a protective turn · the KVKK erase outcome · every SAFETY hold's question
 *   (always — never inferred from the reply's prose) and a plain ask hold's question when the reply
 *   asks nothing · the allergen exposure acknowledgement.
 */
export const defaultPostcheck: PostcheckPort = (p) => {
  const notes: CodeNote[] = [];
  const issues: string[] = [];
  let text = p.text ?? '';
  const add = (kind: CodeNote['kind'], line: string) => {
    notes.push({ kind, text: line });
    text = text.trim() ? `${text.trimEnd()}\n\n${line}` : line;
  };

  const cat = protectiveCategory(p.tripwire);
  if (cat && !hasRequiredSafetyLine(text, cat)) {
    const before = text;
    const withLine = ensureRequiredSafetyLine(before, cat);
    const line = withLine.slice(before.trimEnd().length).trim();
    if (line) {
      add(cat === 'ed' ? 'referral' : 'emergency', line);
      issues.push(`required_line_appended:${cat}`);
    }
  }

  const commit = p.commit;
  if (commit) {
    for (const r of commit.receipts) {
      // The erase outcome is a fact the code owns (erase-hold.ts lines), never the model's claim.
      if (r.legacy_type === 'data_erase_confirm' && r.user_line) add('other', r.user_line);
    }
    // §5.2: a SAFETY hold's question (allergen/injury removal, identity, band, goal, KVKK erase) is
    // code-owned and always appended — a stray "?" elsewhere in the reply must never let a later
    // "evet" confirm a removal the user was never asked about. Only a plain ASK hold relies on the
    // coach asking in its own words (template appended when the reply asks nothing at all).
    const askedSomething = (p.reply?.reply ?? '').includes('?');
    for (const h of commit.holds) {
      if (!h.question_tr) continue;
      if (isSafetyHold(h)) {
        add('safety_hold', h.question_tr);
        issues.push(`safety_hold_question:${h.op}`);
        continue;
      }
      if (!askedSomething) {
        add('safety_hold', h.question_tr);
        issues.push(`hold_question_appended:${h.op}`);
      }
    }
    for (const e of commit.exposures) {
      const warned = replyWarnsAboutExposure(text, { item: e.source === 'meal' ? 'öğün' : 'takviye', allergens: e.allergens, sources: e.allergens, possible: false, severe: false });
      if (!warned) {
        add('allergen_exposure', exposureLine(e));
        issues.push('allergen_exposure_appended');
      }
    }
  }
  return Promise.resolve({ text, code_notes: notes, issues });
};

// ─── default T8 ──────────────────────────────────────────────────────────────────────────────────

/** Typed receipts → the client's ActionReceipt (action_type = the legacy name BADGE_DEFS knows). */
export function toEnvelopeReceipts(commit: CommitResult | null): ActionReceipt[] {
  return (commit?.receipts ?? []).map((r) => ({
    action_type: r.legacy_type, ok: r.ok, rows_affected: r.rows_affected, user_line: r.user_line, failure_class: r.failure_class,
  }));
}

/** Successful writes → actions[] (the badge row; a failed write has no green badge). */
export function toEnvelopeActions(commit: CommitResult | null): EnvelopeAction[] {
  return (commit?.receipts ?? []).filter((r) => r.ok).map((r) => ({ type: r.legacy_type, feedback: r.user_line }));
}

/**
 * The coach's `why` re-serialised as the in-message <reasoning> block the client already parses
 * (ChatThreadScreen parseReasoning → the "Neden?" panel, also after a history reload).
 */
export function messageWithReasoning(text: string, why: string | null | undefined): string {
  const w = (why ?? '').trim();
  if (!w) return text;
  // The client's parser ends the block at the first closing tag: never let the text close it early.
  const safe = w.split('</reasoning>').join('');
  return `<reasoning>${safe}</reasoning>\n${text}`;
}

/** The screens the app can open from a reply (the same set v1 accepts for navigate_to). */
export const NAVIGATE_ROUTES: ReadonlySet<string> = new Set([
  '/plan/diet', '/plan/workout', '/(tabs)', '/(tabs)/chat', '/(tabs)/profile',
  '/settings/coach-memory', '/settings/goals', '/settings/premium',
]);

export function navigateToOf(reply: CoachReply | null): string | null {
  const ui = reply?.ui;
  const to = ui && typeof ui === 'object' ? (ui as Record<string, unknown>).navigate_to : null;
  return typeof to === 'string' && NAVIGATE_ROUTES.has(to) ? to : null;
}

export const defaultEnvelope: EnvelopePort = (p) => {
  const receipts = toEnvelopeReceipts(p.commit);
  return {
    message: messageWithReasoning(p.text, p.reply?.why),
    actions: toEnvelopeActions(p.commit),
    receipts: receipts.length ? receipts : null,
    assistant_message_id: p.assistantMessageId,
    task_mode: p.taskMode,
    task_completion: null,
    plan_snapshot: null,
    plan_draft_id: null,
    plan_type: null,
    plan_reasoning: null,
    plan_persist_error: null,
    plan_approved: null,
    navigate_to: navigateToOf(p.reply),
    simulation: null,
    ...(p.remaining !== undefined ? { remaining: p.remaining } : {}),
  };
};
