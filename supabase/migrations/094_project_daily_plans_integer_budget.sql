-- 094: project_daily_plans RPC — weekly_budget ara-cast'ini smallint→integer yap (mig 073'ü BİTİR)
--
-- SORUN (audit 2026-07-23, CONFIRMED live): mig 073 daily_plans.weekly_budget_* TABLO kolonlarını
-- integer'a genişletti AMA project_daily_plans RPC'sinin (mig 058) gövdesi jsonb_to_recordset
-- kolon listesinde bu üç alanı hâlâ `smallint` olarak parse ediyor (058:50). Bulk/ağır-yeme
-- haftasında günlük ~4700 kcal × 7 = 33000 > smallint max (32767) → jsonb_to_recordset İÇİNDE,
-- INSERT'ten ÖNCE 22003 (numeric_value_out_of_range). RPC tek tx'te DELETE+INSERT yaptığından TÜM
-- hafta silinir, insert atılamaz → dashboard sessizce boşalır ve onay "başarılı" döner. Yani mig
-- 073'ün "düzelttim" dediği çökme, RPC'nin iç cast'i yüzünden HÂLÂ CANLI.
--
-- ÇÖZÜM: RPC'yi mig 058 gövdesiyle AYNEN yeniden yarat, sadece weekly_budget_{total,consumed,
-- remaining} recordset tiplerini integer yap. Kalan alanlar günlük değerler (kalori/protein/…),
-- smallint'e mantıken sığar ve tablo kolonları hâlâ smallint olduğundan aynen bırakılır.
-- Idempotent: CREATE OR REPLACE. mig 072'nin REVOKE/GRANT'ları etkilenmez (gövde değişir, imza aynı).

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
      weekly_budget_total integer, weekly_budget_consumed integer, weekly_budget_remaining integer,
      version smallint, status text
    );
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.project_daily_plans(uuid, date, date, jsonb) TO service_role;
REVOKE EXECUTE ON FUNCTION public.project_daily_plans(uuid, date, date, jsonb) FROM PUBLIC, anon, authenticated;
