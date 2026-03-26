/**
 * Server-side guardrail validation for AI outputs.
 * Mirrors client-side rules but runs authoritatively on the server.
 */

const FORBIDDEN_PHRASES = [
  'teşhis', 'tanı', 'tedavi', 'hastalık', 'ilaç', 'reçete',
  'doktor olarak', 'tıbbi olarak', 'tıbbi tavsiye', 'hastalığınız', 'rahatsızlığınız',
];

const MIN_CALORIES = { male: 1400, female: 1200 };
const MAX_WEEKLY_LOSS_KG = 1.0;
const MIN_PROTEIN_PER_KG = 0.8;
const MAX_PROTEIN_PER_KG = 2.2;

export interface GuardrailResult {
  passed: boolean;
  violations: string[];
  modified: Record<string, unknown>;
}

/**
 * Validates and potentially modifies AI-generated plan data.
 */
export function validatePlan(
  plan: Record<string, unknown>,
  gender: string | null,
  weightKg: number | null,
): GuardrailResult {
  const violations: string[] = [];
  const modified: Record<string, unknown> = {};

  // Calorie floor
  const minCal = gender === 'female' ? MIN_CALORIES.female : MIN_CALORIES.male;
  if (typeof plan.calorie_target_min === 'number' && plan.calorie_target_min < minCal) {
    violations.push(`Kalori alt sınırı ${minCal}'e yükseltildi`);
    modified.calorie_target_min = minCal;
  }

  // Protein bounds
  if (weightKg && typeof plan.protein_target_g === 'number') {
    const minP = Math.round(weightKg * MIN_PROTEIN_PER_KG);
    const maxP = Math.round(weightKg * MAX_PROTEIN_PER_KG);
    if (plan.protein_target_g < minP) {
      violations.push(`Protein ${minP}g'a yükseltildi`);
      modified.protein_target_g = minP;
    }
    if (plan.protein_target_g > maxP) {
      violations.push(`Protein ${maxP}g'a düşürüldü`);
      modified.protein_target_g = maxP;
    }
  }

  return { passed: violations.length === 0, violations, modified };
}

/**
 * Scans any text output for forbidden medical language.
 * Returns cleaned text if violations found.
 */
export function sanitizeText(text: string): { clean: string; hadViolations: boolean } {
  let clean = text;
  let hadViolations = false;

  for (const phrase of FORBIDDEN_PHRASES) {
    if (clean.toLocaleLowerCase('tr').includes(phrase)) {
      hadViolations = true;
      // Replace the forbidden phrase with a safe alternative
      const regex = new RegExp(phrase, 'gi');
      clean = clean.replace(regex, '[yaşam tarzı notu]');
    }
  }

  return { clean, hadViolations };
}
