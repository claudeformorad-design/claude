#!/usr/bin/env bash
# =============================================================================
# كل اختبارات المتصفح قبل أي نشر. كل اختبار على قاعدة فارغة جديدة وخادم مستقل (وضع PGlite المحلي).
# الاستخدام (بعد: npm run build):
#   CHROME=/path/to/chromium bash scripts/e2e-all.sh            # النظام وحده
#   CHROME=... PANEL_DIR=../sanad-admin bash scripts/e2e-all.sh  # ومعه لوحة هوتيلنا واختبار الربط (بعد بناء اللوحة)
# النجاح = كل سطر «N ok 0 fail». السجلات والصور في $OUT (الافتراضي مجلد مؤقت).
# =============================================================================
set -u
cd "$(dirname "$0")/.."
OUT=${OUT:-$(mktemp -d)}
: "${CHROME:?ضع مسار متصفح Chromium في CHROME}"
[ -d .next/standalone ] || { echo "ابنِ النظام أولًا: npm run build"; exit 1; }
cp -r .next/static .next/standalone/.next/static 2>/dev/null
FAIL=0

start() { # الاسم المنفذ [متغيرات إضافية...]
  local name=$1 port=$2; shift 2
  rm -rf "$OUT/db-$name"; mkdir -p "$OUT/db-$name"
  (cd .next/standalone && env PORT=$port HOSTNAME=127.0.0.1 LOCAL_DB_DIR="$OUT/db-$name/pglite" AUTO_BACKUP=off "$@" nohup node server.js > "$OUT/srv-$name.log" 2>&1 &)
  sleep 8
}
stop() { fuser -k "$1/tcp" >/dev/null 2>&1 || true; }
suite() { # الاسم المنفذ الملف
  env BASE_URL=http://127.0.0.1:$2 LOCAL=1 CHROME="$CHROME" SHOTS="$OUT" node "$3" > "$OUT/suite-$1.log" 2>&1
  local code=$? ok=$(grep -c '^✓' "$OUT/suite-$1.log") bad=$(grep -c '^✗' "$OUT/suite-$1.log")
  echo "$1: $ok ok $bad fail (exit $code)"
  [ "$code" = 0 ] && [ "$bad" = 0 ] || FAIL=1
}
run() { start "$1" "$2"; suite "$1" "$2" "$3"; stop "$2"; }

run forms      3330 e2e/ui-forms.mjs
run pms        3332 e2e/ui-pms.mjs
run services   3333 e2e/ui-services.mjs
run edge       3334 e2e/ui-edge.mjs
run documents  3335 e2e/ui-documents.mjs
run perms      3411 e2e/ui-permissions.mjs
run english    3410 e2e/ui-english.mjs
run hr         3412 e2e/ui-hr.mjs
run features   3375 e2e/ui-features.mjs
run accounting 3460 e2e/ui-accounting-plus.mjs
run walk       3414 e2e/ui-walkthrough.mjs

if [ -n "${PANEL_DIR:-}" ]; then
  [ -d "$PANEL_DIR/.next/standalone" ] || { echo "ابنِ اللوحة أولًا: (cd $PANEL_DIR && npm run build)"; exit 1; }
  cp -r "$PANEL_DIR/.next/static" "$PANEL_DIR/.next/standalone/.next/static" 2>/dev/null
  panel() { # بيانات لوحة جديدة كل مرة، بكودي الإعداد والاستعادة الخاصين بالاختبار
    rm -rf "$OUT/panel-data"; mkdir -p "$OUT/panel-data"
    (cd "$PANEL_DIR/.next/standalone" && env PORT=3390 HOSTNAME=127.0.0.1 LOCAL_HTTP=1 LOCAL_DATA_DIR="$OUT/panel-data" \
      ADMIN_SETUP_CODE=setup-code-xyz ADMIN_RESET_CODE=RCVR-7K2M-9QXA nohup node server.js > "$OUT/srv-panel.log" 2>&1 &)
    sleep 5
  }
  panel; suite panel-admin 3390 e2e/panel-admin.mjs; stop 3390
  # الربط الحقيقي: نظام يطلب الترخيص من اللوحة ويتواصل كل 10 ثوانٍ
  panel
  PK=$(curl -s http://127.0.0.1:3390/api/v1/public-key | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).public_key))')
  start link 3376 NAZEEL_REQUIRE_LICENSE=1 NAZEEL_PANEL_URL=http://127.0.0.1:3390 NAZEEL_LICENSE_PUBLIC_KEY="$PK" NAZEEL_CHECKIN_SECONDS=10
  env PANEL_URL=http://127.0.0.1:3390 BASE_URL=http://127.0.0.1:3376 CHROME="$CHROME" SHOTS="$OUT" node e2e/panel-link.mjs > "$OUT/suite-panel-link.log" 2>&1
  code=$?; ok=$(grep -c '^✓' "$OUT/suite-panel-link.log"); bad=$(grep -c '^✗' "$OUT/suite-panel-link.log")
  echo "panel-link: $ok ok $bad fail (exit $code)"; { [ "$code" = 0 ] && [ "$bad" = 0 ]; } || FAIL=1
  stop 3376; stop 3390
fi

echo "logs: $OUT"
[ "$FAIL" = 0 ] && echo "ALL PASSED" || { echo "SOME FAILED"; exit 1; }
