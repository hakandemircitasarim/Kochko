-- 071: promote_weekly_plan'i plan_subtype-farkında yap (057 fixup; 055 ile etkileşim)
--
-- SORUN: 057 promote_weekly_plan, arşivleme UPDATE'inde yalnız (user_id, plan_type, status='active')
-- filtreliyor; plan_subtype YOK. Migration 055 sonrası bir kullanıcının aynı plan_type='diet' için
-- İKİ aktif satırı olabilir: core (plan_subtype IS NULL) + legacy menü (plan_subtype='weekly_menu').
-- Chat onayı bir CORE diyet taslağını promote ederken bu RPC, weekly_menu satırını da 'archived'
-- yapıyordu → kullanıcının haftalık menüsü sessizce kayboluyor. (Düşmanca regresyon-incelemesi.)
--
-- ÇÖZÜM: arşivlemeyi, promote edilen TASLAĞIN plan_subtype'ı ile eşleşen aktif satırlara DARALT
-- (COALESCE(plan_subtype,'core') eşitliği). Böylece core promote yalnız core'u arşivler, menü dokunulmaz
-- (ve tersi). Tek transaction korunur. uniq_active_plan_per_type (055) zaten subtype-farkında.
--
-- Idempotent: CREATE OR REPLACE FUNCTION. Imza/parametreler 057 ile aynı (çağrı noktası değişmez).

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
  v_subtype text;
BEGIN
  -- Promote edilen taslağın alt-türü (core için NULL).
  SELECT plan_subtype INTO v_subtype FROM public.weekly_plans WHERE id = p_draft_id;

  -- Yalnız AYNI alt-türdeki aktif satırı arşivle (core promote → menü satırına dokunma).
  UPDATE public.weekly_plans
  SET status = 'archived', archived_reason = 'superseded', superseded_by = p_draft_id
  WHERE user_id = p_user
    AND plan_type = p_plan_type
    AND status = 'active'
    AND COALESCE(plan_subtype, 'core') = COALESCE(v_subtype, 'core');

  UPDATE public.weekly_plans
  SET status = 'active', approved_at = now(), approval_snapshot = p_snapshot
  WHERE id = p_draft_id AND user_id = p_user
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.promote_weekly_plan(uuid, text, uuid, jsonb) TO service_role;
