-- 043: DoD-2/7/9 canlı doğrulama turunun DB düzeltmeleri
--
-- (1) weekly_plans yazma politikaları: mig 005 yalnız SELECT politikası
--     bırakmıştı; client'ın 4 yazma yolu (Revize et draft kopyası,
--     pickAlternative/applySnapshot, discardDraft, createDraft) 42501 ile
--     ölüydü. INSERT yalnız draft'a, UPDATE yalnız draft/archived hedefine
--     izin verir — client kendi planını 'active'e TERFİ EDEMEZ (free-premium
--     gate korunur; terfi yalnız ai-chat'in service-role user_approved yolu).
--
-- (2) goals.goal_type CHECK: enum şimdiye dek sadece konvansiyondu; canlıda
--     yalnız lose_weight/gain_weight var — kanonik 6'lıya sabitle.
--
-- (3) Aile Planı: davet koduyla katılma, RLS yüzünden (üye olmayan household
--     satırını göremez) her zaman 'Geçersiz davet kodu' veriyordu.
--     SECURITY DEFINER RPC ile katılım + ortak alışveriş listesi okuma.

-- ── (1) weekly_plans owner write policies ──
DROP POLICY IF EXISTS weekly_plans_ins ON public.weekly_plans;
CREATE POLICY weekly_plans_ins ON public.weekly_plans
  FOR INSERT WITH CHECK (auth.uid() = user_id AND status = 'draft');

DROP POLICY IF EXISTS weekly_plans_upd ON public.weekly_plans;
CREATE POLICY weekly_plans_upd ON public.weekly_plans
  FOR UPDATE USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id AND status IN ('draft', 'archived'));

-- ── (2) goals.goal_type CHECK ──
ALTER TABLE public.goals DROP CONSTRAINT IF EXISTS goals_goal_type_check;
ALTER TABLE public.goals ADD CONSTRAINT goals_goal_type_check
  CHECK (goal_type IN ('lose_weight', 'gain_weight', 'gain_muscle', 'health', 'maintain', 'conditioning'));

-- ── (3a) Davet koduyla aileye katılma (kod-enumeration'a karşı dar yüzey) ──
CREATE OR REPLACE FUNCTION public.join_household_by_code(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_household households%ROWTYPE;
  v_member_count int;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  SELECT * INTO v_household FROM households WHERE invite_code = p_code;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Gecersiz davet kodu');
  END IF;

  SELECT count(*) INTO v_member_count FROM household_members WHERE household_id = v_household.id;
  IF v_member_count >= 6 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Aile dolu (en fazla 6 uye)');
  END IF;

  INSERT INTO household_members (household_id, user_id, role)
  VALUES (v_household.id, auth.uid(), 'member')
  ON CONFLICT (household_id, user_id) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'household', to_jsonb(v_household));
END;
$$;
REVOKE ALL ON FUNCTION public.join_household_by_code(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.join_household_by_code(text) TO authenticated;

-- ── (3b) Ortak alışveriş listesi: üyelerin aktif planlarının listesi ──
CREATE OR REPLACE FUNCTION public.get_household_shopping_list()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_household_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  SELECT household_id INTO v_household_id
  FROM household_members WHERE user_id = auth.uid() LIMIT 1;
  IF v_household_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'user_id', wp.user_id,
      'week_start', wp.week_start,
      'shopping_list', wp.shopping_list
    ))
    FROM weekly_plans wp
    WHERE wp.status = 'active'
      AND wp.plan_type = 'diet'
      AND wp.user_id IN (SELECT hm.user_id FROM household_members hm WHERE hm.household_id = v_household_id)
  ), '[]'::jsonb);
END;
$$;
REVOKE ALL ON FUNCTION public.get_household_shopping_list() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_household_shopping_list() TO authenticated;

-- ── (4) Tek-aile invariantı: aynı kullanıcı ikinci aile üyeliği açamasın ──
-- (getUserHousehold .maybeSingle() çok-satırda null dönüyordu; kökten çöz.)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_household_member_per_user
  ON public.household_members (user_id);

-- ── (5) Çok-kelimeli egzersiz adları: tek seferlik veri normalize ──
UPDATE public.strength_sets
SET exercise_name = replace(lower(exercise_name), ' ', '_')
WHERE exercise_name LIKE '% %';
