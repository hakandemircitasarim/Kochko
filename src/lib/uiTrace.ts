import type { UiMarker } from '@contracts/ui-markers';

/**
 * UI BREADCRUMBS (plan v2, F0 · A0) — the client half of the live gate.
 *
 * WHY: this repo has lost the same bet twice — "server green, UX broken" — because the only
 * evidence a change actually reached the user was a human saying "I drove it". Screens render,
 * buttons fire, and none of it leaves a trace anyone can query later.
 *
 * WHAT: when the client actually renders or sends something that matters, it drops a marker. The
 * markers ride along on the NEXT ai-chat request (they are drained into the request body) and the
 * edge stamps them into `ai_turn_log.ui_markers` (migration 097). A drive is then judged by SQL:
 *
 *   select ui_markers, created_at from ai_turn_log
 *   where user_id = '<test>' and created_at > now() - interval '20 minutes';
 *
 * DESIGN NOTES
 *  - No new table, no analytics SDK, no network call of its own (§8: no new layer).
 *  - Bounded: at most MAX_PENDING markers are held, deduped, and they are DRAINED on send, so a
 *    long session cannot grow the payload.
 *  - Fire-and-forget: `trace()` can never throw into a render path.
 *  - Type-safe: `UiMarker` comes from the cross-runtime contract, so a typo is a compile error on
 *    both sides instead of a marker that silently never matches.
 */

const MAX_PENDING = 12;
let pending: UiMarker[] = [];

/** Drop a breadcrumb. Safe to call from render, effects, or handlers. */
export function trace(marker: UiMarker): void {
  try {
    if (pending.includes(marker)) return;          // dedupe: presence is the signal, not the count
    if (pending.length >= MAX_PENDING) pending.shift();
    pending.push(marker);
  } catch {
    /* a breadcrumb must never break the screen it is observing */
  }
}

/** Take everything collected so far and clear the buffer. Called when building a request body. */
export function drainMarkers(): UiMarker[] {
  if (pending.length === 0) return [];
  const out = pending;
  pending = [];
  return out;
}

/** Read without draining — for debug screens only. */
export function peekMarkers(): readonly UiMarker[] {
  return pending;
}
