/**
 * Day Boundary Logic
 * Spec 2.8: Gün sınırı tanımı
 *
 * Default: 04:00 - records before this hour belong to previous day.
 * Personalizable based on user's sleep patterns.
 */

/**
 * Get the effective date for a log entry, considering day boundary.
 * If current time is before the boundary hour, the entry belongs to yesterday.
 */
/** Format a Date as YYYY-MM-DD using LOCAL calendar components (not UTC). */
function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Render a stored `YYYY-MM-DD` for a human to read.
 *
 * The app stores dates as ISO calendar strings — correct — but several surfaces printed
 * them straight into the UI. Driven on a device: "Sağlık Geçmişi" listed an event as
 * "2026-08-05" while the very field that created it, one screen earlier, said
 * "5 Ağustos 2026"; and settings/goals said "Tahmini tamamlanma: 2026-10-30" while the
 * dashboard card showed the SAME datum as "30 Eki".
 *
 * Anchored at noon on purpose: `new Date('2026-08-05')` parses as UTC midnight, which in
 * UTC+3 is still the 5th but in any negative offset rolls back to the 4th. Noon is safe
 * in every zone the app ships to.
 *
 * Returns null for a missing/unparseable value so callers can hide the row instead of
 * printing "Invalid Date".
 */
export function formatISODateTR(
  iso: string | null | undefined,
  style: 'short' | 'long' = 'long',
): string | null {
  if (!iso) return null;
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString(
    'tr-TR',
    style === 'short'
      ? { day: 'numeric', month: 'short' }
      : { day: 'numeric', month: 'long', year: 'numeric' },
  );
}

export function getEffectiveDate(
  currentTime: Date,
  dayBoundaryHour: number = 4 // 04:00 default
): string {
  // The boundary check (getHours) and the returned date must be in the SAME
  // (local/device) timezone. Mixing local getHours() with UTC toISOString()
  // caused an off-by-one for late-night logs in UTC+ timezones.
  const hour = currentTime.getHours();
  const d = new Date(currentTime);
  if (hour < dayBoundaryHour) {
    // Before boundary → belongs to yesterday
    d.setDate(d.getDate() - 1);
  }
  return toLocalDateStr(d);
}

/**
 * Check if a given time falls within the "night" period
 * for the user (between their sleep time and wake time).
 * Used for night eating risk warnings.
 */
export function isNightPeriod(
  currentHour: number,
  sleepHour: number = 23,
  wakeHour: number = 7
): boolean {
  if (sleepHour > wakeHour) {
    // Normal case: sleep at 23, wake at 7
    return currentHour >= sleepHour || currentHour < wakeHour;
  }
  // Edge case: sleep at 2, wake at 10 (shift workers)
  return currentHour >= sleepHour && currentHour < wakeHour;
}

/**
 * Get the report trigger time for a user.
 * Spec 8.1: Daily report generated at day boundary or first next-day login.
 */
export function getDailyReportTriggerHour(dayBoundaryHour: number = 4): number {
  // Report should be generated shortly after day boundary
  return dayBoundaryHour + 1; // e.g., 05:00 for default boundary
}

/**
 * Determine if streak should count for today.
 * A day "counts" if the user has at least 1 meal log before the day boundary.
 */
export function doesDayCountForStreak(
  lastMealLogTime: Date | null,
  dayBoundaryHour: number = 4
): boolean {
  if (!lastMealLogTime) return false;

  const now = new Date();
  const effectiveToday = getEffectiveDate(now, dayBoundaryHour);
  const effectiveMealDay = getEffectiveDate(lastMealLogTime, dayBoundaryHour);

  return effectiveMealDay === effectiveToday;
}
