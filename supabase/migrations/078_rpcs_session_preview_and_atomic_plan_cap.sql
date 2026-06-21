-- 078: RPC'ler — DB-IDX-03 (oturum önizleme) + DB-PRM-01 (atomik free-plan cap)
-- (audit 2026-06-21). Çağrı-yeri bağlama (chat.service / ai-chat) AYRI commit'te yapılır.

-- DB-IDX-03 (MEDIUM): loadSessions, 20 oturumun TÜM mesajlarını aşırı-çekip istemcide eliyordu.
-- DISTINCT ON ile oturum-başına TEK son mesaj satırı döndür. SECURITY DEFINER + auth.uid() ile
-- yalnız çağıranın kendi mesajları (RLS-eşdeğeri kapsam).
CREATE OR REPLACE FUNCTION public.get_session_last_messages(p_session_ids uuid[])
RETURNS TABLE(session_id uuid, content text, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT ON (m.session_id) m.session_id, m.content, m.created_at
  FROM public.chat_messages m
  WHERE m.session_id = ANY(p_session_ids)
    AND m.user_id = auth.uid()
  ORDER BY m.session_id, m.created_at DESC;
$$;
REVOKE EXECUTE ON FUNCTION public.get_session_last_messages(uuid[]) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_session_last_messages(uuid[]) TO authenticated, service_role;

-- DB-PRM-01 (MEDIUM): free-tier plan cap (1 ömür-boyu diyet + 1 antrenman) ai-chat'te atomik-olmayan
-- read-then-write idi → eşzamanlı iki 'approve' lost-update ile cap'i bypass edebiliyordu. profiles
-- satırını FOR UPDATE kilitle, per-type cap'i tek tx'te yeniden-kontrol et + artır. true = slot
-- tüketildi, false = cap zaten dolu. Yalnız service_role (ai-chat supabaseAdmin) çağırır.
CREATE OR REPLACE FUNCTION public.consume_free_plan_slot(p_user uuid, p_plan_type text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_used  jsonb;
  v_count int;
BEGIN
  SELECT plans_used_free INTO v_used FROM public.profiles WHERE id = p_user FOR UPDATE;
  v_count := COALESCE((v_used ->> p_plan_type)::int, 0);
  IF v_count >= 1 THEN
    RETURN false;
  END IF;
  UPDATE public.profiles
  SET plans_used_free = jsonb_set(COALESCE(plans_used_free, '{}'::jsonb), ARRAY[p_plan_type], to_jsonb(v_count + 1), true)
  WHERE id = p_user;
  RETURN true;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.consume_free_plan_slot(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.consume_free_plan_slot(uuid, text) TO service_role;
