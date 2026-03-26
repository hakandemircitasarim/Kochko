import { supabase } from '@/lib/supabase';

/**
 * Calls a Supabase Edge Function for AI operations.
 * All AI calls go through Edge Functions (not directly from client)
 * to keep API keys secure and apply guardrails server-side.
 */
async function callEdgeFunction<T>(
  functionName: string,
  body: Record<string, unknown>
): Promise<{ data: T | null; error: string | null }> {
  const { data, error } = await supabase.functions.invoke(functionName, {
    body,
  });

  if (error) {
    return { data: null, error: error.message };
  }

  return { data: data as T, error: null };
}

// --- Meal Parsing ---

export interface ParsedMealItem {
  food_name: string;
  portion_text: string;
  portion_grams: number | null;
  calories: number;
  protein_g: number;
  carbs_g: number;
  fat_g: number;
}

export interface ParseMealResult {
  items: ParsedMealItem[];
  confidence: 'high' | 'medium' | 'low';
  notes?: string;
}

export async function parseMealText(
  rawInput: string,
  mealLogId: string
): Promise<{ data: ParseMealResult | null; error: string | null }> {
  return callEdgeFunction<ParseMealResult>('ai-parse-meal', {
    raw_input: rawInput,
    meal_log_id: mealLogId,
  });
}

// --- Daily Plan Generation ---

export interface GeneratedPlan {
  calorie_target_min: number;
  calorie_target_max: number;
  protein_target_g: number;
  focus_message: string;
  meal_suggestions: {
    meal_type: string;
    options: {
      name: string;
      description: string;
      calories: number;
      protein_g: number;
      carbs_g: number;
      fat_g: number;
    }[];
  }[];
  snack_strategy: string;
  workout_plan: {
    warmup: string;
    main: string[];
    cooldown: string;
    duration_min: number;
    rpe: number;
    heart_rate_zone: string;
  };
}

export async function generateDailyPlan(): Promise<{
  data: GeneratedPlan | null;
  error: string | null;
}> {
  return callEdgeFunction<GeneratedPlan>('ai-generate-plan', {});
}

// --- Daily Report ---

export interface GeneratedReport {
  compliance_score: number;
  calorie_target_met: boolean;
  protein_target_met: boolean;
  workout_completed: boolean;
  sleep_impact: string | null;
  water_impact: string | null;
  deviation_reason: string | null;
  tomorrow_action: string;
  full_report: string;
}

export async function generateDailyReport(
  date: string
): Promise<{ data: GeneratedReport | null; error: string | null }> {
  return callEdgeFunction<GeneratedReport>('ai-daily-report', { date });
}

// --- Coaching Message ---

export interface CoachingResult {
  message: string;
  priority: 'low' | 'medium' | 'high';
}

export async function getCoachingMessage(
  trigger: string
): Promise<{ data: CoachingResult | null; error: string | null }> {
  return callEdgeFunction<CoachingResult>('ai-coaching', { trigger });
}
