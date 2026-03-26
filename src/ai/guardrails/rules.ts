/**
 * Guardrail rules for AI output validation.
 * All AI-generated content must pass through these rules
 * before being shown to the user.
 */

export const GUARDRAILS = {
  // Calorie limits
  MIN_DAILY_CALORIES_FEMALE: 1200,
  MIN_DAILY_CALORIES_MALE: 1400,
  MAX_CALORIE_DEFICIT_PERCENT: 30,

  // Protein limits (per kg body weight)
  MIN_PROTEIN_PER_KG: 0.8,
  MAX_PROTEIN_PER_KG: 2.2,

  // Fasting protection
  MAX_FASTING_HOURS: 14,
  MAX_FASTING_HOURS_POST_SURGERY: 8,
  MIN_MEALS_PER_DAY: 2,

  // Exercise protection
  MAX_WORKOUT_DURATION_MIN: 120,
  MAX_HIGH_INTENSITY_DAYS_PER_WEEK: 3,
  REST_AFTER_BAD_SLEEP_THRESHOLD_HOURS: 5,

  // Weight loss rate
  MAX_WEEKLY_LOSS_KG: 1.0,
  WARNING_WEEKLY_LOSS_KG: 0.75,

  // Forbidden medical language (Turkish)
  FORBIDDEN_PHRASES: [
    'teşhis',
    'tanı',
    'tedavi',
    'hastalık',
    'ilaç',
    'reçete',
    'doktor olarak',
    'tıbbi olarak',
    'tıbbi tavsiye',
    'hastalığınız',
    'rahatsızlığınız',
  ],

  // Required disclaimer
  DISCLAIMER: 'Bu bir yaşam tarzı önerisidir, tıbbi tavsiye değildir.',

  // Triggers for "consult a professional" warning
  REFER_TO_DOCTOR_CONDITIONS: [
    'BMI < 18.5',
    'weekly_loss > 1.5 kg',
    'lab_value_out_of_range',
    'blood_sugar_below_70',
    'persistent_fatigue_7_days',
    'chest_pain_during_exercise',
    'pregnancy',
  ],
} as const;

export type GuardrailViolation = {
  rule: string;
  message: string;
  severity: 'block' | 'warn' | 'modify';
};
