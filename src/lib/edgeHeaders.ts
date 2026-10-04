import Constants from 'expo-constants';

/**
 * The region every edge-function invocation is pinned to: the DATABASE's region.
 *
 * WHY (measured 2026-10-04): by default Supabase runs a function in the region nearest the CALLER.
 * For a phone in Turkey that is eu-central-1 (Frankfurt), while this project's Postgres lives in
 * ap-southeast-1 (Singapore). ai-chat makes dozens of database round-trips per turn, and every one
 * of them crossed Frankfurt↔Singapore: the same turn spent ~10.5 s outside the LLM call when it ran
 * in Frankfurt and ~2.5 s when pinned here. Paying the long hop ONCE (phone → Singapore) instead of
 * once per query is the single biggest latency lever this app has.
 *
 * Supabase has no project-wide default for this — it can only be chosen per request — so the pin
 * lives here, next to the other header every invocation carries. Override with
 * EXPO_PUBLIC_SUPABASE_FUNCTION_REGION if the database ever moves.
 */
const FUNCTION_REGION = process.env.EXPO_PUBLIC_SUPABASE_FUNCTION_REGION || 'ap-southeast-1';

/**
 * Headers every edge-function invocation carries (plan v2, F0 · A00).
 *
 * WHY: an APK stays on a phone for weeks. The server therefore talks to several client versions at
 * once and today has NO way to know which — so it cannot skip a field an old build would choke on,
 * and "how many users are still on the build that can't render X?" is unanswerable. One header
 * makes the asymmetry visible before it becomes a support ticket.
 *
 * Kept deliberately tiny: no device id, no locale, nothing that turns a debugging aid into a
 * tracking surface.
 */
export function edgeHeaders(opts: { pinRegion?: boolean } = {}): Record<string, string> {
  const version = (Constants.expoConfig?.version as string | undefined) ?? 'unknown';
  // Pinning disables Supabase's own failover to another region. Callers with a retry loop pass
  // pinRegion:false on their LAST attempt, so a regional outage costs latency, not the reply.
  if (opts.pinRegion === false) return { 'x-app-version': version };
  return { 'x-app-version': version, 'x-region': FUNCTION_REGION };
}
