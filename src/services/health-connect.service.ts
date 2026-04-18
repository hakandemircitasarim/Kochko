/**
 * Health Connect / Apple Health Integration Service
 * Spec 14.1: Wearable ve sağlık platformu entegrasyonları.
 *
 * Provides unified interface for:
 * - Apple Health (iOS) via expo-health
 * - Google Health Connect (Android) via expo-health
 * - Step data, heart rate, sleep, HRV
 *
 * Note: Requires expo-health or react-native-health package
 * and platform-specific configuration (entitlements, permissions).
 */

export type HealthDataType = 'steps' | 'heart_rate' | 'sleep' | 'hrv' | 'weight';

export interface HealthDataPoint {
  type: HealthDataType;
  value: number;
  unit: string;
  startDate: string;
  endDate: string;
  source: 'apple_health' | 'google_fit' | 'wearable';
}

// Dynamic Pedometer import — runtime require so TS/metro bundle doesn't fail if
// expo-sensors hasn't been installed yet. After `expo install expo-sensors` +
// native rebuild, step tracking becomes live automatically.
interface PedometerModule {
  isAvailableAsync: () => Promise<boolean>;
  requestPermissionsAsync: () => Promise<{ granted: boolean; status: string }>;
  getStepCountAsync: (start: Date, end: Date) => Promise<{ steps: number }>;
}
function loadPedometer(): PedometerModule | null {
  try {
    // Metro/RN resolve at runtime; try/catch avoids hard dependency at build time.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('expo-sensors') as { Pedometer?: PedometerModule };
    return mod?.Pedometer ?? null;
  } catch {
    return null;
  }
}

/**
 * Check if a step-counter is available on this device.
 * True when expo-sensors Pedometer is installed AND device supports it.
 */
export async function isHealthAvailable(): Promise<boolean> {
  const pedometer = loadPedometer();
  if (!pedometer) return false;
  try {
    return await pedometer.isAvailableAsync();
  } catch {
    return false;
  }
}

/**
 * Request permissions for health data access. Only pedometer is wired right
 * now; HRV/sleep will be added when HealthKit / Health Connect SDKs ship.
 */
export async function requestHealthPermissions(
  _types: HealthDataType[]
): Promise<boolean> {
  const pedometer = loadPedometer();
  if (!pedometer) return false;
  try {
    const res = await pedometer.requestPermissionsAsync();
    return res.granted === true;
  } catch {
    return false;
  }
}

/**
 * Fetch today's step count from the platform pedometer.
 * Returns null if module unavailable or permission denied.
 */
export async function getTodaySteps(): Promise<number | null> {
  const pedometer = loadPedometer();
  if (!pedometer) return null;
  try {
    const available = await pedometer.isAvailableAsync();
    if (!available) return null;

    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);

    const result = await pedometer.getStepCountAsync(start, now);
    return result?.steps ?? null;
  } catch {
    return null;
  }
}

/**
 * Fetch recent sleep data.
 * Returns empty array with structure ready for real implementation.
 */
export async function getRecentSleep(_days: number = 7): Promise<HealthDataPoint[]> {
  // TODO: Replace with real sleep data query:
  // iOS: HKCategoryType.categoryType(forIdentifier: .sleepAnalysis)
  // Android: SleepSessionRecord via Health Connect
  // Expected return shape:
  // [{ type: 'sleep', value: 7.5, unit: 'hours', startDate: '...', endDate: '...', source: 'apple_health' }]
  return [];
}

/**
 * Fetch HRV data for recovery assessment (Spec 14.1).
 * Low HRV = poor recovery, suggest light activity.
 * High HRV = good recovery, suggest intense training.
 */
export async function getLatestHRV(): Promise<number | null> {
  // TODO: Replace with real HRV query:
  // iOS: HKQuantityType.quantityType(forIdentifier: .heartRateVariabilitySDNN)
  // Android: Not natively available in Health Connect; requires wearable SDK
  return null;
}

/**
 * Sync weight from smart scale (if connected).
 */
export async function getLatestWeight(): Promise<number | null> {
  // TODO: Replace with real weight query:
  // iOS: HKQuantityType.quantityType(forIdentifier: .bodyMass)
  // Android: WeightRecord via Health Connect
  return null;
}

