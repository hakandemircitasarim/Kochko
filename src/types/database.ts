// Supabase database types - manually maintained until we generate from Supabase CLI

export type Gender = 'male' | 'female' | 'other';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active';
export type EquipmentAccess = 'home' | 'gym' | 'both';
export type RestrictionMode = 'sustainable' | 'aggressive';
export type CookingSkill = 'none' | 'basic' | 'good';
export type BudgetLevel = 'low' | 'medium' | 'high';
export type WaterHabit = 'low' | 'moderate' | 'good';
export type GoalPriority = 'fast_loss' | 'sustainable' | 'strength' | 'muscle' | 'health';
export type FoodPreference = 'love' | 'like' | 'dislike' | 'never';
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type WorkoutIntensity = 'low' | 'moderate' | 'high';
export type CoachingMessageType = 'daily_main' | 'micro' | 'report' | 'weekly';

export interface Profile {
  id: string;
  height_cm: number | null;
  weight_kg: number | null;
  birth_year: number | null;
  gender: Gender | null;
  activity_level: ActivityLevel | null;
  equipment_access: EquipmentAccess | null;
  restriction_mode: RestrictionMode | null;
  cooking_skill: CookingSkill | null;
  budget_level: BudgetLevel | null;
  sleep_time: string | null;
  wake_time: string | null;
  work_start: string | null;
  work_end: string | null;
  meal_count_preference: number | null;
  night_eating_risk: boolean;
  sweet_craving_risk: boolean;
  water_habit: WaterHabit | null;
  important_notes: string | null;
  onboarding_completed: boolean;
  premium: boolean;
  created_at: string;
  updated_at: string;
}

export interface Goal {
  id: string;
  user_id: string;
  target_weight_kg: number;
  target_weeks: number;
  priority: GoalPriority;
  weekly_loss_rate: number;
  daily_calorie_min: number;
  daily_calorie_max: number;
  daily_protein_min: number;
  daily_steps_target: number;
  daily_water_target: number;
  is_active: boolean;
  created_at: string;
}

export interface WeightHistory {
  id: string;
  user_id: string;
  age_at_time: number | null;
  weight_kg: number;
  note: string | null;
  recorded_at: string;
}

export interface HealthEvent {
  id: string;
  user_id: string;
  event_type: string;
  description: string;
  event_date: string;
}

export interface FoodPreferenceEntry {
  id: string;
  user_id: string;
  food_name: string;
  preference: FoodPreference;
  intolerance: boolean;
}

export interface MealLog {
  id: string;
  user_id: string;
  raw_input: string;
  meal_type: MealType;
  logged_at: string;
  synced: boolean;
}

export interface MealLogItem {
  id: string;
  meal_log_id: string;
  food_name: string;
  portion_text: string;
  portion_grams: number | null;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  user_corrected: boolean;
}

export interface WorkoutLog {
  id: string;
  user_id: string;
  raw_input: string;
  workout_type: string;
  duration_min: number;
  intensity: WorkoutIntensity;
  calories_burned: number;
  logged_at: string;
  synced: boolean;
}

export interface DailyMetrics {
  id: string;
  user_id: string;
  date: string;
  weight_kg: number | null;
  water_liters: number;
  sleep_hours: number | null;
  steps: number | null;
  mood_note: string | null;
  synced: boolean;
}

export interface MealSuggestion {
  meal_type: MealType;
  options: {
    name: string;
    description: string;
    calories: number;
    protein_g: number;
    carbs_g: number;
    fat_g: number;
  }[];
}

export interface WorkoutPlan {
  warmup: string;
  main: string[];
  cooldown: string;
  duration_min: number;
  rpe: number;
  heart_rate_zone: string;
}

export interface DailyPlan {
  id: string;
  user_id: string;
  date: string;
  calorie_target_min: number;
  calorie_target_max: number;
  protein_target_g: number;
  focus_message: string;
  meal_suggestions: MealSuggestion[];
  snack_strategy: string;
  workout_plan: WorkoutPlan;
  generated_at: string;
}

export interface DailyReport {
  id: string;
  user_id: string;
  date: string;
  compliance_score: number;
  calorie_actual: number;
  calorie_target_met: boolean;
  protein_actual: number;
  protein_target_met: boolean;
  workout_completed: boolean;
  sleep_impact: string | null;
  water_impact: string | null;
  deviation_reason: string | null;
  tomorrow_action: string;
  full_report: string;
  generated_at: string;
}

export interface WeeklyReport {
  id: string;
  user_id: string;
  week_start: string;
  weight_trend: number[];
  avg_compliance: number;
  top_deviation: string;
  next_week_strategy: string;
  plan_revision: Record<string, unknown>;
  generated_at: string;
}

export interface LabValue {
  id: string;
  user_id: string;
  parameter_name: string;
  value: number;
  unit: string;
  reference_min: number | null;
  reference_max: number | null;
  measured_at: string;
}

export interface CoachingMessage {
  id: string;
  user_id: string;
  message_type: CoachingMessageType;
  content: string;
  trigger: string;
  read: boolean;
  created_at: string;
}
