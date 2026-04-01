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

// ─── Phase 5: Jet Lag & Travel Mode ───

/**
 * Detect timezone change from previous known timezone.
 */
export function detectTimezoneChange(previousTimezone: string | null): {
  changed: boolean;
  from: string | null;
  to: string;
  offsetDifference: number;
} {
  const current = detectTimezone();
  if (!previousTimezone || previousTimezone === current) {
    return { changed: false, from: previousTimezone, to: current, offsetDifference: 0 };
  }

  const prevOffset = getTimezoneOffsetHours(previousTimezone);
  const currOffset = getTimezoneOffsetHours(current);

  return {
    changed: true,
    from: previousTimezone,
    to: current,
    offsetDifference: currOffset - prevOffset,
  };
}

/**
 * Get jet lag grace period duration (48 hours from timezone change).
 * Returns remaining hours of grace or 0 if expired.
 */
export function getJetLagGracePeriod(timezoneChangedAt: string | null): {
  isActive: boolean;
  remainingHours: number;
} {
  if (!timezoneChangedAt) return { isActive: false, remainingHours: 0 };

  const changeTime = new Date(timezoneChangedAt).getTime();
  const graceDuration = 48 * 3600000; // 48 hours
  const elapsed = Date.now() - changeTime;
  const remaining = Math.max(0, graceDuration - elapsed);

  return {
    isActive: remaining > 0,
    remainingHours: Math.round(remaining / 3600000),
  };
}

/**
 * Adjust a schedule time for a new timezone.
 * Shifts hours by the offset difference.
 */
export function adjustScheduleForTimezone(
  time: string, // "HH:MM"
  offsetHours: number
): string {
  const [h, m] = time.split(':').map(Number);
  const newH = ((h + offsetHours) % 24 + 24) % 24;
  return `${newH.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
}
