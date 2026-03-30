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

/**
 * Check if health platform is available on this device.
 */
export async function isHealthAvailable(): Promise<boolean> {
  // Placeholder: check for expo-health or platform health APIs
  return false;
}

/**
 * Request permissions for health data access.
 */
export async function requestHealthPermissions(
  types: HealthDataType[]
): Promise<boolean> {
  // TODO: Implement with expo-health or react-native-health
  // iOS: Request HealthKit read permissions
  // Android: Request Health Connect read permissions
  return false;
}

/**
 * Fetch today's step count from health platform.
 */
export async function getTodaySteps(): Promise<number | null> {
  const available = await isHealthAvailable();
  if (!available) return null;

  // TODO: Query HealthKit/Health Connect for today's steps
  return null;
}

/**
 * Fetch recent sleep data.
 */
export async function getRecentSleep(days: number = 7): Promise<HealthDataPoint[]> {
  // TODO: Query sleep data from health platform
  return [];
}

/**
 * Fetch HRV data for recovery assessment (Spec 14.1).
 * Low HRV = poor recovery, suggest light activity.
 * High HRV = good recovery, suggest intense training.
 */
export async function getLatestHRV(): Promise<number | null> {
  // TODO: Query HRV from wearable/health platform
  return null;
}

/**
 * Sync weight from smart scale (if connected).
 */
export async function getLatestWeight(): Promise<number | null> {
  // TODO: Query weight from health platform (smart scale integration)
  return null;
}

/**
 * Evaluate recovery readiness based on HRV + subjective data.
 * Spec 14.1: HRV + kullanıcı his birlikte değerlendirilir.
 */
export function evaluateRecovery(
  hrv: number | null,
  muscleSoreness: number | null,
  sleepQuality: string | null
): 'good' | 'moderate' | 'poor' | 'unknown' {
  if (!hrv && !muscleSoreness) return 'unknown';

  let score = 50; // neutral

  if (hrv) {
    if (hrv > 60) score += 20;      // Good HRV
    else if (hrv < 40) score -= 20; // Poor HRV
  }

  if (muscleSoreness) {
    if (muscleSoreness <= 1) score += 15;
    else if (muscleSoreness >= 3) score -= 15;
    else if (muscleSoreness >= 4) score -= 25;
  }

  if (sleepQuality === 'good') score += 10;
  else if (sleepQuality === 'poor') score -= 10;

  if (score >= 60) return 'good';
  if (score >= 40) return 'moderate';
  return 'poor';
}
