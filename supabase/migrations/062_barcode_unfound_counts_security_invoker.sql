-- Migration 062: barcode_unfound_counts view → security_invoker + grant temizliği
--
-- AMAÇ (Audit LOW): View `security_invoker` olmadan tanımlı ve sahibi `postgres`
--   (rolbypassrls=true). Bu yüzden alttaki `barcode_corrections` tablosunun RLS'i
--   gerçekten BYPASS edilir; view'ı sorgulayan herhangi bir kullanıcı tüm
--   kullanıcıların `_UNFOUND_` barkod aramalarını GROUP BY ile agregelenmiş görür
--   (düşük hassasiyetli cross-user sızıntı). security_invoker=on yapınca RLS
--   çağıran kullanıcıya uygulanır ve sızıntı kapanır.
--
-- CANLI KANIT (node TEMP/q.mjs ile doğrulandı):
--   * pg_get_viewdef: SELECT barcode, count(DISTINCT user_id) AS miss_count,
--       max(created_at) AS last_miss_at FROM barcode_corrections
--       WHERE food_name = '_UNFOUND_' GROUP BY barcode;  (yalnız agregat, DML yok)
--   * pg_class.reloptions = NULL  → security_invoker KAPALI (varsayılan=off)
--   * view owner = 'postgres'     → rolbypassrls=true
--   * information_schema grants: anon + authenticated rollerinde
--       SELECT/INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER (Supabase
--       varsayılan GRANT ALL). DML grant'ları bir agregat view'da anlamsız;
--       yalnız authenticated'a SELECT bırakıyoruz.
--
-- IDEMPOTENCY: ALTER VIEW SET (...) ve REVOKE/GRANT tekrar çalıştırılabilir.
--   View zaten var (016'da yaratıldı); CREATE etmiyoruz, yalnız nitelik değiştiriyoruz.
--
-- DOWN (geri alma): ALTER VIEW public.barcode_unfound_counts SET (security_invoker = off);
--   ve istenirse GRANT ALL ON public.barcode_unfound_counts TO anon, authenticated;

ALTER VIEW public.barcode_unfound_counts SET (security_invoker = on);

-- Agregat view'da DML grant'ları gereksiz; yetki yüzeyini daralt.
REVOKE ALL ON public.barcode_unfound_counts FROM anon;
REVOKE ALL ON public.barcode_unfound_counts FROM authenticated;
GRANT SELECT ON public.barcode_unfound_counts TO authenticated;

NOTIFY pgrst, 'reload schema';
