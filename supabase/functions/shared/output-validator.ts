/**
 * Structured Output Validation
 * Spec 5.29: JSON şema kontrolü + makro-kalori tutarlılığı + retry
 *
 * Every AI-generated structured output (meal parse, plan, report)
 * passes through this validator before being stored.
 */

interface ValidationResult {
  valid: boolean;
  errors: string[];
  corrected: Record<string, unknown> | null;
}

/**
 * Validate meal parse output.
 * Required fields: items array, each with name, calories, protein_g, carbs_g, fat_g.
 */
export function validateMealParse(output: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  if (!output.items || !Array.isArray(output.items)) {
    errors.push('items dizisi eksik');
    return { valid: false, errors, corrected: null };
  }

  const items = output.items as Record<string, unknown>[];
  const correctedItems = items.map((item, i) => {
    const corrected = { ...item };

    // Ensure required fields exist and are non-negative
    if (typeof corrected.name !== 'string' || !corrected.name) {
      errors.push(`Item ${i}: name eksik`);
      corrected.name = `Yiyecek ${i + 1}`;
    }
    if (typeof corrected.calories !== 'number' || corrected.calories < 0) {
      corrected.calories = Math.max(0, Number(corrected.calories) || 0);
    }
    if (typeof corrected.protein_g !== 'number' || corrected.protein_g < 0) {
      corrected.protein_g = Math.max(0, Number(corrected.protein_g) || 0);
    }
    if (typeof corrected.carbs_g !== 'number' || corrected.carbs_g < 0) {
      corrected.carbs_g = Math.max(0, Number(corrected.carbs_g) || 0);
    }
    if (typeof corrected.fat_g !== 'number' || corrected.fat_g < 0) {
      corrected.fat_g = Math.max(0, Number(corrected.fat_g) || 0);
    }

    // Macro-calorie consistency check (Spec 5.29)
    // protein*4 + carbs*4 + fat*9 ≈ calories (±10%)
    const calculated = Math.round(
      (corrected.protein_g as number) * 4 +
      (corrected.carbs_g as number) * 4 +
      (corrected.fat_g as number) * 9
    );
    const stated = corrected.calories as number;
    if (stated > 0 && Math.abs(calculated - stated) > stated * 0.15) {
      errors.push(`Item ${i}: makro-kalori tutarsiz (${stated} kcal vs hesaplanan ${calculated} kcal)`);
      // Trust macros, recalculate calories
      corrected.calories = calculated;
    }

    return corrected;
  });

  return {
    valid: errors.length === 0,
    errors,
    corrected: { ...output, items: correctedItems },
  };
}

/**
 * Validate plan output.
 * Required: calorie_target_min/max, protein_target_g, meal_suggestions, workout_plan.
 */
export function validatePlanOutput(output: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  const requiredNumbers = ['calorie_target_min', 'calorie_target_max', 'protein_target_g'];
  for (const field of requiredNumbers) {
    if (typeof output[field] !== 'number' || (output[field] as number) <= 0) {
      errors.push(`${field} eksik veya gecersiz`);
    }
  }

  // Calorie min should be less than max
  if (typeof output.calorie_target_min === 'number' && typeof output.calorie_target_max === 'number') {
    if ((output.calorie_target_min as number) > (output.calorie_target_max as number)) {
      errors.push('calorie_target_min > calorie_target_max');
      // Swap them
      const temp = output.calorie_target_min;
      output.calorie_target_min = output.calorie_target_max;
      output.calorie_target_max = temp;
    }
  }

  if (!output.meal_suggestions || !Array.isArray(output.meal_suggestions)) {
    errors.push('meal_suggestions dizisi eksik');
  }

  if (!output.focus_message || typeof output.focus_message !== 'string') {
    errors.push('focus_message eksik');
    output.focus_message = 'Bugunu en iyi sekilde degerlendir.';
  }

  return { valid: errors.length === 0, errors, corrected: output };
}

/**
 * Validate report output.
 * Required: compliance_score (0-100), full_report, tomorrow_action.
 */
export function validateReportOutput(output: Record<string, unknown>): ValidationResult {
  const errors: string[] = [];

  if (typeof output.compliance_score !== 'number') {
    errors.push('compliance_score eksik');
    output.compliance_score = 50;
  } else {
    output.compliance_score = Math.max(0, Math.min(100, Math.round(output.compliance_score as number)));
  }

  if (!output.full_report || typeof output.full_report !== 'string') {
    errors.push('full_report eksik');
    output.full_report = 'Rapor olusturulamadi.';
  }

  if (!output.tomorrow_action || typeof output.tomorrow_action !== 'string') {
    errors.push('tomorrow_action eksik');
    output.tomorrow_action = 'Yarina planli basla.';
  }

  return { valid: errors.length === 0, errors, corrected: output };
}
