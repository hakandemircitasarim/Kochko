/**
 * TDEE Calculation Engine
 * Spec Section 2.4
 *
 * Mifflin-St Jeor formula + dynamic activity multiplier
 * + training/rest day calorie split
 */

type Gender = 'male' | 'female' | 'other';
type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
type RestrictionMode = 'sustainable' | 'aggressive';
type GoalType = 'lose_weight' | 'gain_weight' | 'gain_muscle' | 'health' | 'maintain' | 'conditioning';

const ACTIVITY_MULTIPLIERS: Record<ActivityLevel, number> = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
};

interface TDEEInput {
  weightKg: number;
  heightCm: number;
  age: number;
  gender: Gender;
  activityLevel: ActivityLevel;
  dynamicMultiplier?: number; // refined from real data over 2-4 weeks
}

interface CalorieTargets {
  bmr: number;
  tdee: number;
  trainingDay: { min: number; max: number };
  restDay: { min: number; max: number };
  weeklyBudget: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

/**
 * Calculate BMR using Mifflin-St Jeor formula.
 * Spec 2.4: Most accurate BMR formula for general population.
 */
export function calculateBMR(
  weightKg: number,
  heightCm: number,
  age: number,
  gender: Gender
): number {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * age;
  if (gender === 'male') return Math.round(base + 5);
  return Math.round(base - 161); // female and other
}

/**
 * Calculate TDEE from BMR and activity level.
 */
export function calculateTDEE(bmr: number, activityLevel: ActivityLevel, dynamicMultiplier?: number): number {
  const multiplier = dynamicMultiplier ?? ACTIVITY_MULTIPLIERS[activityLevel];
  return Math.round(bmr * multiplier);
}

/**
 * Calculate complete calorie and macro targets.
 * Spec 2.4, 2.6: Training/rest day split, weekly budget.
 */
export function calculateTargets(input: {
  tdee: number;
  goalType: GoalType;
  restrictionMode: RestrictionMode;
  weeksSinceStart: number;
  complianceAvg: number; // 0-100, last 2 weeks
  weightKg: number;
  macroPct: { protein: number; carb: number; fat: number };
  proteinPerKg?: number;
}): CalorieTargets {
  const { tdee, goalType, restrictionMode, weeksSinceStart, complianceAvg, weightKg, macroPct } = input;

  // Determine deficit/surplus based on goal
  let deficitPct: number;
  switch (goalType) {
    case 'lose_weight':
      deficitPct = restrictionMode === 'aggressive' ? 0.25 : 0.15;
      break;
    case 'gain_weight':
    case 'gain_muscle':
      deficitPct = -(restrictionMode === 'aggressive' ? 0.15 : 0.10); // surplus
      break;
    case 'maintain':
    case 'health':
    case 'conditioning':
    default:
      deficitPct = 0;
  }

  const targetCalories = Math.round(tdee * (1 - deficitPct));

  // Calorie range width (Spec 2.4)
  // New users: wider range. Consistent users: narrower.
  let rangeWidthPct: number;
  if (weeksSinceStart < 2) {
    rangeWidthPct = 0.12; // First 2 weeks: 12% range
  } else if (complianceAvg > 80) {
    rangeWidthPct = restrictionMode === 'aggressive' ? 0.06 : 0.08;
  } else {
    rangeWidthPct = 0.10; // Default 10%
  }

  const rangeWidth = Math.round(targetCalories * rangeWidthPct);

  // Training vs rest day split (Spec 2.4)
  // Rest day: 200-400 kcal less than training day
  const restDayReduction = restrictionMode === 'aggressive' ? 400 : 250;

  const trainingMin = targetCalories - Math.round(rangeWidth / 2);
  const trainingMax = targetCalories + Math.round(rangeWidth / 2);
  const restMin = trainingMin - restDayReduction;
  const restMax = trainingMax - restDayReduction;

  // Apply absolute floors (Spec 12.1)
  const absoluteFloor = input.weightKg > 0 && macroPct.protein > 0 ? 1200 : 1400; // simplified; real check uses gender
  const safeTrainingMin = Math.max(trainingMin, absoluteFloor);
  const safeRestMin = Math.max(restMin, absoluteFloor);

  // Weekly budget (Spec 2.6)
  // Assume 4 training days, 3 rest days as default
  const weeklyBudget =
    4 * Math.round((safeTrainingMin + trainingMax) / 2) +
    3 * Math.round((safeRestMin + restMax) / 2);

  // Protein calculation (Spec 2.1)
  const proteinPerKg = input.proteinPerKg ?? calculateProteinPerKg(goalType, restrictionMode);
  const proteinG = Math.round(weightKg * proteinPerKg);
  const proteinCalories = proteinG * 4;

  // Remaining calories for carbs and fat
  const avgTarget = Math.round((safeTrainingMin + trainingMax) / 2);
  const remainingCalories = avgTarget - proteinCalories;
  const carbRatio = macroPct.carb / (macroPct.carb + macroPct.fat);
  const carbsG = Math.round((remainingCalories * carbRatio) / 4);
  const fatG = Math.round((remainingCalories * (1 - carbRatio)) / 9);

  return {
    bmr: 0, // caller should set this
    tdee,
    trainingDay: { min: safeTrainingMin, max: trainingMax },
    restDay: { min: safeRestMin, max: restMax },
    weeklyBudget,
    proteinG,
    carbsG,
    fatG,
  };
}

/**
 * Determine protein per kg based on goal type.
 * Spec 2.1: 1.6-2.2g/kg range.
 */
function calculateProteinPerKg(goalType: GoalType, mode: RestrictionMode): number {
  switch (goalType) {
    case 'gain_muscle':
      return 2.0;
    case 'lose_weight':
      return mode === 'aggressive' ? 2.2 : 1.8; // higher protein preserves muscle in deficit
    case 'gain_weight':
      return 1.6;
    case 'conditioning':
      return 1.8;
    default:
      return 1.6;
  }
}

/**
 * Calculate water target (Spec 2.7).
 */
export function calculateWaterTarget(
  weightKg: number,
  isTrainingDay: boolean,
  isSummer: boolean
): number {
  let target = weightKg * 0.033;
  if (isTrainingDay) target += 0.75;
  if (isSummer) target += 0.4;
  return Math.round(target * 10) / 10;
}

/**
 * Check if TDEE recalculation is needed (Spec 2.4).
 * Triggers: 2-3kg weight change, activity change, plateau.
 */
export function shouldRecalculateTDEE(
  currentWeight: number,
  lastTDEEWeight: number | null,
  lastTDEEDate: string | null
): { needed: boolean; reason: string } {
  if (!lastTDEEWeight || !lastTDEEDate) {
    return { needed: true, reason: 'İlk hesaplama' };
  }

  const weightDiff = Math.abs(currentWeight - lastTDEEWeight);
  if (weightDiff >= 2.5) {
    return { needed: true, reason: `${weightDiff.toFixed(1)}kg değişim` };
  }

  const daysSince = Math.floor(
    (Date.now() - new Date(lastTDEEDate).getTime()) / 86400000
  );
  if (daysSince > 30) {
    return { needed: true, reason: '30+ gün geçmiş' };
  }

  return { needed: false, reason: '' };
}

/**
 * Pregnancy TDEE adjustment (Spec 2.4).
 */
export function pregnancyTDEEAdjustment(trimester: 1 | 2 | 3): number {
  switch (trimester) {
    case 1: return 0;
    case 2: return 340;
    case 3: return 450;
  }
}

/**
 * Breastfeeding TDEE adjustment (Spec 2.4).
 */
export function breastfeedingTDEEAdjustment(): number {
  return 450; // +400-500 kcal
}

/**
 * Validate weekly loss rate (Spec 12.1 guardrail).
 * Max 1 kg/week.
 */
export function validateWeeklyRate(
  currentWeight: number,
  targetWeight: number,
  targetWeeks: number
): { valid: boolean; rate: number; message: string } {
  const totalChange = Math.abs(currentWeight - targetWeight);
  const rate = totalChange / targetWeeks;

  if (rate > 1.0) {
    return {
      valid: false,
      rate,
      message: `Haftalık ${rate.toFixed(1)}kg çok agresif. Maksimum 1kg/hafta önerilir.`,
    };
  }

  if (rate > 0.75) {
    return {
      valid: true,
      rate,
      message: `Haftalık ${rate.toFixed(1)}kg yüksek ama uygulanabilir. Dikkatli takip gerekir.`,
    };
  }

  return { valid: true, rate, message: '' };
}
