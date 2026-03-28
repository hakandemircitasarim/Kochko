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
export function getEffectiveDate(
  currentTime: Date,
  dayBoundaryHour: number = 4 // 04:00 default
): string {
  const hour = currentTime.getHours();

  if (hour < dayBoundaryHour) {
    // Before boundary → belongs to yesterday
    const yesterday = new Date(currentTime);
    yesterday.setDate(yesterday.getDate() - 1);
    return yesterday.toISOString().split('T')[0];
  }

  return currentTime.toISOString().split('T')[0];
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
