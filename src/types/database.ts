/**
 * Database Types - Single source of truth for all Supabase table types.
 * Generated from migrations 001-005.
 */

// ============ ENUMS ============

export type Gender = 'male' | 'female' | 'other';
export type ActivityLevel = 'sedentary' | 'light' | 'moderate' | 'active' | 'very_active';
export type Equipment = 'home' | 'gym' | 'both';
export type CookingSkill = 'none' | 'basic' | 'good';
export type BudgetLevel = 'low' | 'medium' | 'high';
export type TrainingStyle = 'cardio' | 'strength' | 'mixed';
export type DietMode = 'standard' | 'low_carb' | 'keto' | 'high_protein';
export type CoachTone = 'strict' | 'balanced' | 'gentle';
export type AlcoholFrequency = 'never' | 'rare' | 'weekly' | 'frequent';
export type PortionLanguage = 'grams' | 'household';
export type UnitSystem = 'metric' | 'imperial';
export type MealType = 'breakfast' | 'lunch' | 'dinner' | 'snack';
export type InputMethod = 'text' | 'photo' | 'barcode' | 'voice' | 'template' | 'ai_chat';
export type Confidence = 'high' | 'medium' | 'low';
export type WorkoutType = 'cardio' | 'strength' | 'flexibility' | 'sports' | 'mixed';
export type Intensity = 'low' | 'moderate' | 'high';
export type SleepQuality = 'good' | 'ok' | 'bad';
export type MuscleSoreness = 'none' | 'light' | 'moderate' | 'severe';
export type StepsSource = 'manual' | 'phone' | 'wearable';
export type DataSource = 'ai_estimate' | 'barcode' | 'user_correction' | 'venue_memory' | 'template';
export type FoodPreference = 'love' | 'like' | 'can_cook' | 'dislike' | 'never';
export type AllergenSeverity = 'mild' | 'moderate' | 'severe';
export type GoalType = 'lose_weight' | 'gain_weight' | 'gain_muscle' | 'health' | 'maintain' | 'conditioning';
export type GoalPriority = 'fast' | 'sustainable' | 'strength' | 'muscle' | 'health';
export type RestrictionMode = 'sustainable' | 'aggressive';
export type PlanType = 'training' | 'rest';
export type PlanStatus = 'draft' | 'approved' | 'modified' | 'rejected';
export type ChallengeStatus = 'active' | 'paused' | 'completed' | 'abandoned';
export type CommitmentStatus = 'pending' | 'followed_up' | 'completed' | 'abandoned';
export type ChatRole = 'user' | 'assistant' | 'system';
export type TaskMode = 'register' | 'plan' | 'coaching' | 'analyst' | 'qa' | 'recipe' | 'eating_out' | 'mvd' | 'plateau' | 'simulation' | 'recovery' | 'onboarding' | 'periodic';
export type FeedbackType = 'helpful' | 'not_for_me';
export type ContextType = 'meal_suggestion' | 'workout_plan' | 'coaching_message' | 'recipe';
export type PeriodicState = 'ramadan' | 'holiday' | 'illness' | 'busy_work' | 'exam' | 'pregnancy' | 'breastfeeding' | 'injury' | 'travel' | 'custom';
export type NutritionLiteracy = 'low' | 'medium' | 'high';

// ============ TABLE TYPES ============

