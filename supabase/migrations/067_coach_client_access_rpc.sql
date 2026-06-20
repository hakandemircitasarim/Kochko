-- 067: Koç (B2B) rızalı danışan verisine erişim RPC'si (LOW — RLS katmanında ölü paylaşım)
--
-- AMAÇ: getCoachClients() (src/services/coach-mode.service.ts:76) sıradan, RLS'e tabi client ile
-- profiles/daily_reports/goals'u danışan id'si üzerinden sorguluyor; ama bu tabloların SELECT
-- politikaları yalnız auth.uid()=id/user_id'ye izin verir → koç başka kullanıcının satırını GÖREMEZ
-- → profiles.single() null → her danışan continue ile atlanır → koç paneli DAİMA boş.
-- Bu migration, koçun YALNIZ aktif rıza (coach_consents) verdiği danışanların verisini, üstelik
-- danışanın paylaşmayı seçtiği veri tipleriyle (shared_data_types) sınırlı şekilde döndüren bir
-- SECURITY DEFINER RPC ekler. RPC RLS'i kontrollü baypas eder ama erişimi auth.uid()=coach_id +
-- is_active rıza + tip-bazlı maskeleme ile sıkıca kapılar.
--
-- CANLI-KANIT (node TEMP/q.mjs):
--   pg_proc'ta 'coach'/'client' içeren tek fonksiyon = weekly_plans_block_client_activation
--     → get_coach_clients HENÜZ YOK (additive).
--   coach_consents kolonları: id,user_id,coach_id,shared_data_types text[],is_active bool,
--     created_at,revoked_at  (coach_id köprüsü yalnız bu tabloda).
--   Hedef kolonlar doğrulandı: profiles(id,weight_kg,deleted_at), goals(user_id,goal_type,is_active),
--     daily_reports(user_id,date,compliance_score).
--
-- preApplyCheck:
--   SELECT 1 FROM pg_proc WHERE proname='get_coach_clients' AND pronamespace='public'::regnamespace;
--     -- boş dönmeli (yoksa CREATE OR REPLACE zaten idempotent — güvenli).
--
-- safety: needs-code-wiring
--   Bu migration SADECE RPC'yi ekler; coach-mode.service.ts hâlâ doğrudan tablo sorgusu yapıyor.
--   AYRI iş (Wave 5 coach-mode-service batch): getCoachClients()'i .rpc('get_coach_clients') ile
--   değiştir ve shareDataWithCoach()'ta coach_id'nin geçerli kullanıcı olduğunu doğrula.
--   RPC eklenince fonksiyonel etki yok (kimse çağırmıyor) → güvenli additive.
--
-- Idempotent: CREATE OR REPLACE FUNCTION + DROP/GRANT.
-- DOWN: DROP FUNCTION IF EXISTS public.get_coach_clients();

-- Dönüş tipi: danışan-başı bir satır. shared_data_types danışanın açtığı tipler;
-- tipe bağlı alanlar (goal/compliance) yalnız ilgili tip paylaşıldıysa doldurulur (maskeleme).
DROP FUNCTION IF EXISTS public.get_coach_clients();

CREATE OR REPLACE FUNCTION public.get_coach_clients()
RETURNS TABLE (
  client_id          uuid,
  weight_kg          numeric,
  goal_type          text,
  last_active_date   date,
  compliance_score   smallint,
  shared_data_types  text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
DECLARE
  v_coach uuid := auth.uid();
BEGIN
  -- Anonim/çağrı bağlamı yoksa hiçbir şey döndürme.
  IF v_coach IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id                                                            AS client_id,
    -- Temel profil yalnız her zaman; weight 'weight' veya 'profile' paylaşıldıysa.
    CASE WHEN cc.shared_data_types && ARRAY['weight','profile']::text[]
         THEN p.weight_kg ELSE NULL END                            AS weight_kg,
    -- Hedef yalnız 'goals'/'goal' paylaşıldıysa.
    CASE WHEN cc.shared_data_types && ARRAY['goals','goal']::text[]
         THEN g.goal_type ELSE NULL END                            AS goal_type,
    -- Son aktif / uyum yalnız 'reports'/'compliance'/'progress' paylaşıldıysa.
    CASE WHEN cc.shared_data_types && ARRAY['reports','compliance','progress']::text[]
         THEN dr.date ELSE NULL END                                AS last_active_date,
    CASE WHEN cc.shared_data_types && ARRAY['reports','compliance','progress']::text[]
         THEN dr.compliance_score ELSE NULL END                    AS compliance_score,
    COALESCE(cc.shared_data_types, '{}'::text[])                   AS shared_data_types
  FROM public.coach_consents cc
  JOIN public.profiles p
    ON p.id = cc.user_id
   AND p.deleted_at IS NULL
  -- Aktif tek hedef (varsa)
  LEFT JOIN LATERAL (
    SELECT gg.goal_type
    FROM public.goals gg
    WHERE gg.user_id = cc.user_id AND gg.is_active = true
    ORDER BY gg.created_at DESC NULLS LAST
    LIMIT 1
  ) g ON true
  -- En son günlük rapor (varsa)
  LEFT JOIN LATERAL (
    SELECT d.date, d.compliance_score
    FROM public.daily_reports d
    WHERE d.user_id = cc.user_id
    ORDER BY d.date DESC
    LIMIT 1
  ) dr ON true
  WHERE cc.coach_id = v_coach
    AND cc.is_active = true;
END $$;

-- Yalnız oturum açmış kullanıcılar çağırabilsin (RPC içi auth.uid()=coach_id zaten kapılıyor).
REVOKE ALL ON FUNCTION public.get_coach_clients() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_coach_clients() TO authenticated;