/**
 * Syncs today's pedometer step count to daily_metrics.steps.
 * Idempotent: only writes if the platform reading is higher than stored value.
 * Safe to call on dashboard mount / app foreground.
 */
import { supabase } from '@/lib/supabase';

export async function syncStepsToDailyMetrics(userId: string, dayBoundaryHour: number = 4): Promise<number | null> {
  const steps = await getTodaySteps();
  if (steps === null) return null;

  // Use day-boundary-aware date
  const now = new Date();
  const effective = new Date(now);
  if (now.getHours() < dayBoundaryHour) effective.setDate(effective.getDate() - 1);
  const date = effective.toISOString().split('T')[0];

  const { data: existing } = await supabase
    .from('daily_metrics').select('steps').eq('user_id', userId).eq('date', date).maybeSingle();
  const current = (existing?.steps as number | null) ?? 0;

  // Only update if pedometer reading is larger (e.g., manual entry might be ahead mid-day; rare)
  if (steps > current) {
    await supabase.from('daily_metrics').upsert({
      user_id: userId,
      date,
      steps,
      steps_source: 'phone',
    }, { onConflict: 'user_id,date' });
  }
  return steps;
}

export type RecoveryScore = 'good' | 'moderate' | 'poor' | 'unknown';
export type SorenessLevel = 'none' | 'light' | 'moderate' | 'severe';

export interface RecoveryResult {
  score: RecoveryScore;
  message_tr: string;
  trainingRecommendation: string;
}

/**
 * Evaluate recovery readiness based on HRV, sleep hours, and muscle soreness.
 * Spec 14.1: HRV + uyku + kas agrisi birlikte degerlendirilir.
 *
 * Rules:
 * - HRV > 60 + sleep > 7 + soreness none/light = "good"
 * - HRV 40-60 OR sleep 5-7 OR soreness moderate = "moderate"
 * - Else = "poor"
 */
export function evaluateRecovery(
  hrv: number | null,
  sleepHours: number | null,
  muscleSoreness: SorenessLevel | null
): RecoveryResult {
  // If we have no data at all, return unknown
  if (hrv == null && sleepHours == null && muscleSoreness == null) {
    return {
      score: 'unknown',
      message_tr: 'Toparlanma durumunu degerlendirmek icin yeterli veri yok.',
      trainingRecommendation: 'Veri toplandikca daha iyi onerilerde bulunabiliriz.',
    };
  }

  // Check for "good" recovery: all indicators positive
  const hrvGood = hrv != null && hrv > 60;
  const sleepGood = sleepHours != null && sleepHours > 7;
  const sorenessGood = muscleSoreness === 'none' || muscleSoreness === 'light';

  // Check for "poor" indicators
  const hrvPoor = hrv != null && hrv < 40;
  const sleepPoor = sleepHours != null && sleepHours < 5;
  const sorenessPoor = muscleSoreness === 'severe';

  // Good: all available data points are positive
  if (
    (hrv == null || hrvGood) &&
    (sleepHours == null || sleepGood) &&
    (muscleSoreness == null || sorenessGood) &&
    // At least one data point must confirm good
    (hrvGood || sleepGood || sorenessGood)
  ) {
    return {
      score: 'good',
      message_tr: 'Toparlanman iyi gorunuyor. Bugun yogun antrenman yapabilirsin.',
      trainingRecommendation: 'Agir bilesik hareketler, HIIT veya yogun hacimli antrenman uygun.',
    };
  }

  // Poor: any severe indicator
  if (hrvPoor || sleepPoor || sorenessPoor) {
    return {
      score: 'poor',
      message_tr: 'Toparlanman zayif. Bugün hafif aktivite veya dinlenme onerilir.',
      trainingRecommendation: 'Hafif yuruyus, esneme veya tam dinlenme gunu. Agir antrenman onerilmez.',
    };
  }

  // Moderate: everything else (mixed signals)
  return {
    score: 'moderate',
    message_tr: 'Toparlanman orta seviyede. Orta yogunlukta antrenman yapabilirsin.',
    trainingRecommendation: 'Orta yogunlukta antrenman, teknik calisma veya hafif kardiyo uygun.',
  };
}
