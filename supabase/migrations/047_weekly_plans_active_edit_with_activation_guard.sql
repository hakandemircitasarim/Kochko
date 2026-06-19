-- 047: weekly_plans — client'ın AKTİF planını düzenlemesine izin ver (alışveriş listesi
-- işaretleme, approved_at), ama draft→active TERFİSİNİ (free-premium gate) trigger'la engelle.
--
-- 043 WITH CHECK status IN ('draft','archived') idi → WITH CHECK update SONRASI satıra
-- bakar, yani AKTİF bir planı düzenlemek (toggleShoppingItem / approveWeeklyPlan /
-- requestMenuModification) 42501 ile tamamen blok oluyordu (#R4-5). Politikayı sahibinin
-- kendi satırına genişlet; tek korunması gereken şey client'ın bir planı 'active'e terfi
-- ettirmesi (plan-cap baypası) — bunu trigger yapar (terfi yalnız service_role/ai-chat yolu).

DROP POLICY IF EXISTS weekly_plans_upd ON public.weekly_plans;
CREATE POLICY weekly_plans_upd ON public.weekly_plans
  FOR UPDATE TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.weekly_plans_block_client_activation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  -- Authenticated/anon client bir planı non-active → 'active' TERFİ EDEMEZ.
  -- service_role (ai-chat user_approved yolu) serbest. active→active düzenleme
  -- (alışveriş listesi vb.) ve draft/archived güncellemeleri serbest.
  -- NOT: current_user KULLANMA — fonksiyon SECURITY DEFINER olduğundan current_user
  -- owner'ı (postgres) döner; auth.role() JWT rolünü güvenilir döner.
  IF NEW.status = 'active' AND COALESCE(OLD.status, '') <> 'active'
     AND auth.role() IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'Plan aktiflestirme yalniz sunucu tarafindan yapilabilir (free-premium gate)';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_weekly_plans_block_client_activation ON public.weekly_plans;
CREATE TRIGGER tg_weekly_plans_block_client_activation
  BEFORE UPDATE ON public.weekly_plans
  FOR EACH ROW EXECUTE FUNCTION public.weekly_plans_block_client_activation();