export interface Profile {
  id: string;
  height_cm: number | null;
  weight_kg: number | null;
  birth_year: number | null;
  gender: Gender | null;
  body_fat_pct: number | null;
  muscle_mass_pct: number | null;
  waist_cm: number | null;
  hip_cm: number | null;
  chest_cm: number | null;
  thigh_cm: number | null;
  cooking_skill: CookingSkill;
  budget_level: BudgetLevel;
  diet_mode: DietMode;
  alcohol_frequency: AlcoholFrequency;
  portion_language: PortionLanguage;
  unit_system: UnitSystem;
  if_active: boolean;
  if_window: string | null;
  if_eating_start: string | null;
  if_eating_end: string | null;
  meal_prep_active: boolean;
  meal_prep_days: string[] | null;
  activity_level: ActivityLevel;
  sleep_time: string | null;
  wake_time: string | null;
  work_start: string | null;
  work_end: string | null;
  occupation: string | null;
  meal_count_preference: number;
  equipment_access: Equipment;
  training_style: TrainingStyle;
  coach_tone: CoachTone;
  home_timezone: string;
  active_timezone: string;
  day_boundary_hour: number;
  menstrual_tracking: boolean;
  menstrual_cycle_length: number | null;
  menstrual_last_period_start: string | null;
  tdee_calculated: number | null;
  tdee_calculated_at: string | null;
  tdee_activity_multiplier: number | null;
  calorie_range_training_min: number | null;
  calorie_range_training_max: number | null;
  calorie_range_rest_min: number | null;
  calorie_range_rest_max: number | null;
  macro_protein_pct: number;
  macro_carb_pct: number;
  macro_fat_pct: number;
  protein_per_kg: number | null;
  water_target_liters: number | null;
  periodic_state: PeriodicState | null;
  periodic_state_start: string | null;
  periodic_state_end: string | null;
  onboarding_completed: boolean;
  profile_completion_pct: number;
  premium: boolean;
  premium_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Goal {
  id: string;
  user_id: string;
  goal_type: GoalType;
  target_weight_kg: number | null;
  target_weeks: number | null;
  priority: GoalPriority;
  restriction_mode: RestrictionMode;
  weekly_rate: number | null;
  is_active: boolean;
  phase_order: number;
  phase_label: string | null;
  created_at: string;
}

export interface HealthEvent {
  id: string;
  user_id: string;
  event_type: string;
  description: string;
  event_date: string | null;
  is_ongoing: boolean;
  created_at: string;
}

export interface FoodPreferenceEntry {
  id: string;
  user_id: string;
  food_name: string;
  preference: FoodPreference;
  is_allergen: boolean;
  allergen_severity: AllergenSeverity | null;
}

export interface MealTemplate {
  id: string;
  user_id: string;
  name: string;
  items: { name: string; portion: string; calories: number; protein_g: number; carbs_g: number; fat_g: number }[];
  total_calories: number;
  total_protein: number;
  use_count: number;
  created_at: string;
}

export interface UserVenue {
  id: string;
  user_id: string;
  venue_name: string;
  venue_type: string | null;
  learned_items: { name: string; calories: number; protein_g?: number; confirmed: boolean }[];
  visit_count: number;
}

export interface MealLog {
  id: string;
  user_id: string;
  raw_input: string;
  input_method: InputMethod;
  meal_type: MealType;
  cooking_method: string | null;
  confidence: Confidence;
  template_id: string | null;
  logged_at: string;
  logged_for_date: string;
  is_deleted: boolean;
  deleted_at: string | null;
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
  alcohol_g: number;
  data_source: DataSource;
  user_corrected: boolean;
}

export interface WorkoutLog {
  id: string;
  user_id: string;
  raw_input: string;
  workout_type: WorkoutType;
  duration_min: number;
  intensity: Intensity;
  calories_burned: number;
  rpe: number | null;
  logged_at: string;
  logged_for_date: string;
  is_deleted: boolean;
  synced: boolean;
}

export interface StrengthSet {
  id: string;
  workout_log_id: string;
  exercise_name: string;
  set_number: number;
  reps: number;
  weight_kg: number | null;
  is_pr: boolean;
  created_at: string;
}

export interface DailyMetrics {
  id: string;
  user_id: string;
  date: string;
  weight_kg: number | null;
  water_liters: number;
  sleep_hours: number | null;
  sleep_quality: SleepQuality | null;
  sleep_time: string | null;
  wake_time: string | null;
  steps: number | null;
  steps_source: StepsSource;
  mood_score: number | null;
  mood_note: string | null;
  stress_note: string | null;
  recovery_score: number | null;
  muscle_soreness: MuscleSoreness | null;
  synced: boolean;
}

export interface SupplementLog {
  id: string;
  user_id: string;
  supplement_name: string;
  amount: string | null;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
  logged_at: string;
  logged_for_date: string;
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
  is_out_of_range: boolean;
}

export interface ChatMessage {
  id: string;
  user_id: string;
  session_id: string;
  role: ChatRole;
  content: string;
  task_mode: TaskMode | null;
  has_photo: boolean;
  actions_executed: Record<string, unknown> | null;
  token_count: number | null;
  model_version: string | null;
  created_at: string;
}

export interface ChatSession {
  id: string;
  user_id: string;
  title: string | null;
  topic_tags: string[] | null;
  started_at: string;
  ended_at: string | null;
  message_count: number;
  is_active: boolean;
}

export interface AISummary {
  id: string;
  user_id: string;
  general_summary: string;
  behavioral_patterns: { type: string; description: string; trigger?: string; intervention?: string; confidence?: number }[];
  coaching_notes: string;
  portion_calibration: Record<string, number>;
  strength_records: Record<string, { last_weight: number; last_reps: number; '1rm'?: number }>;
  user_persona: string | null;
  nutrition_literacy: NutritionLiteracy;
  learned_tone_preference: string | null;
  micro_nutrient_risks: { nutrient: string; risk_level: string }[];
  alcohol_pattern: string | null;
  caffeine_sleep_notes: string | null;
  social_eating_notes: string | null;
  habit_progress: { habit: string; status: string; streak: number; started_at?: string }[];
  features_introduced: string[];
  repair_frequency: string;
  tdee_notes: string | null;
  weekly_budget_pattern: string | null;
  supplement_notes: string | null;
  recovery_pattern: string | null;
  seasonal_notes: string | null;
  menstrual_notes: string | null;
  last_tdee_weight: number | null;
  last_tdee_date: string | null;
  token_size_estimate: number;
  max_token_budget: number;
  updated_at: string;
  created_at: string;
}

export interface UserCommitment {
  id: string;
  user_id: string;
  commitment: string;
  follow_up_at: string | null;
  status: CommitmentStatus;
  source_message_id: string | null;
  created_at: string;
}

export interface CoachingMessage {
  id: string;
  user_id: string;
  content: string;
  trigger_type: string;
  priority: 'low' | 'medium' | 'high';
  read: boolean;
  push_sent: boolean;
  created_at: string;
}

export interface DailyPlan {
  id: string;
  user_id: string;
  date: string;
  plan_type: PlanType;
  calorie_target_min: number;
  calorie_target_max: number;
  protein_target_g: number;
  carbs_target_g: number | null;
  fat_target_g: number | null;
  water_target_liters: number | null;
  focus_message: string | null;
  meal_suggestions: MealSuggestion[];
  snack_strategy: string | null;
  workout_plan: WorkoutPlanData;
  weekly_budget_total: number | null;
  weekly_budget_consumed: number | null;
  weekly_budget_remaining: number | null;
  version: number;
  status: PlanStatus;
  approved_at: string | null;
  generated_at: string;
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
    prep_time_min?: number;
  }[];
}

