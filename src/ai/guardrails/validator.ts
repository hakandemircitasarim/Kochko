import { GUARDRAILS, type GuardrailViolation } from './rules';
import type { Profile, Goal } from '@/types/database';

/**
 * Validates AI-generated calorie targets against safety rules.
 */
export function validateCalorieTarget(
  calories: number,
  profile: Profile,
  goal: Goal | null
): GuardrailViolation[] {
  const violations: GuardrailViolation[] = [];
  const minCalories =
    profile.gender === 'female'
      ? GUARDRAILS.MIN_DAILY_CALORIES_FEMALE
      : GUARDRAILS.MIN_DAILY_CALORIES_MALE;

  if (calories < minCalories) {
    violations.push({
      rule: 'MIN_DAILY_CALORIES',
      message: `Günlük kalori ${minCalories} altına düşemez. Önerilen: ${calories} -> düzeltildi: ${minCalories}`,
      severity: 'modify',
    });
  }

  return violations;
}

/**
 * Validates AI-generated protein targets.
 */
export function validateProteinTarget(
  proteinG: number,
  weightKg: number
): GuardrailViolation[] {
  const violations: GuardrailViolation[] = [];
  const minProtein = weightKg * GUARDRAILS.MIN_PROTEIN_PER_KG;
  const maxProtein = weightKg * GUARDRAILS.MAX_PROTEIN_PER_KG;

  if (proteinG < minProtein) {
    violations.push({
      rule: 'MIN_PROTEIN',
      message: `Protein hedefi çok düşük: ${proteinG}g. Minimum: ${Math.round(minProtein)}g`,
      severity: 'modify',
    });
  }

  if (proteinG > maxProtein) {
    violations.push({
      rule: 'MAX_PROTEIN',
      message: `Protein hedefi çok yüksek: ${proteinG}g. Maksimum: ${Math.round(maxProtein)}g`,
      severity: 'modify',
    });
  }

  return violations;
}

/**
 * Scans text for forbidden medical/diagnostic language.
 */
export function validateLanguage(text: string): GuardrailViolation[] {
  const violations: GuardrailViolation[] = [];
  const lowerText = text.toLocaleLowerCase('tr');

  for (const phrase of GUARDRAILS.FORBIDDEN_PHRASES) {
    if (lowerText.includes(phrase)) {
      violations.push({
        rule: 'FORBIDDEN_LANGUAGE',
        message: `Yasaklı ifade tespit edildi: "${phrase}"`,
        severity: 'block',
      });
    }
  }

  return violations;
}

/**
 * Validates weekly weight loss rate.
 */
export function validateWeightLossRate(
  weeklyLossKg: number
): GuardrailViolation[] {
  const violations: GuardrailViolation[] = [];

  if (weeklyLossKg > GUARDRAILS.MAX_WEEKLY_LOSS_KG) {
    violations.push({
      rule: 'MAX_WEEKLY_LOSS',
      message: `Haftalık ${weeklyLossKg}kg kayıp çok agresif. Maksimum: ${GUARDRAILS.MAX_WEEKLY_LOSS_KG}kg`,
      severity: 'block',
    });
  } else if (weeklyLossKg > GUARDRAILS.WARNING_WEEKLY_LOSS_KG) {
    violations.push({
      rule: 'WARNING_WEEKLY_LOSS',
      message: `Haftalık ${weeklyLossKg}kg kayıp yüksek. Dikkatli olunmalı.`,
      severity: 'warn',
    });
  }

  return violations;
}

/**
 * Validates workout plan safety.
 */
export function validateWorkout(
  durationMin: number,
  sleepHours: number | null,
  healthEvents: string[]
): GuardrailViolation[] {
  const violations: GuardrailViolation[] = [];

  if (durationMin > GUARDRAILS.MAX_WORKOUT_DURATION_MIN) {
    violations.push({
      rule: 'MAX_WORKOUT_DURATION',
      message: `Antrenman süresi ${durationMin}dk çok uzun. Maksimum: ${GUARDRAILS.MAX_WORKOUT_DURATION_MIN}dk`,
      severity: 'modify',
    });
  }

  if (
    sleepHours !== null &&
    sleepHours < GUARDRAILS.REST_AFTER_BAD_SLEEP_THRESHOLD_HOURS
  ) {
    violations.push({
      rule: 'REST_AFTER_BAD_SLEEP',
      message: `Uyku ${sleepHours} saat. Yoğunluk düşürülmeli.`,
      severity: 'warn',
    });
  }

  return violations;
}

/**
 * Checks if user should be referred to a doctor.
 */
export function checkDoctorReferral(
  bmi: number | null,
  weeklyLoss: number | null
): { shouldRefer: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (bmi !== null && bmi < 18.5) {
    reasons.push('BMI değeriniz düşük (< 18.5). Bir sağlık profesyoneline danışmanızı öneririz.');
  }

  if (weeklyLoss !== null && weeklyLoss > 1.5) {
    reasons.push('Haftalık kilo kaybınız çok hızlı (> 1.5 kg). Bir doktora danışın.');
  }

  return { shouldRefer: reasons.length > 0, reasons };
}
