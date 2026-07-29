/**
 * Persistent notice dismissals — ONE owner (ux-defect pass, 2026-07-29).
 *
 * WHY: the dashboard's dismissable cards (streak-reset, streak-at-risk, return banner) kept
 * their "dismissed" bit in useState — every app restart resurrected every card the user had
 * closed ("kapattığım kart geri geliyor"). Only the weekly recap persisted (its own ad-hoc
 * AsyncStorage key). This module is the single pattern for all of them.
 *
 * SEMANTICS — a dismissal has a SCOPE, matching what the notice means:
 *   'day'     → gone for the rest of the user's local day (restarts included); a card whose
 *               CONDITION still holds tomorrow may honestly return tomorrow.
 *   'week'    → gone for the ISO week of dismissal (weekly recap semantics).
 *   'forever' → never again.
 */
import { safeGetString, safeSetString } from '@/lib/safe-storage';

export type DismissScope = 'day' | 'week' | 'forever';

const keyOf = (userId: string, noticeKey: string) => `@kochko_dismissed:${userId}:${noticeKey}`;

const localDayISO = (d = new Date()): string => {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/** The app's day flips at dayBoundaryHour (default 4:00), not midnight — a 23:30 dismissal must
 * NOT re-arm at 00:00 while the user is still in the same evening. */
const effectiveDay = (boundaryHour: number): string =>
  localDayISO(new Date(Date.now() - boundaryHour * 3600_000));

const mondayISO = (d = new Date()): string => {
  const x = new Date(d);
  const wd = (x.getDay() + 6) % 7; // Mon=0
  x.setDate(x.getDate() - wd);
  return localDayISO(x);
};

const stampFor = (scope: DismissScope, boundaryHour: number): string =>
  scope === 'day' ? effectiveDay(boundaryHour) : scope === 'week' ? mondayISO() : 'forever';

/** True when the notice was dismissed within the given scope window. */
export async function isDismissed(userId: string, noticeKey: string, scope: DismissScope, boundaryHour = 4): Promise<boolean> {
  const stored = await safeGetString(keyOf(userId, noticeKey));
  if (!stored) return false;
  if (scope === 'forever') return true;
  return stored === stampFor(scope, boundaryHour);
}

/** Record a dismissal (fire-and-forget safe — storage errors never break the UI). */
export function markDismissed(userId: string, noticeKey: string, scope: DismissScope, boundaryHour = 4): void {
  void safeSetString(keyOf(userId, noticeKey), stampFor(scope, boundaryHour));
}
