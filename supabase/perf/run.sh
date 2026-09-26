#!/usr/bin/env bash
# قياس الأداء على حجم بيانات كبير في PostgreSQL مؤقت (لا يمس أي قاعدة حقيقية).
# الاستخدام: npm run test:perf   (يتطلب PostgreSQL 15+ مثبتًا محليًا)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
WORK="$(mktemp -d)"
PORT="${PGPORT_PERF:-54341}"
cleanup() { "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
run_as_pg() { if [ "$(id -u)" = "0" ]; then chown -R postgres "$WORK"; su postgres -c "$*"; else bash -c "$*"; fi; }
cp "$HERE"/*.sql "$WORK"/; chmod 755 "$WORK"; chmod 644 "$WORK"/*.sql
run_as_pg "'$PGBIN/initdb' -D '$WORK/data' -U postgres -A trust >/dev/null"
run_as_pg "'$PGBIN/pg_ctl' -D '$WORK/data' -o '-p $PORT -k $WORK -c listen_addresses=' -l '$WORK/log' -w start >/dev/null"
PSQL=(psql -h "$WORK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -f "$ROOT/supabase/tests/supabase_shim.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do "${PSQL[@]}" -f "$f"; done
start=$(date +%s); "${PSQL[@]}" -f "$WORK/load.sql" >/dev/null; echo "تحميل البيانات: $(( $(date +%s) - start )) ث"
"${PSQL[@]}" -f "$WORK/queries.sql" 2>&1 | grep -E "^---|^Time|difference|^ [a-z_]+ +\|"
