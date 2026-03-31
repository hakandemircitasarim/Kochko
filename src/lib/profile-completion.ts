/**
 * Profile Completion Calculator
 * Weighted calculation based on field importance for AI coaching quality.
 */

export type ProfileCategory = 'physical' | 'lifestyle' | 'schedule' | 'preferences' | 'measurements';

export interface CompletionField {
  key: string;
  weight: number; // 3=required, 2=important, 1=optional
  category: ProfileCategory;
}

export const COMPLETION_FIELDS: CompletionField[] = [
  // Weight 3 — Required for TDEE and basic coaching
  { key: 'height_cm', weight: 3, category: 'physical' },
  { key: 'weight_kg', weight: 3, category: 'physical' },
  { key: 'birth_year', weight: 3, category: 'physical' },
  { key: 'gender', weight: 3, category: 'physical' },
  { key: 'activity_level', weight: 3, category: 'lifestyle' },

  // Weight 2 — Important for personalized plans
  { key: 'sleep_time', weight: 2, category: 'schedule' },
  { key: 'wake_time', weight: 2, category: 'schedule' },
  { key: 'cooking_skill', weight: 2, category: 'lifestyle' },
  { key: 'budget_level', weight: 2, category: 'lifestyle' },
  { key: 'equipment_access', weight: 2, category: 'lifestyle' },
  { key: 'training_style', weight: 2, category: 'lifestyle' },
  { key: 'diet_mode', weight: 2, category: 'lifestyle' },
  { key: 'meal_count_preference', weight: 2, category: 'preferences' },
  { key: 'occupation', weight: 2, category: 'schedule' },

  // Weight 1 — Optional enrichment data
  { key: 'body_fat_pct', weight: 1, category: 'measurements' },
  { key: 'muscle_mass_pct', weight: 1, category: 'measurements' },
  { key: 'waist_cm', weight: 1, category: 'measurements' },
  { key: 'hip_cm', weight: 1, category: 'measurements' },
  { key: 'chest_cm', weight: 1, category: 'measurements' },
  { key: 'thigh_cm', weight: 1, category: 'measurements' },
  { key: 'work_start', weight: 1, category: 'schedule' },
  { key: 'work_end', weight: 1, category: 'schedule' },
  { key: 'unit_system', weight: 1, category: 'preferences' },
  { key: 'portion_language', weight: 1, category: 'preferences' },
  { key: 'alcohol_frequency', weight: 1, category: 'preferences' },
];

// Fields that have non-null defaults and should be treated as "filled" only when changed from default
const DEFAULT_VALUES: Record<string, unknown> = {
  cooking_skill: 'none',
  budget_level: 'low',
  diet_mode: 'standard',
  alcohol_frequency: 'never',
  unit_system: 'metric',
  portion_language: 'grams',
  meal_count_preference: 3,
  equipment_access: 'home',
  training_style: 'mixed',
};

function isFieldFilled(profile: Record<string, unknown>, key: string): boolean {
  const value = profile[key];
  if (value === null || value === undefined || value === '') return false;

  // For fields with defaults, we consider them "filled" even with default
  // because the user may intentionally keep the default
  // Only truly null/empty fields count as unfilled
  return true;
}

export interface CompletionResult {
  percentage: number;
  filledCount: number;
  totalCount: number;
  byCategory: Record<ProfileCategory, { filled: number; total: number; percentage: number }>;
  missingRequired: string[];
  lowestCategory: ProfileCategory | null;
}

const CATEGORY_LABELS: Record<ProfileCategory, string> = {
  physical: 'Fiziksel Bilgiler',
  lifestyle: 'Yasam Tarzi',
  schedule: 'Program Bilgileri',
  preferences: 'Tercihler',
  measurements: 'Vucut Olculeri',
};

export { CATEGORY_LABELS };

export function calculateProfileCompletion(profile: Record<string, unknown>): CompletionResult {
  let filledWeight = 0;
  let totalWeight = 0;
  let filledCount = 0;
  const missingRequired: string[] = [];

  const byCategory: Record<ProfileCategory, { filled: number; total: number; percentage: number }> = {
    physical: { filled: 0, total: 0, percentage: 0 },
    lifestyle: { filled: 0, total: 0, percentage: 0 },
    schedule: { filled: 0, total: 0, percentage: 0 },
    preferences: { filled: 0, total: 0, percentage: 0 },
    measurements: { filled: 0, total: 0, percentage: 0 },
  };

  for (const field of COMPLETION_FIELDS) {
    totalWeight += field.weight;
    byCategory[field.category].total += 1;

    if (isFieldFilled(profile, field.key)) {
      filledWeight += field.weight;
      filledCount += 1;
      byCategory[field.category].filled += 1;
    } else if (field.weight === 3) {
      missingRequired.push(field.key);
    }
  }

  // Calculate category percentages
  let lowestCategory: ProfileCategory | null = null;
  let lowestPct = 101;

  for (const cat of Object.keys(byCategory) as ProfileCategory[]) {
    const c = byCategory[cat];
    c.percentage = c.total > 0 ? Math.round((c.filled / c.total) * 100) : 100;
    if (c.percentage < lowestPct && c.total > 0) {
      lowestPct = c.percentage;
      lowestCategory = cat;
    }
  }

  return {
    percentage: totalWeight > 0 ? Math.round((filledWeight / totalWeight) * 100) : 0,
    filledCount,
    totalCount: COMPLETION_FIELDS.length,
    byCategory,
    missingRequired,
    lowestCategory,
  };
}
