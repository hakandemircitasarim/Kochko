-- 038: DB-layer security + correctness hardening (round-8 DB audit)
--
-- (1) FREE-PREMIUM RLS HOLE (high): profiles_upd has USING(auth.uid()=id) and NULL
--     WITH CHECK, so a client (anon/authenticated) could self-grant premium / is_coach
--     and reset free quotas (premium/is_coach/plans_used_free are never legitimately
--     client-written — verified 0 client write sites). A BEFORE UPDATE trigger forces
--     those columns back to OLD for client roles. service_role (edge) and postgres
--     (migrations + the SECURITY DEFINER sync_profile_premium trigger) are unaffected,
--     so subscription-driven premium sync still works. trial_used keeps its legit
--     false->true (trial start) but cannot be reset true->false (trial farming).
--     deleted_at / deletion_requested_at / notification_prefs etc. stay client-editable.
--
-- (2) AUDIT-LOG FORGERY (medium): the "Service can insert audit logs" INSERT policy was
--     granted to {public} WITH CHECK (true) -> any user could forge audit rows for any
--     user_id. Restrict it to service_role (the client keeps audit_logs_insert_own).
--
-- (3) get_community_barcode 42702 (high, feature dead): RETURNS TABLE OUT-param names
--     (food_name/calories/portion_g) shadow the table columns -> ambiguous-column throw
--     on every call. Qualify all column refs with a table alias.

-- ---- (1) profiles entitlement protection ----------------------------------
CREATE OR REPLACE FUNCTION public.protect_profile_entitlements()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- SECURITY INVOKER (default): current_user is the CALLER's role. PostgREST sets it to
  -- 'authenticated'/'anon' for client requests, 'service_role' for the service key.
  -- A SECURITY DEFINER caller (sync_profile_premium, owned by postgres) shows 'postgres'.
  IF current_user IN ('authenticated', 'anon') THEN
    NEW.premium            := OLD.premium;
    NEW.premium_expires_at := OLD.premium_expires_at;
    NEW.is_coach           := OLD.is_coach;
    NEW.plans_used_free    := OLD.plans_used_free;
    IF OLD.trial_used THEN
      NEW.trial_used := OLD.trial_used;  -- block true->false reset; allow false->true
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tg_protect_profile_entitlements ON public.profiles;
CREATE TRIGGER tg_protect_profile_entitlements
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_entitlements();

-- ---- (2) audit_logs forgery -----------------------------------------------
ALTER POLICY "Service can insert audit logs" ON public.audit_logs TO service_role;

-- ---- (3) get_community_barcode ambiguous-column fix -----------------------
CREATE OR REPLACE FUNCTION public.get_community_barcode(p_barcode text)
 RETURNS TABLE(found boolean, food_name text, calories numeric, protein_g numeric, carbs_g numeric, fat_g numeric, portion_g numeric, contributor_count integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_count INT;
BEGIN
  SELECT COUNT(DISTINCT bc.user_id) INTO v_count
  FROM barcode_corrections bc
  WHERE bc.barcode = p_barcode
    AND bc.food_name <> '_UNFOUND_'
    AND bc.calories > 0
    AND bc.portion_g > 0;

  IF v_count < 3 THEN
    RETURN QUERY SELECT false, NULL::TEXT, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, NULL::NUMERIC, v_count;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    true,
    (mode() WITHIN GROUP (ORDER BY bc.food_name))::TEXT,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY bc.calories)::NUMERIC,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY bc.protein_g)::NUMERIC,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY bc.carbs_g)::NUMERIC,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY bc.fat_g)::NUMERIC,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY bc.portion_g)::NUMERIC,
    v_count
  FROM barcode_corrections bc
  WHERE bc.barcode = p_barcode
    AND bc.food_name <> '_UNFOUND_'
    AND bc.calories > 0
    AND bc.portion_g > 0;
END;
$function$;
