/**
 * CROSS-RUNTIME CONTRACT — UI breadcrumbs (plan v2, F0 · B0 + A0).
 *
 * This directory is the ONE place a type may be shared by the Deno edge functions and the
 * React-Native client. Rules, enforced by scripts/seam-check.mjs:
 *   1. TYPE-ONLY. No `const`, `function`, `class`, `let`, `var` — nothing that survives to runtime.
 *      The client imports these with `import type`, so Metro never resolves the path and the edge
 *      keeps its own runtime list. A shared runtime value would couple two bundlers for no gain.
 *   2. ZERO imports. No remote URLs (tsc cannot resolve them), no `.ts`-extension imports (the
 *      client's resolver cannot), no Deno globals.
 * Break either rule and both typecheckers stop agreeing — which is the exact failure this
 * directory exists to end.
 *
 * WHY MARKERS: the repo's two most expensive mistakes were both "server green, UX broken", and
 * both were caught late because nothing tied a claim of "I drove it" to evidence. A marker is a
 * breadcrumb the CLIENT drops when it actually rendered or sent something; it rides along on the
 * next ai-chat request and the edge stamps it into ai_turn_log.ui_markers (migration 097). The
 * live gate then judges a drive with SQL instead of trusting memory.
 */

/**
 * Every breadcrumb the client may drop. Adding one here makes it a compile error on the client
 * until it is actually emitted, and a known token on the edge until it is actually accepted.
 */
export type UiMarker =
  /** The chat bubble rendered a plan proposal card (not just the Onayla/Değiştir buttons). */
  | 'plan_preview_rendered'
  /** The user tapped Onayla on a plan proposal AND the client sent an identified approval. */
  | 'plan_approve_sent'
  /** At least one write receipt (öğün/antrenman/profil fişi) was rendered in the thread. */
  | 'receipts_rendered'
  /** The glass-box memory mirror screen was opened. */
  | 'memory_mirror_opened'
  /** The user accepted a coaching offer/nudge and the client sent the offer identity. */
  | 'nudge_accept_sent'
  /** The user opened the "Düşünce süreci" panel on a message. */
  | 'reasoning_opened';

/** Shape of the optional `ui_markers` field on an ai-chat request body. */
export interface UiMarkerPayload {
  ui_markers?: UiMarker[];
}
