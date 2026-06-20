-- 057: atomik plan/hedef yazımı + weekly_plans archive→promote (HIGH/veri-bütünlüğü)
--
-- AMAÇ: ai-chat/index.ts'te üç sıcak yazım yolu tek-aktif invariant'ını transaction'sız
-- iki ayrı ifadeyle koruyor; yarıda kesilince veri kaybı/0-aktif durumu oluşabiliyor:
--   (1) daily_plans .delete(range) sonra ayrı .insert(writeRows): delete OK ama insert
--       hata verirse o haftanın tüm satırları silinmiş ama yeni yazılmamış kalır (dashboard boşalır).
--   (2) goals .update(is_active=false) sonra ayrı .insert(): insert hata verirse hiç aktif hedef kalmaz.
--   (3) weekly_plans archive→promote (update active→archived, sonra draft→active): yarışta
--       0-aktif veya promote başarısız → eski plan archived'da takılı kalabilir.
--
-- ÇÖZÜM: üç SECURITY DEFINER plpgsql RPC — her biri tek transaction (fonksiyon gövdesi
-- otomatik atomik; hata → tüm değişiklik rollback). EXECUTE yalnız service_role'a
-- (ai-chat supabaseAdmin ile çağırır). Çağrı noktalarının bağlanması (ai-chat/index.ts,
-- plan.service.ts) AYRI batch'lerin işidir — bu migration RPC'leri kurar.
--
-- Idempotent: CREATE OR REPLACE FUNCTION. Geri-alınabilir: DROP FUNCTION.

-- FIX (audit DB/HIGH — set_active_goal: hedef deactivate→insert transaction'sız, 0-aktif riski)
CREATE OR REPLACE FUNCTION public.set_active_goal(p_user uuid, p_goal jsonb)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Tek-aktif-hedef invariant'ı (migration 033) tek tx içinde: eskiyi pasifle + yeniyi yaz.
  UPDATE public.goals SET is_active = false WHERE user_id = p_user AND is_active;
  INSERT INTO public.goals (
    user_id, goal_type, target_weight_kg, target_weeks, start_weight_kg, weekly_rate, is_active, created_at
  )
  SELECT
    p_user,
    p_goal->>'goal_type',
    NULLIF(p_goal->>'target_weight_kg', '')::numeric,
    NULLIF(p_goal->>'target_weeks', '')::int,
    NULLIF(p_goal->>'start_weight_kg', '')::numeric,
    NULLIF(p_goal->>'weekly_rate', '')::numeric,
    true,
    now();
END;
$$;

-- FIX (audit DB/HIGH — project_daily_plans: daily_plans delete-then-insert transaction'sız, dashboard boşalma riski)
-- p_rows: JS tarafında projectDailyPlanRows ile üretilmiş tam daily_plans satır objeleri
-- (user_id + version dahil) jsonb dizisi. Delete(range) + insert tek tx'te yapılır.
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
  -- Aralığı temizle, sonra JS-üretimi satırları olduğu gibi yaz — atomik.
  DELETE FROM public.daily_plans
  WHERE user_id = p_user AND date >= p_lower AND date <= p_end;

  IF p_rows IS NOT NULL AND jsonb_typeof(p_rows) = 'array' AND jsonb_array_length(p_rows) > 0 THEN
    INSERT INTO public.daily_plans
    SELECT * FROM jsonb_populate_recordset(null::public.daily_plans, p_rows);
  END IF;
END;
$$;

-- FIX (audit DB/HIGH + MEDIUM — promote_weekly_plan: archive→promote transaction'sız, 0-aktif/orphan-archive riski)
-- Tek tx'te eski aktifi archive eder, draft'ı active yapar; uniq_active/uniq_draft index'leri
-- ihlal olursa tüm tx rollback → 0-aktif durumu oluşmaz. Aktive edilen plan id'sini döner.
CREATE OR REPLACE FUNCTION public.promote_weekly_plan(
  p_user uuid,
  p_plan_type text,
  p_draft_id uuid,
  p_snapshot jsonb DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  UPDATE public.weekly_plans
  SET status = 'archived', archived_reason = 'superseded', superseded_by = p_draft_id
  WHERE user_id = p_user AND plan_type = p_plan_type AND status = 'active';

  UPDATE public.weekly_plans
  SET status = 'active', approved_at = now(), approval_snapshot = p_snapshot
  WHERE id = p_draft_id AND user_id = p_user
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- Bu yazımlar yalnız sunucu tarafı (ai-chat supabaseAdmin / service_role) tetikler.
GRANT EXECUTE ON FUNCTION public.set_active_goal(uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.project_daily_plans(uuid, date, date, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.promote_weekly_plan(uuid, text, uuid, jsonb) TO service_role;
