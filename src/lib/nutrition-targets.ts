// Single source of truth for daily nutrition targets.
//
// The 2026-07-11 emulator pass caught a split-brain: the dashboard derived
// macro targets from the CALORIE TARGET (rest-range midpoint + protein_per_kg),
// while the chat receipt card derived them from raw TDEE × macro percentages —
// the same user saw "protein hedefi 144g" on one screen and "205g" on the next.
// Every surface must derive targets through this helper.

export interface NutritionTargets {
  calorieTargetMin: number;
  calorieTargetMax: number;
  calorieTargetMid: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
}

interface ProfileTargetFields {
  calorie_range_rest_min?: number | null;
  calorie_range_rest_max?: number | null;
  protein_per_kg?: number | string | null;
  weight_kg?: number | string | null;
  macro_carb_pct?: number | null;
  macro_fat_pct?: number | null;
}

/** Per-day overrides projected from the active plan (daily_plans row). */
export interface PlanTargetOverrides {
  calorieMin?: number | null;
  calorieMax?: number | null;
  proteinG?: number | null;
  carbsG?: number | null;
  fatG?: number | null;
}

export function deriveNutritionTargets(
  profile: ProfileTargetFields | null | undefined,
  plan?: PlanTargetOverrides | null,
): NutritionTargets {
  const calorieTargetMin = plan?.calorieMin ?? (profile?.calorie_range_rest_min as number) ?? 0;
  const calorieTargetMax = plan?.calorieMax ?? (profile?.calorie_range_rest_max as number) ?? 0;
  const calorieTargetMid = (calorieTargetMin + calorieTargetMax) / 2;

  const proteinG = plan?.proteinG ?? (
    profile?.protein_per_kg && profile?.weight_kg
      ? Math.round(Number(profile.protein_per_kg) * Number(profile.weight_kg))
      : 120
  );

  const carbPct = Number(profile?.macro_carb_pct) || 0;
  const fatPct = Number(profile?.macro_fat_pct) || 0;
  const carbsG = plan?.carbsG ?? (
    carbPct > 0 && calorieTargetMid > 0 ? Math.round((calorieTargetMid * carbPct / 100) / 4) : 200
  );
  const fatG = plan?.fatG ?? (
    fatPct > 0 && calorieTargetMid > 0 ? Math.round((calorieTargetMid * fatPct / 100) / 9) : 65
  );

  return { calorieTargetMin, calorieTargetMax, calorieTargetMid, proteinG, carbsG, fatG };
}
