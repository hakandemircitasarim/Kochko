/**
 * Meal Log Write Service
 *
 * Single owner of the client-side "insert meal_logs parent → insert
 * meal_log_items batch → delete parent on items failure (rollback)" sequence
 * that was previously copy-pasted across templates.service (useTemplate),
 * plan.service (logPlannedMeal) and import.service (importMealsFromCSV).
 *
 * The helper writes item values VERBATIM — rounding, smallint clamping and
 * portion_text derivation differ per flow (template vs plan vs CSV import)
 * and deliberately stay at the call site, so consolidating the write
 * sequence does not normalize their column semantics.
 */
import { supabase } from '@/lib/supabase';

export interface MealLogItemInput {
  /** → food_name */
  name: string;
  /**
   * → portion_text. NOT NULL in the DB (migration 002) — callers must supply
   * a non-empty fallback (every flow uses '1 porsiyon').
   */
  portionText: string;
  /** → portion_grams (nullable, no DB default — omitted ≡ null). */
  grams?: number | null;
  /** → calories — written verbatim; round/clamp at the call site. */
  kcal: number;
  /** → protein_g (defaults to 0) */
  protein?: number;
  /** → carbs_g (defaults to 0) */
  carbs?: number;
  /** → fat_g (defaults to 0) */
  fat?: number;
  /** → data_source ('template' | 'ai_estimate' | …, migration-084 allow-list) */
  dataSource: string;
}

export interface InsertMealLogParams {
  /** Already-resolved session user; when absent the helper resolves it itself. */
  userId?: string;
  rawInput: string;
  mealType: string;
  inputMethod: string;
  loggedForDate: string;
  /** Defaults to true — every current flow logs as already-synced. */
  synced?: boolean;
  /** → template_id (nullable, no DB default — omitted ≡ null; only the template flow sets it). */
  templateId?: string | null;
  items: MealLogItemInput[];
}

export interface InsertMealLogResult {
  mealLogId: string | null;
  error: string | null;
  /** Which step failed — lets callers keep stage-specific error copy. */
  failedStep?: 'session' | 'log' | 'items';
}

/**
 * Insert a meal_logs parent plus its meal_log_items batch.
 *
 * Rollback semantics: if the items insert fails, the freshly created parent
 * is deleted so the user never sees a phantom 0 kcal entry, and the items
 * error is returned. An empty `items` array skips the batch insert and
 * succeeds with the parent only (template flow allows item-less templates).
 */
export async function insertMealLogWithItems(
  params: InsertMealLogParams,
): Promise<InsertMealLogResult> {
  // meal_logs.user_id is NOT NULL + RLS WITH CHECK(auth.uid()=user_id)
  let userId = params.userId;
  if (!userId) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { mealLogId: null, error: 'Oturum bulunamadı.', failedStep: 'session' };
    userId = user.id;
  }

  // Review fix: omit-vs-null ceremony dropped — both columns are nullable with no
  // DB default, so omitting and inserting null are identical for a plain INSERT.
  const { data: log, error: logErr } = await supabase
    .from('meal_logs')
    .insert({
      user_id: userId,
      raw_input: params.rawInput,
      meal_type: params.mealType,
      input_method: params.inputMethod,
      logged_for_date: params.loggedForDate,
      synced: params.synced ?? true,
      template_id: params.templateId ?? null,
    })
    .select('id')
    .single();

  const mealLogId = (log as { id: string } | null)?.id ?? null;
  if (logErr || !mealLogId) {
    return { mealLogId: null, error: logErr?.message ?? 'Kayıt oluşturulamadı.', failedStep: 'log' };
  }

  // Items batch — values written verbatim (per-flow rounding/clamping is the
  // caller's job; see MealLogItemInput docs).
  if (params.items.length > 0) {
    const rows = params.items.map((it) => ({
      meal_log_id: mealLogId,
      food_name: it.name,
      portion_text: it.portionText,
      portion_grams: it.grams ?? null,
      calories: it.kcal,
      protein_g: it.protein ?? 0,
      carbs_g: it.carbs ?? 0,
      fat_g: it.fat ?? 0,
      data_source: it.dataSource,
    }));
    const { error: itemsErr } = await supabase.from('meal_log_items').insert(rows);
    if (itemsErr) {
      // Roll the empty log back so the user doesn't see a phantom entry.
      await supabase.from('meal_logs').delete().eq('id', mealLogId);
      return { mealLogId: null, error: itemsErr.message, failedStep: 'items' };
    }
  }

  return { mealLogId, error: null };
}
