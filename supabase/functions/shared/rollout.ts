/**
 * ROLLOUT GATE (plan v2, F0 · A00)
 *
 * WHY: this repo has no feature-flag / kill-switch / staging surface. Every edge deploy reaches
 * 100% of users the instant it lands, and the only way back is a second deploy. That made every
 * behaviour-changing step an all-or-nothing bet — which is exactly the wrong shape for a codebase
 * whose signature failure is "shipped but silently wrong".
 *
 * WHAT: the cheapest gate that fits the repo's own idiom (`KOCHKO_MODEL_*` env vars are already
 * read this way). NO new table, NO new dependency, NO runtime layer — one pure parser plus a
 * `Deno.env.get`. Changing an env var via `supabase secrets set` takes effect without a redeploy,
 * so rollback is seconds, not a deploy cycle.
 *
 * USAGE
 *   const mode = rolloutMode('a1_ed_decay', userId);
 *   if (mode === 'on') { ...new behaviour... }
 *   else if (mode === 'shadow') { console.log('[shadow][a1_ed_decay]', whatWouldHaveHappened); }
 *   // 'off' → old behaviour, untouched
 *
 * ENV CONTRACT — key is `KOCHKO_ROLLOUT_` + the step id upper-snaked (`a1_ed_decay` →
 * `KOCHKO_ROLLOUT_A1_ED_DECAY`). Accepted values:
 *   'off' | '0' | 'false'          → off
 *   'shadow'                       → shadow for everyone (log only; user text and DB writes UNCHANGED)
 *   'on' | '1' | 'true' | 'all'    → on for everyone
 *   '<uuid>,<uuid>'                → on for those users, off for everyone else (allowlist)
 *   'shadow:<uuid>,<uuid>'         → shadow for those users, off for everyone else
 *   'on:<uuid>,<uuid>'             → same as a bare allowlist (explicit form)
 *   'pct=N'                        → on for the deterministic N% of users whose bucket < N
 *   'pct=N,<uuid>,<uuid>'          → on for that N% PLUS the listed users (allowlist ∪ bucket)
 *   'shadow:pct=N[,<uuid>…]'       → the same, in shadow mode
 * Unset → `KOCHKO_ROLLOUT_DEFAULT` if set, else the caller's `fallback` (default 'off'). The v2 steps
 * (V2_ROLLOUT_STEPS) ignore `KOCHKO_ROLLOUT_DEFAULT`: they cost an LLM call per turn or change what
 * the user sees, so only their OWN key can switch them on — a blanket default never does.
 *
 * BUCKET (AI_MIMARI_V2 §10): `sha256(step + uid) mod 100`, step trimmed + lower-cased, uid trimmed +
 * lower-cased, no separator, the whole 256-bit digest taken mod 100. Salting with the step id gives
 * every step its own independent 5% / 25% / 50% cohort; the same user stays in the same bucket of a
 * step across turns, deploys and isolates (no state, no table). Raising N only ADDS users.
 * `N` is an integer 0..100; anything else (pct=abc, pct=12.5, pct=150, two pct tokens) is a typo
 * and fails CLOSED to the fallback, exactly like an unknown prefix.
 *
 * The staged sequence every behaviour-changing step must walk: shadow → allowlist → pct → on.
 */

import { sha256Hex } from './sha256.ts';

export type RolloutMode = 'off' | 'shadow' | 'on';

const OFF_WORDS = new Set(['off', '0', 'false', 'no', '']);
const ON_WORDS = new Set(['on', '1', 'true', 'all', 'yes']);

/** Env key for a step id. Exported so tests and ops docs can't drift from the reader. */
export function rolloutEnvKey(step: string): string {
  return `KOCHKO_ROLLOUT_${step.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_')}`;
}

/** The deterministic 0..99 bucket of a user for a step: sha256(step + uid) mod 100 (see header). */
export function rolloutBucket(step: string, userId: string): number {
  const hex = sha256Hex(`${step.trim().toLowerCase()}${userId.trim().toLowerCase()}`);
  return Number(BigInt(`0x${hex}`) % 100n);
}

const PCT_TOKEN = /^pct\s*=\s*(\d{1,3})$/;

/**
 * PURE parser — no env, no I/O. This is the whole decision; `rolloutMode` only supplies the raw
 * string. Keeping it pure is what makes the gate unit-testable without a Deno permission dance.
 * `step` salts the pct bucket; it is required for a `pct=N` value to mean anything per step.
 */
