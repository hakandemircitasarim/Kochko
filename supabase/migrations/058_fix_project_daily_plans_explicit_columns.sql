-- 058: project_daily_plans RPC düzeltmesi — explicit kolon listesi (057 fixup)
--
-- AMAÇ: 057'deki project_daily_plans `INSERT INTO daily_plans SELECT * FROM
-- jsonb_populate_recordset(null::daily_plans, p_rows)` kullanıyordu. writeRows id
-- içermediği için populate edilen kayıtta id=NULL olur ve SELECT * ile id'ye explicit
-- NULL yazılır → DEFAULT gen_random_uuid() UYGULANMAZ → PK NOT NULL ihlali. Aynı sorun
-- meal_suggestions (NOT NULL, default '[]') için de geçerli (writeRows'da yoksa NULL olur).
-- Yani 057 sürümü ai-chat'ten çağrıldığında PATLARDI. Bu fixup explicit kolon listesi +
-- jsonb_to_recordset (tip-güvenli) kullanır; id/generated_at DEFAULT'ları uygulanır.
-- user_id parametreden (p_user) alınır — jsonb'deki user_id YOK SAYILIR (cross-user koruma).
--
-- Idempotent: CREATE OR REPLACE. Geri-alma gerekmez (057 zaten bozuktu).

-- FIX (audit DB/HIGH — 057 project_daily_plans SELECT * id=NULL ile PK ihlali ederdi)
CREATE OR REPLACE FUNCTION public.project_daily_plans(
  p_user uuid,
  p_lower date,
  p_end date,
  p_rows jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.daily_plans
  WHERE user_id = p_user AND date >= p_lower AND date <= p_end;

  IF p_rows IS NOT NULL AND jsonb_typeof(p_rows) = 'array' AND jsonb_array_length(p_rows) > 0 THEN
    INSERT INTO public.daily_plans (
      user_id, date, plan_type, calorie_target_min, calorie_target_max,
      protein_target_g, carbs_target_g, fat_target_g, water_target_liters,
      focus_message, meal_suggestions, snack_strategy, workout_plan,
      weekly_budget_total, weekly_budget_consumed, weekly_budget_remaining, version, status
    )
    SELECT
      p_user, x.date, COALESCE(x.plan_type, 'rest'),
      x.calorie_target_min, x.calorie_target_max, x.protein_target_g,
      x.carbs_target_g, x.fat_target_g, x.water_target_liters,
      x.focus_message, COALESCE(x.meal_suggestions, '[]'::jsonb), x.snack_strategy,
      COALESCE(x.workout_plan, '{}'::jsonb),
      x.weekly_budget_total, x.weekly_budget_consumed, x.weekly_budget_remaining,
      COALESCE(x.version, 1), COALESCE(x.status, 'approved')
    FROM jsonb_to_recordset(p_rows) AS x(
      date date, plan_type text,
      calorie_target_min smallint, calorie_target_max smallint, protein_target_g smallint,
      carbs_target_g smallint, fat_target_g smallint, water_target_liters numeric,
      focus_message text, meal_suggestions jsonb, snack_strategy text, workout_plan jsonb,
      weekly_budget_total smallint, weekly_budget_consumed smallint, weekly_budget_remaining smallint,
      version smallint, status text
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.project_daily_plans(uuid, date, date, jsonb) TO service_role;
