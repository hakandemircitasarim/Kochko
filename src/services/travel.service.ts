/**
 * Travel & Timezone Service
 * Spec 15: Saat dilimi ve seyahat — nereye gidersen git yanında
 *
 * Timezone değişikliği algılama, jet lag grace period, öğün zamanlama ayarı.
 */

// ─── Types ───

export interface TravelStatus {
  isTraveling: boolean;
  homeTimezone: string;
  currentTimezone: string;
  timezoneOffset: number; // hours difference
  jetLagGraceActive: boolean;
  graceExpiresAt: string | null;
}

// ─── Timezone Detection ───

/**
 * Detect current timezone using Intl API.
 */
export function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'Europe/Istanbul'; // default for Turkish users
  }
}

/**
 * Check if user is in a different timezone than their home timezone.
 */
export function isInDifferentTimezone(homeTimezone: string): boolean {
  const current = detectTimezone();
  return current !== homeTimezone;
}

/**
 * Calculate timezone offset in hours.
 */
export function getTimezoneOffset(homeTimezone: string, currentTimezone: string): number {
  try {
    const now = new Date();
    const homeOffset = getOffsetMinutes(now, homeTimezone);
    const currentOffset = getOffsetMinutes(now, currentTimezone);
    return Math.round((currentOffset - homeOffset) / 60);
  } catch {
    return 0;
  }
}

function getOffsetMinutes(date: Date, timezone: string): number {
  const utcStr = date.toLocaleString('en-US', { timeZone: 'UTC' });
  const tzStr = date.toLocaleString('en-US', { timeZone: timezone });
  return (new Date(tzStr).getTime() - new Date(utcStr).getTime()) / 60000;
}

// ─── Travel Mode ───

/**
 * Detect travel mode based on timezone change.
 */
export function detectTravelMode(
  homeTimezone: string,
  lastKnownTimezone: string | null
): TravelStatus {
  const current = detectTimezone();
  const isTraveling = current !== homeTimezone;
  const offset = isTraveling ? getTimezoneOffset(homeTimezone, current) : 0;

  // Jet lag grace period: 48 hours after timezone change
  const justChanged = lastKnownTimezone !== null && current !== lastKnownTimezone;
  let graceActive = false;
  let graceExpires: string | null = null;

  if (justChanged && Math.abs(offset) >= 2) {
    graceActive = true;
    graceExpires = new Date(Date.now() + 48 * 3600000).toISOString();
  }

  return {
    isTraveling,
    homeTimezone,
    currentTimezone: current,
    timezoneOffset: offset,
    jetLagGraceActive: graceActive,
    graceExpiresAt: graceExpires,
  };
}

// ─── Jet Lag Grace Period ───

/**
 * Apply jet lag grace period — relax timing rules for 48 hours.
 */
export function applyJetLagGrace(
  normalMealTimes: { breakfast: string; lunch: string; dinner: string },
  timezoneOffset: number
): {
  adjustedTimes: { breakfast: string; lunch: string; dinner: string };
  isGraceActive: boolean;
  message: string;
} {
  if (Math.abs(timezoneOffset) < 2) {
    return { adjustedTimes: normalMealTimes, isGraceActive: false, message: '' };
  }

  // Shift meal times by timezone offset
  const shift = (time: string, offsetHours: number): string => {
    const [h, m] = time.split(':').map(Number);
    const newH = ((h + offsetHours) % 24 + 24) % 24;
    return `${newH.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  };

  return {
    adjustedTimes: {
      breakfast: shift(normalMealTimes.breakfast, timezoneOffset),
      lunch: shift(normalMealTimes.lunch, timezoneOffset),
      dinner: shift(normalMealTimes.dinner, timezoneOffset),
    },
    isGraceActive: true,
    message: `Saat dilimi degisti (${timezoneOffset > 0 ? '+' : ''}${timezoneOffset} saat). Ogun saatlerini ayarladim. 48 saat boyunca zamanlama kurallari esnetildi.`,
  };
}

// ─── Schedule Adjustment ───

/**
 * Adjust all daily scheduling (meals, notifications, IF window) for new timezone.
 */
export function adjustScheduleForTimezone(
  schedule: {
    mealTimes: { breakfast: string; lunch: string; dinner: string };
    ifStart?: string;
    ifEnd?: string;
    notificationTimes: string[];
  },
  timezoneOffset: number
): typeof schedule {
  if (timezoneOffset === 0) return schedule;

  const shiftTime = (time: string): string => {
    const [h, m] = time.split(':').map(Number);
    const newH = ((h + timezoneOffset) % 24 + 24) % 24;
    return `${newH.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  };

  return {
    mealTimes: {
      breakfast: shiftTime(schedule.mealTimes.breakfast),
      lunch: shiftTime(schedule.mealTimes.lunch),
      dinner: shiftTime(schedule.mealTimes.dinner),
    },
    ifStart: schedule.ifStart ? shiftTime(schedule.ifStart) : undefined,
    ifEnd: schedule.ifEnd ? shiftTime(schedule.ifEnd) : undefined,
    notificationTimes: schedule.notificationTimes.map(shiftTime),
  };
}

/**
 * Build travel context for AI system prompt.
 */
export function buildTravelContext(status: TravelStatus): string {
  if (!status.isTraveling) return '';

  const parts: string[] = [
    `## SEYAHAT MODU`,
    `Ev: ${status.homeTimezone} | Simdi: ${status.currentTimezone} (${status.timezoneOffset > 0 ? '+' : ''}${status.timezoneOffset} saat)`,
  ];

  if (status.jetLagGraceActive) {
    parts.push(`JET LAG GRACE: Aktif (48 saat esnek zamanlama). Kati ogun saatlerine ZORLAMA.`);
  }

  parts.push(`Ogun saatleri yerel saate gore ayarlandi.`);
  parts.push(`Bulundugu bolgenin mutfak kulturune uygun oneriler yap.`);

  return parts.join('\n');
}
