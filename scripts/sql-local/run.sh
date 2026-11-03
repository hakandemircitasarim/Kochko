#!/usr/bin/env bash
# Migrasyonları (001-…) sıfırdan, geçici bir yerel PostgreSQL kümesinde uygular ve
# supabase/tests/v2_rpc_test.sql'i koşar. Docker ya da Supabase CLI gerekmez; yalnız
# PostgreSQL sunucu ikilileri (initdb, pg_ctl) + psql. Canlı ya da dal DB'sine dokunmaz.
#
#   bash scripts/sql-local/run.sh            # küme kur, uygula, testi koş, kümeyi sil
#   KEEP=1 bash scripts/sql-local/run.sh     # sonda kümeyi açık bırak (bağlantı satırı yazılır)
#
# Repo migrasyon geçmişinin canlıdaki elle yapılmış değişikliklere dayandığı yerler (sıfırdan
# `supabase db reset`'i de kırar) burada yerel ön-düzeltmelerle karşılanır:
#   038  "Service can insert audit logs" politikası hiçbir migrasyonda yaratılmıyor → önce yaratılır
#   040  household tabloları ancak 051'de (baseline) yaratılıyor → 051 önce uygulanır (idempotent)
#   069  pgsodium yoksa SECURITY LABEL ... IS NULL hata verir → yerelde atlanır
#   014/022 pg_cron/pg_net uzantıları yok → şimdeki sahte cron/net şemaları
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
HERE="$ROOT/scripts/sql-local"
MIG="$ROOT/supabase/migrations"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
PORT="${PORT:-54329}"
DIR="$(mktemp -d /var/tmp/kochko-pg.XXXXXX)"
as_pg() { if [ "$(id -u)" = 0 ]; then su postgres -s /bin/bash -c "$*"; else bash -c "$*"; fi; }
[ "$(id -u)" = 0 ] && chown postgres "$DIR"
cleanup() { as_pg "'$PGBIN/pg_ctl' -D '$DIR/data' -m fast stop" >/dev/null 2>&1 || true; rm -rf "$DIR"; }
[ "${KEEP:-0}" = 1 ] || trap cleanup EXIT

as_pg "'$PGBIN/initdb' -D '$DIR/data' -U postgres --auth=trust" >/dev/null
as_pg "'$PGBIN/pg_ctl' -D '$DIR/data' -o '-p $PORT -k $DIR -c listen_addresses=' -l '$DIR/log' -w start" >/dev/null
PSQL=(psql -h "$DIR" -p "$PORT" -U postgres -X -q -v ON_ERROR_STOP=1)

"${PSQL[@]}" -f "$HERE/supabase-shim.sql" >/dev/null
for f in $(cd "$MIG" && ls *.sql | sort); do
  case "$f" in
    038_*) "${PSQL[@]}" -c 'CREATE POLICY "Service can insert audit logs" ON public.audit_logs FOR INSERT WITH CHECK (true);' >/dev/null ;;
    040_*) "${PSQL[@]}" -1 -f "$MIG/051_baseline_household_coach_tables.sql" >/dev/null ;;
  esac
  sed -E -e 's/^\s*CREATE EXTENSION IF NOT EXISTS (pg_cron|pg_net)\s*;//I' \
         -e "s/EXECUTE 'SECURITY LABEL FOR pgsodium[^;]*;/NULL;/" "$MIG/$f" \
    | "${PSQL[@]}" -1 >"$DIR/m.log" 2>&1 || { echo "MIGRASYON HATASI: $f"; grep -E 'ERROR|LINE' "$DIR/m.log" | head -5; exit 1; }
done
echo "migrasyonlar uygulandı (son: $f)"

"${PSQL[@]}" -f "$ROOT/supabase/tests/v2_rpc_test.sql" 2>&1 | grep -E 'ERROR|v2_rpc_test OK' | tee "$DIR/t.log"
grep -q 'v2_rpc_test OK' "$DIR/t.log"
[ "${KEEP:-0}" = 1 ] && echo "küme açık: psql -h $DIR -p $PORT -U postgres"
exit 0
