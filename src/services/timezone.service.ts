/**
 * Timezone & Travel Management Service
 * Spec 2.5: Saat dilimi ve seyahat yönetimi
 *
 * Detects timezone changes, adjusts IF windows, meal times,
 * notifications, and provides travel-aware coaching.
 */
import { supabase } from '@/lib/supabase';
// expo-localization may not be installed yet — use Intl fallback


export interface TimezoneChange {
  detected: boolean;
  homeTimezone: string;
  activeTimezone: string;
  offsetHours: number;
  isTraveling: boolean;
}

/**
 * Detect timezone change and determine if user is traveling.
 */
export async function detectTimezoneChange(userId: string): Promise<TimezoneChange> {
  const deviceTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'Europe/Istanbul';

  const { data } = await supabase
    .from('profiles')
    .select('home_timezone, active_timezone')
    .eq('id', userId)
    .single();

  const homeTimezone = data?.home_timezone ?? 'Europe/Istanbul';
  const storedActive = data?.active_timezone ?? homeTimezone;

  const changed = deviceTimezone !== storedActive;
  const isTraveling = deviceTimezone !== homeTimezone;

  const offsetHours = calculateOffsetDifference(homeTimezone, deviceTimezone);

  if (changed) {
    await supabase.from('profiles').update({ active_timezone: deviceTimezone }).eq('id', userId);
  }

  return {
    detected: changed,
    homeTimezone,
    activeTimezone: deviceTimezone,
    offsetHours,
    isTraveling,
  };
}

/**
 * Adjust IF eating window for timezone change (Spec 2.5).
 * If 6+ hour difference on same day, window is extended.
 */
export function adjustIFWindowForTimezone(
  eatingStart: string,
  eatingEnd: string,
  offsetHours: number,
): { adjustedStart: string; adjustedEnd: string; extended: boolean } {
  if (Math.abs(offsetHours) < 2) {
    return { adjustedStart: eatingStart, adjustedEnd: eatingEnd, extended: false };
  }

  const [startH, startM] = eatingStart.split(':').map(Number);
  const [endH, endM] = eatingEnd.split(':').map(Number);

  const newStartH = (startH + offsetHours + 24) % 24;
  const newEndH = (endH + offsetHours + 24) % 24;

  // If 6+ hour difference, extend window by 2 hours on first day
  const extended = Math.abs(offsetHours) >= 6;
  const extensionH = extended ? 2 : 0;

  return {
    adjustedStart: `${String(newStartH).padStart(2, '0')}:${String(startM).padStart(2, '0')}`,
    adjustedEnd: `${String((newEndH + extensionH) % 24).padStart(2, '0')}:${String(endM).padStart(2, '0')}`,
    extended,
  };
}

/**
 * Get travel coaching context for AI (Spec 2.5).
 */
export function getTravelContext(activeTimezone: string): string {
  const tzLower = activeTimezone.toLowerCase();

  if (tzLower.includes('asia/tokyo') || tzLower.includes('asia/seoul')) {
    return 'Kullanici Japonya/Kore bolgesinde. Yerel yemekler: ramen, sushi, yakitori, bibimbap. Makro tahmini guven: Orta.';
  }
  if (tzLower.includes('europe') && !tzLower.includes('istanbul')) {
    return 'Kullanici Avrupa\'da seyahatte. Yerel yemekler bolgeye gore degisir. Makro tahmini guven: Orta.';
  }
  if (tzLower.includes('america')) {
    return 'Kullanici Amerika\'da. Porsiyon buyuklukleri Turkiye\'ye gore daha buyuk olabilir. Makro tahmini guven: Orta.';
  }
  return '';
}

function calculateOffsetDifference(tz1: string, tz2: string): number {
  try {
    const now = new Date();
    const d1 = new Date(now.toLocaleString('en-US', { timeZone: tz1 }));
    const d2 = new Date(now.toLocaleString('en-US', { timeZone: tz2 }));
    return Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60));
  } catch {
    return 0;
  }
}
