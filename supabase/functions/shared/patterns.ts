/**
 * BEHAVIOURAL-PATTERN READ PREDICATE (plan v2, F2 · A12).
 *
 * PURE by design: no DB client, no imports. `memory.ts` owns the WRITE side of a pattern's life
 * (evolvePatternConfidence marks 'stale' after 60 silent days and 'resolved' when the user says it
 * no longer applies) but importing it pulls in the admin client, so the predicate could not live
 * there without dragging a database into every reader — and into its unit test.
 *
 * WHY IT EXISTS AT ALL: exactly ONE of four readers honoured those statuses. The always-on
 * situational snapshot and two ai-proactive trigger paths read the raw array, so a habit the user
 * resolved four months ago kept shaping the coach's opening line and kept firing Friday-evening
 * nudges. The write side of forgetting worked; the read side never did.
 */

/** Statuses that mean "the coach may still act on this". Unset status = legacy row = active. */
// Accepts any record shape — callers hold rows typed as Record<string, unknown>, plain object
// literals, or narrower structs, and forcing a single struct here would just push casts outward.
export function isActivePattern(p: { status?: unknown } | Record<string, unknown>): boolean {
  const st = typeof (p as { status?: unknown })?.status === 'string' ? (p as { status: string }).status : 'active';
  return st !== 'resolved' && st !== 'stale';
}

/** Filter a raw behavioral_patterns array down to what the coach may still act on. */
export function activePatterns<T>(raw: T[] | null | undefined): T[] {
  return (raw ?? []).filter((p) => isActivePattern(p as Record<string, unknown>));
}
