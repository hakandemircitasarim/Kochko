/**
 * Server-side day boundary (Spec 2.8) — mirrors src/lib/day-boundary.ts.
 *
 * A log made at 02:42 local time belongs to the PREVIOUS calendar day when the
 * user's day_boundary_hour is 4 (late-night eating counts toward the day that
 * just ended). The old edge behavior used the raw UTC calendar date, which put
 * an Istanbul (UTC+3) dinner logged 21:30 local on the SAME date only by luck
 * and an evening US-timezone meal on TOMORROW's date.
 *
 * Timezone precedence at call sites: client_timezone (freshest, from device)
 * → profiles.active_timezone (server-tracked travel tz) → profiles.home_timezone
 * → UTC fallback.
 */

/** YYYY-MM-DD of the user's *effective* day, honoring tz + day boundary hour. */
export function getEffectiveDateForUser(
  tz: string | null | undefined,
  dayBoundaryHour: number | null | undefined,
  now: Date = new Date(),
): string {
  // 4 is both the profiles.day_boundary_hour column default and the client default.
  const boundary = typeof dayBoundaryHour === 'number' ? dayBoundaryHour : 4;
  try {
    if (tz) {
      const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        hour12: false,
      });
      const parts = fmt.formatToParts(now).reduce((acc, p) => {
        if (p.type !== 'literal') acc[p.type] = p.value;
        return acc;
      }, {} as Record<string, string>);
      // Some ICU builds render midnight as "24" with hour12:false.
      const localHour = parseInt(parts.hour ?? '0', 10) % 24;
      const local = new Date(Date.UTC(+parts.year, +parts.month - 1, +parts.day));
      if (localHour < boundary) local.setUTCDate(local.getUTCDate() - 1);
      return local.toISOString().split('T')[0];
    }
  } catch { /* invalid tz name → UTC fallback */ }
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  if (now.getUTCHours() < boundary) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().split('T')[0];
}

/** Shift an effective date string by whole days ("dün" backdates etc.). */
export function shiftDateString(dateStr: string, offsetDays: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().split('T')[0];
}

/**
 * User-local wall-clock parts honoring tz. The Deno edge runtime is UTC, so
 * Date.prototype.getHours()/toISOString() yield UTC — wrong for "morning/evening"
 * reasoning and for bucketing learned meal/snack hours. (audit AI-CTX-02 / AI-MEM-02)
 */
export function getLocalParts(
  tz: string | null | undefined,
  now: Date = new Date(),
): { year: number; month: number; day: number; hour: number; minute: number; dateStr: string } {
  try {
    if (tz) {
      const fmt = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', hour12: false,
      });
      const parts = fmt.formatToParts(now).reduce((acc, p) => {
        if (p.type !== 'literal') acc[p.type] = p.value;
        return acc;
      }, {} as Record<string, string>);
      const hour = parseInt(parts.hour ?? '0', 10) % 24; // some ICU builds render midnight as "24"
      const minute = parseInt(parts.minute ?? '0', 10);
      return {
        year: +parts.year, month: +parts.month, day: +parts.day,
        hour, minute, dateStr: `${parts.year}-${parts.month}-${parts.day}`,
      };
    }
  } catch { /* invalid tz name → UTC fallback */ }
  return {
    year: now.getUTCFullYear(), month: now.getUTCMonth() + 1, day: now.getUTCDate(),
    hour: now.getUTCHours(), minute: now.getUTCMinutes(),
    dateStr: now.toISOString().split('T')[0],
  };
}

/** User-local hour (0-23) of a timestamp, honoring tz. */
export function getLocalHour(tz: string | null | undefined, when: Date): number {
  return getLocalParts(tz, when).hour;
}
