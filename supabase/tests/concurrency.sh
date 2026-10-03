#!/usr/bin/env bash
# اختبار التزامن: 20 جلسة PostgreSQL تحجز في نفس اللحظة — لا ازدواج ولا تجاوز للسعة
# الاستخدام: npm run test:concurrency   (يتطلب PostgreSQL 15+ مثبتًا محليًا ويعمل كـ root)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PGBIN=$(ls -d /usr/lib/postgresql/*/bin | sort -V | tail -1)
WORK=$(mktemp -d); PORT=54351
cleanup() { su postgres -c "'$PGBIN/pg_ctl' -D '$WORK/data' -m immediate stop" >/dev/null 2>&1 || true; rm -rf "$WORK"; }
trap cleanup EXIT
chown -R postgres "$WORK"; chmod 755 "$WORK"
su postgres -c "'$PGBIN/initdb' -D '$WORK/data' -U postgres -A trust >/dev/null"
su postgres -c "'$PGBIN/pg_ctl' -D '$WORK/data' -o '-p $PORT -k $WORK -c listen_addresses= -c max_connections=100' -l '$WORK/log' -w start >/dev/null"
P=(psql -h "$WORK" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X -t -A)
"${P[@]}" -f "$ROOT/supabase/tests/supabase_shim.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/*.sql; do "${P[@]}" -f "$f" >/dev/null; done
U=00000000-0000-0000-0000-00000000c001
"${P[@]}" >/dev/null <<SQL
insert into auth.users (id, email) values ('$U', 'gm@c.test');
create table public.cx (k text primary key, v uuid);
SQL
"${P[@]}" -c "grant all on public.cx to authenticated" >/dev/null
"${P[@]}" >/dev/null <<SQL
select set_config('request.jwt.claim.sub', '$U', false); set role authenticated;
insert into public.cx select 'h', public.create_hotel('فندق التزامن', 'SA', 'SAR');
insert into public.room_types (hotel_id, code, name_ar, base_rate, max_adults) select v, 'DBL', 'مزدوجة', 200, 2 from public.cx where k = 'h';
insert into public.cx select 'rt', id from public.room_types where hotel_id = (select v from public.cx where k = 'h');
select public.create_rooms_bulk((select v from public.cx where k = 'h'), (select v from public.cx where k = 'rt'), 101, 103);
insert into public.cx select 'room', id from public.rooms where room_number = '101';
insert into public.guests (hotel_id, full_name) select v, 'نزيل' from public.cx where k = 'h';
insert into public.cx select 'g', id from public.guests limit 1;
SQL
book() { # $1 = with room (1) or type only (0)
  "${P[@]}" 2>&1 <<SQL
select set_config('request.jwt.claim.sub', '$U', false); set role authenticated;
select public.create_reservation(p_hotel_id => (select v from public.cx where k = 'h'), p_guest_id => (select v from public.cx where k = 'g'),
  p_room_type_id => (select v from public.cx where k = 'rt'), p_room_id => case when $1 = 1 then (select v from public.cx where k = 'room') end,
  p_arrival_date => current_date + 10, p_departure_date => current_date + 12);
SQL
}
echo "── 20 موظفًا يحجزون الغرفة 101 لنفس الليالي في نفس اللحظة"
for i in $(seq 1 20); do book 1 > "$WORK/a$i.out" 2>&1 & done; wait
ok=$(( 20 - $(grep -l ERROR "$WORK"/a*.out | wc -l) )); echo "   نجح: $ok (المتوقع 1)"
grep -h "ERROR" "$WORK"/a*.out | sed 's/.*ERROR: *//' | sort | uniq -c | head -3
echo "── 20 موظفًا يحجزون نفس النوع (بلا غرفة) والمتبقي غرفتان"
for i in $(seq 1 20); do book 0 > "$WORK/b$i.out" 2>&1 & done; wait
ok2=$(( 20 - $(grep -l ERROR "$WORK"/b*.out | wc -l) )); echo "   نجح: $ok2 (المتوقع 2)"
grep -h "ERROR" "$WORK"/b*.out | sed 's/.*ERROR: *//' | sort | uniq -c | head -3
total=$("${P[@]}" -c "select count(*) from public.reservations where status in ('tentative','confirmed')")
echo "── الحجوزات الفعالة في القاعدة: $total (المتوقع 3 = سعة النوع)"
[ "$ok" = 1 ] && [ "$ok2" = 2 ] && [ "$total" = 3 ] && echo "✓ concurrency OK" || { echo "✗ concurrency FAILED"; exit 1; }
