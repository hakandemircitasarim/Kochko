import type { TaskMode } from './task-modes.ts';

/**
 * THE TURN'S IDENTITY (plan v2, F1 · B1a).
 *
 * WHY: a turn had two identities living side by side — `taskMode` (raw keyword detection) and
 * `effectiveMode` (after the client hint and the plan promotion). Downstream, some readers took
 * one and some took the other, with no rule saying which was correct: temperature, the service
 * contexts, the retrieval plan, the stored `chat_messages.task_mode`, the returned `task_mode` and
 * the turn ledger did NOT agree. That is not a naming problem; it is the reason a promoted plan
 * turn silently lost its return-flow context and its temperature.
 *
 * WHAT: one resolver, one precedence order, one canonical `mode`. `rawMode` survives only as a
 * DIAGNOSTIC field (it answers "what did the keyword matcher think?" in SQL) and must never gate
 * behaviour again.
 *
 * PRECEDENCE — highest first, and each level says WHY it outranks the next:
 *   1. active_intent   — an open piece of work (a plan being negotiated) outlives one message.
 *                        Without this, a single "peki neden 1900 kalori?" drops the user out of
 *                        the plan conversation because that sentence has no plan keywords.
 *   2. onboarding hint — the client opened a specific profile card; the card knows what it is
 *                        collecting far better than a regex over its prefill sentence.
 *   3. explicit hint   — the client opened a plan-negotiation surface.
 *   4. promotion       — the message is a plan REQUEST and the preconditions hold.
 *   5. detection       — keyword matching, the last resort.
 */

export type ModeSource = 'active_intent' | 'onboarding_hint' | 'client_hint' | 'promotion' | 'detected';

export interface ModeResolution {
  /** The canonical mode. EVERY consumer reads this. */
  mode: TaskMode;
  /** What detectTaskMode() alone would have said. Diagnostics/ledger ONLY — never a gate. */
  rawMode: TaskMode;
  /** Which rule won, so a surprising mode is explainable from one ledger row. */
  source: ModeSource;
}

/** Modes the client may request outright (they can never be produced by keyword detection). */
export const HINT_MODES: readonly string[] = ['plan_diet', 'plan_workout', 'daily_log'];

/** An `onboarding_*` task-card hint means the ONBOARDING contract, whatever the prefill says. */
export function isOnboardingHint(hint: unknown): boolean {
  return typeof hint === 'string' && hint.startsWith('onboarding_');
}

export interface ResolveModeInput {
  rawMode: TaskMode;
  taskModeHint?: unknown;
  /** chat_sessions.active_intent — an open piece of work, e.g. {kind:'plan', plan_type:'diet'}. */
  activeIntent?: { kind?: string; plan_type?: string } | null;
  isOnboarding: boolean;
  /** True when the ALGI-01 fix (onboarding hints win over keyword detection) is enabled. */
  onboardingHintEnabled: boolean;
  /** True when active_intent may steer the mode. */
  activeIntentEnabled: boolean;
}

export function resolveTurnMode(input: ResolveModeInput): ModeResolution {
  const { rawMode, taskModeHint, activeIntent, isOnboarding } = input;

  // 1. An open piece of work outranks this message's surface form — but never during onboarding,
  //    where the profile-collection contract owns the turn.
  if (input.activeIntentEnabled && !isOnboarding && activeIntent?.kind === 'plan') {
    const mode = (activeIntent.plan_type === 'workout' ? 'plan_workout' : 'plan_diet') as TaskMode;
    return { mode, rawMode, source: 'active_intent' };
  }

  // 2. A task card knows what it is collecting. Without this the card's prefill sentence is fed to
  //    a keyword matcher: "Uyku düzenim ve kalitem hakkında konuşmak istiyorum" contains 'uyku', so
  //    the sleep card ran in REGISTER mode with a minimal Layer-1 that omits sleep_time/wake_time —
  //    the coach then re-asked what the profile already knew. (ALGI-01, the owner's own report.)
  if (input.onboardingHintEnabled && isOnboardingHint(taskModeHint)) {
    return { mode: 'onboarding' as TaskMode, rawMode, source: 'onboarding_hint' };
  }

  // 3. Explicit plan-negotiation surfaces.
  if (typeof taskModeHint === 'string' && HINT_MODES.includes(taskModeHint)) {
    return { mode: taskModeHint as TaskMode, rawMode, source: 'client_hint' };
  }

  // 4/5. Promotion is applied by the caller (it needs DB preconditions); until then, detection.
  return { mode: rawMode, rawMode, source: 'detected' };
}

/**
 * Modes that carry an in-flight plan negotiation. Used both to set `active_intent` and to decide
 * whether a turn is a "plan turn" downstream.
 */
export function isPlanMode(mode: TaskMode): boolean {
  return mode === 'plan_diet' || mode === 'plan_workout';
}

/** The user asking to leave the current piece of work ("boş ver", "vazgeç", "başka konu"). */
const DROP_INTENT_RE =
  /\b(bo[sş] ver|vazge[cç]tim|vazge[cç]|iptal|kapat(al[ıi]m)?|ba[sş]ka (bir )?(konu|[sş]ey)|plan istemiyorum|sonra bakar[ıi]z)\b/i;

export function wantsToDropIntent(message: string | null | undefined): boolean {
  return typeof message === 'string' && DROP_INTENT_RE.test(message.toLocaleLowerCase('tr'));
}

/**
 * What the user wants from a PLAN turn. Without this distinction, every plan-mode turn that did
 * not contain a snapshot counted as a FAILED GENERATION: asking "peki neden 1900 kalori?" fired a
 * second ~8000-token generation call and then either overwrote the draft the user was reading or
 * replaced the answer with an error sentence. A question about a plan is not a request for a new
 * one.
 */
export type PlanIntent = 'generate' | 'revise' | 'explain' | 'approve';

const EXPLAIN_RE =
  /(neden|niye|ni[çc]in|nas[ıi]l hesap|neye g[öo]re|ne demek|a[çc][ıi]klar? m[ıi]s[ıi]n|anlamad[ıi]m|kafam kar[ıi][şs]|ka[çc] kalori|neden bu kadar)/i;
const REVISE_RE =
  /(de[ğg]i[şs]tir|ba[şs]ka|olmas[ıi]n|sevmiyorum|yerine|ekle|[çc][ıi]kar|azalt|artt?[ıi]r|yenile|g[üu]ncelle|olmaz|istemiyorum)/i;

export function classifyPlanIntent(
  message: string | null | undefined,
  hasActiveDraft: boolean,
  userApproved?: boolean,
): PlanIntent {
  if (userApproved === true) return 'approve';
  const m = (message ?? '').toLocaleLowerCase('tr');
  if (!m.trim()) return hasActiveDraft ? 'explain' : 'generate';
  // Order matters: "kahvaltıyı neden yumurta yaptın, değiştir" is a revision, not a question.
  if (hasActiveDraft && REVISE_RE.test(m)) return 'revise';
  if (hasActiveDraft && EXPLAIN_RE.test(m)) return 'explain';
  return hasActiveDraft ? 'revise' : 'generate';
}
