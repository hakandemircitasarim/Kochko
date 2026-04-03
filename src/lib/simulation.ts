/**
 * Simulation Calculator
 * Package 11: "Sunu yesem ne olur?" scenario analysis
 *
 * Calculates the impact of a hypothetical food on daily/weekly targets,
 * generates Turkish verdict text, and suggests alternatives.
 */

export interface SimulationResult {
  calorieImpact: number;
  proteinImpact: number;
  carbsImpact: number;
  fatImpact: number;
  budgetRemaining: number;
  budgetPercentUsed: number;
  weeklyImpact: number;
  verdict_tr: string;
  alternative_tr: string | null;
}

export function simulateFood(
  food: { calories: number; protein_g: number; carbs_g: number; fat_g: number },
  todayConsumed: { calories: number; protein: number; carbs: number; fat: number },
  dailyTarget: { calorieMin: number; calorieMax: number; proteinTarget: number },
  weeklyBudgetRemaining: number | null,
): SimulationResult {
  // Calculate new totals after adding food
  const newCalories = todayConsumed.calories + food.calories;
  const newProtein = todayConsumed.protein + food.protein_g;
  const newCarbs = todayConsumed.carbs + food.carbs_g;
  const newFat = todayConsumed.fat + food.fat_g;

  // Daily calorie budget remaining (use midpoint of min/max as target)
  const dailyTarget_mid = Math.round((dailyTarget.calorieMin + dailyTarget.calorieMax) / 2);
  const budgetRemaining = dailyTarget_mid - newCalories;
  const budgetPercentUsed = dailyTarget_mid > 0
    ? Math.round((newCalories / dailyTarget_mid) * 100)
    : 0;

  // Weekly impact: how this food affects remaining weekly budget
  const weeklyImpact = weeklyBudgetRemaining !== null
    ? weeklyBudgetRemaining - food.calories
    : 0;

  // Generate Turkish verdict
  let verdict_tr: string;
  if (budgetRemaining >= 0 && budgetPercentUsed <= 100) {
    if (food.protein_g >= 15 && budgetPercentUsed <= 85) {
      verdict_tr = 'Dengeli secim';
    } else {
      verdict_tr = 'Butceye sigiyor';
    }
  } else {
    verdict_tr = 'Butceyi asiyor';
  }

  // Generate alternative suggestion
  let alternative_tr: string | null = null;
  if (budgetRemaining < 0) {
    const excess = Math.abs(budgetRemaining);
    alternative_tr = `Gunluk butceni ${excess} kcal asiyor. Daha dusuk kalorili bir alternatif tercih edersen butcende kalabilirsin.`;
  } else if (food.protein_g < 10 && food.calories > 300) {
    const proteinDeficit = dailyTarget.proteinTarget - newProtein;
    if (proteinDeficit > 20) {
      alternative_tr = `Protein orani dusuk. Bunun yerine protein agirliklı bir secenek (tavuk, yumurta, yogurt) tercih etsen ${food.calories} kcal'de daha fazla protein alabilirsin.`;
    }
  } else if (weeklyBudgetRemaining !== null && weeklyImpact < 0) {
    alternative_tr = `Haftalik butceni asar. Yarin daha hafif tutarak dengeleyebilirsin.`;
  }

  return {
    calorieImpact: food.calories,
    proteinImpact: food.protein_g,
    carbsImpact: food.carbs_g,
    fatImpact: food.fat_g,
    budgetRemaining,
    budgetPercentUsed,
    weeklyImpact,
    verdict_tr,
    alternative_tr,
  };
}
