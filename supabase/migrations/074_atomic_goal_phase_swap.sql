-- 074: atomik aktif-hedef takasi (HIGH — audit 2026-06-21 DB-TRG-01 + AI-INT-02)
--
-- AMAÇ: Iki yer tek-aktif-hedef invariant'ini (mig 033) transaction'siz iki UPDATE ile koruyor:
--   * src/services/goals.service.ts advanceToNextPhase(): deactivate→activate; ikinci basarisizsa
--     SIFIR aktif hedef kalir. Ayrica son fazda "sonraki" yoktur ama yine de deactivate eder →
--     kullanici hicbir aktif hedefi olmadan kalir.
--   * supabase/functions/ai-proactive/index.ts (~912): ayni iki-statement, transaction yok.
--
-- ÇÖZÜM: swap_active_goal(p_user, p_next_id) SECURITY DEFINER RPC — tek tx'te kullanicinin tum
-- aktif hedeflerini pasifle + p_next_id'yi aktive et (her ikisi de p_user'a ait olmali). Caller
-- yalnizca "sonraki faz VARSA" cagirir, boylece son-faz-sifir-aktif hatasi olusmaz. Hata olursa
-- tum tx rollback → asla 0-aktif durumu olusmaz.
--
-- GUVENLIK (audit DB-FUN-01 dersi): REVOKE FROM PUBLIC/anon; client (authenticated) ve cron
-- (service_role) cagirir; iç guard authenticated cagiranin yalniz KENDI hedefini takas etmesine izin verir.
-- Idempotent: CREATE OR REPLACE. Geri-alma: DROP FUNCTION public.swap_active_goal(uuid, uuid).

CREATE OR REPLACE FUNCTION public.swap_active_goal(p_user uuid, p_next_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- authenticated caller yalniz kendi hedefini takas edebilir; service_role (auth.uid()=NULL) serbest.
  IF auth.uid() IS NOT NULL AND auth.uid() <> p_user THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Hedef satir kullaniciya ait degilse hicbir sey yapma (caller'in p_next_id'si yanlissa koru).
  PERFORM 1 FROM public.goals WHERE id = p_next_id AND user_id = p_user;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Atomik takas: once tum aktifleri pasifle, sonra hedefi aktive et (tek tx).
  UPDATE public.goals SET is_active = false WHERE user_id = p_user AND is_active = true;
  UPDATE public.goals SET is_active = true  WHERE id = p_next_id AND user_id = p_user;
  RETURN true;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.swap_active_goal(uuid, uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.swap_active_goal(uuid, uuid) TO authenticated, service_role;
