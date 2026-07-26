import type { UiMarker } from './contracts/ui-markers.ts';

/**
 * Edge-side runtime half of the UI-breadcrumb contract (plan v2, F0 · A0).
 *
 * The TYPE lives in shared/contracts/ (readable by both runtimes, type-only). The runtime
 * allowlist lives here, where only Deno can see it — so the client never has to resolve a module
 * outside src/, and an unknown marker from an old or tampered client is dropped instead of being
 * written into the ledger.
 */
export const UI_MARKERS: readonly UiMarker[] = [
  'plan_preview_rendered',
  'plan_approve_sent',
  'receipts_rendered',
  'memory_mirror_opened',
  'nudge_accept_sent',
  'reasoning_opened',
] as const;

const ALLOWED = new Set<string>(UI_MARKERS as readonly string[]);
const MAX_MARKERS = 12;

/**
 * Accept the `ui_markers` field off a request body. Unknown tokens are dropped (an old client, or
 * junk), duplicates collapse, and the list is capped — a breadcrumb channel must never become a
 * way to write arbitrary text into the turn ledger. Returns null when there is nothing to stamp,
 * so the column stays NULL rather than an empty array (NULL = "this build didn't report").
 */
export function sanitizeUiMarkers(raw: unknown): UiMarker[] | null {
  if (!Array.isArray(raw)) return null;
  const out: UiMarker[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    if (!ALLOWED.has(v)) continue;
    if (out.includes(v as UiMarker)) continue;
    out.push(v as UiMarker);
    if (out.length >= MAX_MARKERS) break;
  }
  return out.length > 0 ? out : null;
}
