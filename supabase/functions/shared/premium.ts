/**
 * Single server-side definition of "premium is active right now".
 *
 * profiles.premium can remain true for ~1-2 days past premium_expires_at because
 * the nightly expiry cron (expire_stale_subscriptions) only flips subscription
 * rows whose expires_at is older than a 1-day grace, and only that flip fires the
 * trigger that sets profiles.premium=false. So every premium gate MUST also honor
 * premium_expires_at, not just the boolean — otherwise an expired user keeps the
 * premium quota/feature set during the grace window.
 *
 * Mirrors the client helper isActivePremium() in src/lib/premium-gate.ts.
 */
export function isActivePremium(
  profile: { premium?: boolean | null; premium_expires_at?: string | null } | null | undefined,
): boolean {
  // FREE LAUNCH (owner decision, 2026-07-29): IAP is not wired yet, so the app ships with
  // everyone treated as premium. One env kill-switch — same idiom as the rollout gates, no
  // redeploy needed to end the free period (set to 'off' / unset when IAP lands).
  if ((Deno.env.get('KOCHKO_FREE_LAUNCH') ?? '').trim() === 'on') return true;
  if (!profile || profile.premium !== true) return false;
  const exp = profile.premium_expires_at;
  return !exp || new Date(exp) > new Date();
}
