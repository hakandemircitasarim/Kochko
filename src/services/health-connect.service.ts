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
 * Returns true as placeholder on both iOS/Android.
 * TODO: Replace with actual expo-health / Health Connect availability check.
 */
export async function isHealthAvailable(): Promise<boolean> {
  // Placeholder: Both platforms support health APIs in principle.
  // Real implementation will check for HealthKit (iOS) or Health Connect (Android).
  return true;
}

/**
 * Request permissions for health data access.
 * Returns true as placeholder until real SDK is integrated.
 */
export async function requestHealthPermissions(
  _types: HealthDataType[]
): Promise<boolean> {
  // TODO: Implement with expo-health or react-native-health
  // iOS: Request HealthKit read permissions for specified types
  // Android: Request Health Connect read permissions for specified types
  return true;
}

/**
 * Fetch today's step count from health platform.
 */
export async function getTodaySteps(): Promise<number | null> {
  // TODO: Replace with real HealthKit/Health Connect query:
  // iOS: HKQuantityType.quantityType(forIdentifier: .stepCount)
  // Android: StepsRecord via Health Connect client
  return null;
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