export function parseRolloutValue(
  raw: string | null | undefined,
  userId?: string | null,
  fallback: RolloutMode = 'off',
  step = '',
): RolloutMode {
  if (raw == null) return fallback;
  const v = raw.trim().toLowerCase();
  if (v === '') return fallback;
  if (OFF_WORDS.has(v)) return 'off';
  if (v === 'shadow') return 'shadow';
  if (ON_WORDS.has(v)) return 'on';

  // Prefixed or bare allowlist.
  let mode: RolloutMode = 'on';
  let list = v;
  const colon = v.indexOf(':');
  if (colon > 0) {
    const prefix = v.slice(0, colon);
    if (prefix === 'shadow') { mode = 'shadow'; list = v.slice(colon + 1); }
    else if (ON_WORDS.has(prefix)) { mode = 'on'; list = v.slice(colon + 1); }
    // An unknown prefix is NOT silently treated as an allowlist — a typo must fail CLOSED,
    // never accidentally enable a half-finished step for everyone.
    else return fallback;
  }

  const tokens = list.split(',').map((s) => s.trim()).filter(Boolean);
  if (tokens.length === 0) return fallback;
  const ids: string[] = [];
  let pct: number | null = null;
  for (const t of tokens) {
    if (!t.startsWith('pct')) { ids.push(t); continue; }
    const m = PCT_TOKEN.exec(t);
    const n = m ? Number(m[1]) : NaN;
    // A malformed or repeated percentage is a typo: fail CLOSED, never guess a cohort size.
    if (!Number.isInteger(n) || n < 0 || n > 100 || pct !== null) return fallback;
    pct = n;
  }
  if (!userId) return 'off'; // an allowlist / bucket with no user to match cannot be "on"
  const uid = userId.trim().toLowerCase();
  if (ids.includes(uid)) return mode;
  if (pct !== null && pct > 0 && rolloutBucket(step, uid) < pct) return mode;
  return 'off';
}

function readEnv(key: string): string | null {
  try {
    return Deno.env.get(key) ?? null;
  } catch {
    // Env permission denied (or non-Deno host): behave as if unset.
    return null;
  }
}

/**
 * Resolve the rollout mode for a step. `fallback` is what applies when neither the step key nor
 * `KOCHKO_ROLLOUT_DEFAULT` is set — keep it 'off' while a step is landing, flip the call site to
 * 'on' only once the step is proven and its gate is being retired.
 */
export function rolloutMode(
  step: string,
  userId?: string | null,
  fallback: RolloutMode = 'off',
): RolloutMode {
  const own = readEnv(rolloutEnvKey(step));
  if (own != null && own.trim() !== '') return parseRolloutValue(own, userId, fallback, step);
  if (V2_ROLLOUT_STEPS.includes(step.trim().toLowerCase())) return fallback;
  const dflt = readEnv('KOCHKO_ROLLOUT_DEFAULT');
  if (dflt != null && dflt.trim() !== '') return parseRolloutValue(dflt, userId, fallback, step);
  return fallback;
}

export const isRolloutOn = (step: string, userId?: string | null, fallback: RolloutMode = 'off'): boolean =>
  rolloutMode(step, userId, fallback) === 'on';

/**
 * AI_MIMARI_V2 §10 steps. Default OFF and deaf to KOCHKO_ROLLOUT_DEFAULT (see header). Rollback is
 * `supabase secrets set KOCHKO_ROLLOUT_<STEP>=off` — seconds, no deploy.
 *   v2_understand_shadow — Faz 2: Stage A + validateDecision after the v1 reply (waitUntil), no
 *                          writes except one ai_turn_log row; 'shadow' and 'on' both run it.
 *   v2_turn              — Faz 3: the v2 turn answers the user (no call site yet).
 *   v2_plan              — Faz 4: strict plan pipeline (no call site yet).
 *   v2_classifier        — §3.2 T2: parallel luna tripwire classifier (no call site yet).
 *   v2_stream            — Faz 6: Stage B streaming (no call site yet).
 */
export const V2_ROLLOUT_STEPS: readonly string[] = [
  'v2_understand_shadow', 'v2_turn', 'v2_plan', 'v2_classifier', 'v2_stream',
];

/**
 * Every step id that currently has a gate in the code. This list is the ONLY thing the turn ledger
 * stamps, so it must be kept in step with the call sites — a gate that is not listed here is
 * invisible in SQL, which is the failure class this whole stage exists to kill.
 * A step is REMOVED from this list only when its gate is retired (behaviour became unconditional).
 */
export const ACTIVE_ROLLOUT_STEPS: string[] = [
  'b1a_onboarding_hint',  // F1/B1a — an onboarding card's identity outranks keyword detection (ALGI-01)
  'b1a_active_intent',    // F1/B1a — an open plan negotiation survives a keyword-less message
  'b1a_return_flow',      // F1/B1a — return-flow context stops being gated on two modes
  ...V2_ROLLOUT_STEPS,    // AI_MIMARI_V2 §10 — default off; stamped only when their own key is set
];

/**
 * Compact ledger stamp for the turn log: `a1_ed_decay=shadow|b1_turn_mode=on`. Only non-'off'
 * steps are stamped, so a turn with no active gates costs zero bytes. This is what makes
 * "which users were on the new path, and when" answerable with one SQL instead of a guess.
 */
export function rolloutStamp(steps: string[], userId?: string | null): string {
  const parts: string[] = [];
  for (const s of steps) {
    const m = rolloutMode(s, userId);
    if (m !== 'off') parts.push(`${s}=${m}`);
  }
  return parts.join('|');
}
