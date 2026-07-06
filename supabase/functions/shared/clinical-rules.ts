/**
 * clinical-rules.ts — the single, versioned, CITED source of the clinical SAFETY constants the
 * deterministic engine applies (target-architecture: clinical_rules store, build step 2).
 *
 * WHY THIS EXISTS
 * ---------------
 * These numbers were previously (a) copy-pasted as literals across targets.ts, guardrails.ts and
 * the client tdee.ts — three drifting copies of the calorie floor alone — and (b) paraphrased as
 * prose inside the Turkish system prompt, where the LLM could restate them wrong. A safety floor
 * that the model can talk itself out of is not a floor. Here each constant has ONE owner, a
 * citation, and a ruleset version, so the value is auditable and the deterministic code — never the
 * model — enforces it.
 *
 * The CODE is authoritative at runtime: a safety floor must not depend on a DB round-trip that can
 * fail. Migration 082 mirrors these values into the `clinical_rules` table for audit/inspection and
 * as a future admin-override surface, stamped with the same CLINICAL_RULESET_VERSION.
 */

export const CLINICAL_RULESET_VERSION = '2026.07.06';

export interface ClinicalRule<T> {
  value: T;
  citation: string;
  note?: string;
}

/**
 * Absolute minimum daily intake for UNSUPERVISED dieting (this app does not run medically-
 * supervised VLCDs). Below this the body under-fuels essential function; the deterministic band
 * math clamps every target up to it.
 *
 * NOTE: the male floor was previously 1400 in three separate copies — below the cited guideline.
 * Aligning to 1500 raises a safety floor (the safe direction) and removes the drift.
 */
export const CALORIE_FLOOR: Record<'female' | 'male' | 'default', ClinicalRule<number>> = {
  female:  { value: 1200, citation: 'NICE CG189 / EFSA 2013 — unsupervised weight-loss diets ≥1200 kcal/day (women)' },
  male:    { value: 1500, citation: 'NICE CG189 / EFSA 2013 — unsupervised weight-loss diets ≥1500 kcal/day (men)' },
  default: { value: 1200, citation: 'Conservative floor applied when gender is unknown' },
};

/** Energy density of body mass — the kcal⇄kg bridge used by every deficit/timeline calc. */
export const KCAL_PER_KG: ClinicalRule<number> = {
  value: 7700,
  citation: 'Wishnofsky 1958 — ~7700 kcal ≈ 1 kg body mass (standard planning constant)',
};

/**
 * Safe upper bound on rate of change. ~0.5–1% of bodyweight per week preserves lean mass on a cut
 * and limits fat gain on a bulk; 1.0 kg/wk loss is the upper edge for higher-bodyweight users.
 */
export const MAX_RATE_KG_PER_WEEK: Record<'lose' | 'gain', ClinicalRule<number>> = {
  lose: { value: 1.0, citation: 'Helms/ISSN — ≤0.5–1.0 kg/wk loss preserves lean mass; 1.0 is the upper safe bound' },
  gain: { value: 0.5, citation: 'ISSN — ~0.25–0.5 kg/wk lean-gain ceiling to limit fat accrual' },
};

/** Protein floor to preserve lean mass in an energy deficit (g per kg bodyweight per day). */
export const PROTEIN_FLOOR_G_PER_KG: ClinicalRule<number> = {
  value: 1.6,
  citation: 'Morton et al. 2018 meta-analysis — ~1.6 g/kg/day maximises lean-mass retention',
};

/** Deterministic calorie-band shape (owned here so the shaper reads one source). */
export const BAND_RANGE_PCT: ClinicalRule<number> = {
  value: 0.10,
  citation: 'Product rule — ±5% band around the daily target gives a livable ~10%-wide range',
};
export const REST_DAY_KCAL_REDUCTION: ClinicalRule<number> = {
  value: 250,
  citation: 'Product rule — rest days trim ~250 kcal (no training expenditure) but never below floor',
};

/**
 * Fixed-fraction fallback multipliers, used ONLY when no goal timeline exists to derive a
 * timeline deficit (timelineDeficitKcal returns null). Timeline-derived deficit is preferred.
 */
export const FIXED_FACTOR: Record<'lose' | 'gain' | 'maintain', ClinicalRule<number>> = {
  lose:     { value: 0.85, citation: 'Fallback — ~15% deficit when no timeline is set' },
  gain:     { value: 1.10, citation: 'Fallback — ~10% surplus when no timeline is set' },
  maintain: { value: 1.00, citation: 'Maintenance = TDEE' },
};

// ─── Helpers (the ONLY sanctioned way to read a clinical constant) ───

/** Resolve the calorie floor for a gender, defaulting conservatively when unknown. */
export function getCalorieFloor(gender: string | null | undefined): number {
  if (gender === 'female') return CALORIE_FLOOR.female.value;
  if (gender === 'male') return CALORIE_FLOOR.male.value;
  return CALORIE_FLOOR.default.value;
}

/** Max safe weekly rate (kg/week) for a loss/gain goal. */
export function getMaxRateKgPerWeek(goalType: string): number {
  const isGain = goalType === 'gain_weight' || goalType === 'gain_muscle';
  return isGain ? MAX_RATE_KG_PER_WEEK.gain.value : MAX_RATE_KG_PER_WEEK.lose.value;
}

/** Minimum daily protein (g) to defend lean mass at a given bodyweight. */
export function getProteinFloorG(weightKg: number): number {
  return Math.round(weightKg * PROTEIN_FLOOR_G_PER_KG.value);
}

/** Flat list of every rule for seeding the audit table / a MemoryMirror surface. */
export function allClinicalRules(): Array<{ key: string; value: number; citation: string }> {
  const rules: Array<{ key: string; value: number; citation: string }> = [];
  const push = (key: string, r: ClinicalRule<number>) => rules.push({ key, value: r.value, citation: r.citation });
  push('calorie_floor.female', CALORIE_FLOOR.female);
  push('calorie_floor.male', CALORIE_FLOOR.male);
  push('calorie_floor.default', CALORIE_FLOOR.default);
  push('kcal_per_kg', KCAL_PER_KG);
  push('max_rate_kg_per_week.lose', MAX_RATE_KG_PER_WEEK.lose);
  push('max_rate_kg_per_week.gain', MAX_RATE_KG_PER_WEEK.gain);
  push('protein_floor_g_per_kg', PROTEIN_FLOOR_G_PER_KG);
  push('band_range_pct', BAND_RANGE_PCT);
  push('rest_day_kcal_reduction', REST_DAY_KCAL_REDUCTION);
  push('fixed_factor.lose', FIXED_FACTOR.lose);
  push('fixed_factor.gain', FIXED_FACTOR.gain);
  push('fixed_factor.maintain', FIXED_FACTOR.maintain);
  return rules;
}
