/**
 * Timezone detection and travel utilities.
 * Uses Intl API (available in Hermes engine) - no extra dependencies needed.
 */

const DEFAULT_TIMEZONE = 'Europe/Istanbul';
const DEFAULT_OFFSET = 3; // UTC+3

/**
 * Get the device's current timezone.
 * Falls back to 'Europe/Istanbul' if detection fails.
 */
export function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}

/**
 * Check if the user's active timezone differs from their home timezone.
 * Used to trigger travel-mode detection (Spec 2.5).
 */
export function isInDifferentTimezone(homeTimezone: string): boolean {
  const current = detectTimezone();
  return current !== homeTimezone;
}

/**
 * Get timezone offset in hours for display.
 */
export function getTimezoneOffsetHours(timezone: string): number {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'shortOffset',
    });
    const parts = formatter.formatToParts(now);
    const offsetPart = parts.find(p => p.type === 'timeZoneName')?.value ?? '';
    const match = offsetPart.match(/GMT([+-]\d+)/);
    return match ? parseInt(match[1], 10) : DEFAULT_OFFSET;
  } catch {
    return DEFAULT_OFFSET;
  }
}

/**
 * Get a human-readable timezone label.
 * Example: "Europe/Istanbul" -> "Istanbul (UTC+3)"
 */
export function formatTimezoneLabel(timezone: string): string {
  const city = timezone.split('/').pop()?.replace(/_/g, ' ') ?? timezone;
  const offset = getTimezoneOffsetHours(timezone);
  const sign = offset >= 0 ? '+' : '';
  return `${city} (UTC${sign}${offset})`;
}
