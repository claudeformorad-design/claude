#!/usr/bin/env bash
# يشغّل الترحيلات واختبارات قاعدة البيانات على PostgreSQL محلي مؤقت.
# الاستخدام: npm run test:db   (يتطلب PostgreSQL 15+ مثبتًا محليًا)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PGBIN="${PGBIN:-$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1)}"
WORK="$(mktemp -d)"
PORT="${PGPORT_TEST:-54329}"
cleanup() { "$PGBIN/pg_ctl" -D "$WORK/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT

run_as_pg() { if [ "$(id -u)" = "0" ]; then chown -R postgres "$WORK"; su postgres -c "$*"; else bash -c "$*"; fi; }

run_as_pg "'$PGBIN/initdb' -D '$WORK/data' -U postgres -A trust >/dev/null"
run_as_pg "'$PGBIN/pg_ctl' -D '$WORK/data' -o '-p $PORT -k $WORK -c listen_addresses=' -l '$WORK/log' -w start >/dev/null"

PSQL=(psql -h "$WORK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -f "$HERE/supabase_shim.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "→ migration $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done
for f in "$HERE"/*.test.sql; do
  echo "→ test $(basename "$f")"
  "${PSQL[@]}" -f "$f"
done
echo "✓ all database tests passed"
