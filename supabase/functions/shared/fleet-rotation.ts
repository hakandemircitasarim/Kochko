/**
 * Fleet rotation for the extraction cron.
 *
 * `ai-extractor` picked its work with `.select('id').eq('onboarding_completed', true).limit(100)`
 * and NO `order()`. Postgres without ORDER BY returns rows in physical order, which in practice
 * is the same set every run — so the 101st profile onward was never extracted at all. Not a
 * slowdown: those users' AI summaries silently never updated, and nothing anywhere said so.
 *
 * The function already keeps a per-user, per-tier checkpoint
 * (`ai_summary.extraction_checkpoint = { tier2_last: ISO, tier3_last: ISO }`), which is exactly
 * the key to rotate on. Order: never-extracted users first (they have the most to gain and are
 * the ones a naive limit starves hardest), then oldest checkpoint first.
 *
 * Scale note: the caller reads every profile id and every checkpoint to sort in memory. That is
 * fine for this app's fleet and keeps the rule obvious. If the fleet ever outgrows that, move the
 * ordering into Postgres (`order=extraction_checkpoint->>tier2_last.asc.nullsfirst`) and handle
 * the users who have no `ai_summary` row at all as a separate, higher-priority page.
 */

/** ISO timestamp of the last extraction per tier key, as stored in `extraction_checkpoint`. */
export type CheckpointMap = Record<string, string | undefined>;

/**
 * Order `userIds` so the most-starved users come first, then take `limit`.
 *
 * - a user with no checkpoint for `key` (never extracted, or no `ai_summary` row) sorts first
 * - otherwise older checkpoint sorts before newer
 * - ties keep their incoming order, so the result is stable
 */
export function selectFleetBatch(
  userIds: string[],
  checkpoints: Map<string, CheckpointMap>,
  key: string,
  limit: number,
): string[] {
  const stamp = (id: string): string | null => {
    const v = checkpoints.get(id)?.[key];
    return typeof v === 'string' && v.length > 0 ? v : null;
  };
  // Decorate with the original index so equal stamps keep input order (Array.sort is stable in
  // modern engines, but being explicit costs nothing and survives an engine that isn't).
  return userIds
    .map((id, i) => ({ id, i, s: stamp(id) }))
    .sort((a, b) => {
      if (a.s === null && b.s === null) return a.i - b.i;
      if (a.s === null) return -1;
      if (b.s === null) return 1;
      if (a.s === b.s) return a.i - b.i;
      return a.s < b.s ? -1 : 1;
    })
    .slice(0, Math.max(0, limit))
    .map(x => x.id);
}