export interface WorkoutPlanData {
  type: string;
  warmup: string;
  main: string[];
  cooldown: string;
  duration_min: number;
  rpe: number;
  heart_rate_zone?: string;
  strength_targets?: { exercise: string; sets: number; reps: number; weight_kg: number }[];
}

export interface DailyReport {
  id: string;
  user_id: string;
  date: string;
  compliance_score: number;
  calorie_actual: number;
  protein_actual: number;
  carbs_actual: number;
  fat_actual: number;
  alcohol_calories: number;
  calorie_target_met: boolean;
  protein_target_met: boolean;
  workout_completed: boolean;
  water_target_met: boolean;
  steps_actual: number | null;
  sleep_impact: string | null;
  water_impact: string | null;
  deviation_reason: string | null;
  weekly_budget_status: string | null;
  tomorrow_action: string;
  full_report: string;
  generated_at: string;
}

export interface WeeklyReport {
  id: string;
  user_id: string;
  week_start: string;
  weight_trend: { date: string; kg: number }[];
  avg_compliance: number;
  weekly_budget_compliance: boolean | null;
  top_deviation: string | null;
  best_day: string | null;
  worst_day: string | null;
  protein_trend: unknown[];
  water_trend: unknown[];
  sleep_trend: unknown[];
  alcohol_total_calories: number;
  strength_summary: string | null;
  ai_learning_note: string | null;
  next_week_strategy: string;
  plan_revision: Record<string, unknown>;
  generated_at: string;
}

export interface Challenge {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  challenge_type: 'system' | 'custom';
  target: { metric: string; goal: number; period: string; duration_days: number };
  status: ChallengeStatus;
  progress: { date: string; value: number; met: boolean }[];
  started_at: string;
  paused_at: string | null;
  completed_at: string | null;
}

export interface Achievement {
  id: string;
  user_id: string;
  achievement_type: string;
  title: string;
  description: string | null;
  achieved_at: string;
  shared: boolean;
}

export interface SavedRecipe {
  id: string;
  user_id: string;
  title: string;
  category: string | null;
  ingredients: { name: string; amount: string; unit: string }[];
  instructions: string;
  total_calories: number | null;
  total_protein: number | null;
  prep_time_min: number | null;
  cook_time_min: number | null;
  servings: number;
  created_at: string;
}

export interface AIFeedback {
  id: string;
  user_id: string;
  context_type: ContextType;
  context_id: string | null;
  feedback: FeedbackType;
  created_at: string;
}
