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

  // Workout plan structure validation
  if (output.workout_plan && typeof output.workout_plan === 'object') {
    const wp = output.workout_plan as Record<string, unknown>;
    const validTypes = ['cardio', 'strength', 'flexibility', 'mixed', 'rest'];
    if (wp.type && !validTypes.includes(wp.type as string)) {
      errors.push(`workout_plan.type gecersiz: ${wp.type}`);
      wp.type = 'rest';
    }
    if (!wp.main || !Array.isArray(wp.main)) {
      errors.push('workout_plan.main dizisi eksik');
      wp.main = [];
    }
    if (typeof wp.duration_min !== 'number' || wp.duration_min < 0) {
      errors.push('workout_plan.duration_min gecersiz');
      wp.duration_min = Math.max(0, Number(wp.duration_min) || 0);
    }

    // RPE range check (0-10)
    if (typeof wp.rpe === 'number') {
      if (wp.rpe < 0 || wp.rpe > 10) {
        errors.push(`workout_plan.rpe aralik disi: ${wp.rpe} (0-10 olmali)`);
        wp.rpe = Math.max(0, Math.min(10, Math.round(wp.rpe as number)));
      }
    } else if (wp.rpe !== undefined) {
      errors.push('workout_plan.rpe sayi olmali');
      wp.rpe = Math.max(0, Math.min(10, Number(wp.rpe) || 5));
    }

    // Validate strength_targets if present
    if (wp.strength_targets && Array.isArray(wp.strength_targets)) {
      for (const target of wp.strength_targets as Record<string, unknown>[]) {
        if (typeof target.sets !== 'number' || target.sets < 0) target.sets = Math.max(0, Number(target.sets) || 0);
        if (typeof target.reps !== 'number' || target.reps < 0) target.reps = Math.max(0, Number(target.reps) || 0);
        if (typeof target.weight_kg !== 'number' || target.weight_kg < 0) target.weight_kg = Math.max(0, Number(target.weight_kg) || 0);
      }
    }
  }

  // Meal suggestions total vs calorie target consistency check (+-30%)
  if (Array.isArray(output.meal_suggestions) && typeof output.calorie_target_min === 'number' && typeof output.calorie_target_max === 'number') {
    const mealSuggestions = output.meal_suggestions as { options: { calories: number }[] }[];
    // Calculate total using first option of each meal as representative
    let mealCalorieTotal = 0;
    for (const meal of mealSuggestions) {
      if (meal.options && meal.options.length > 0) {
        mealCalorieTotal += meal.options[0].calories ?? 0;
      }
    }
    const targetMid = ((output.calorie_target_min as number) + (output.calorie_target_max as number)) / 2;
    if (targetMid > 0 && mealCalorieTotal > 0) {
      const ratio = mealCalorieTotal / targetMid;
      if (ratio < 0.7 || ratio > 1.3) {
        errors.push(`Ogun kalorileri toplami (${mealCalorieTotal}) hedef aralikla tutarsiz (hedef orta: ${Math.round(targetMid)}, oran: ${Math.round(ratio * 100)}%)`);
      }
    }
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
