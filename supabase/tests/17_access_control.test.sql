-- =============================================================================
-- اختبارات الترحيل 29: نظام الصلاحيات المتقدم
-- الاستثناءات، الحراسات ضد تصعيد الصلاحيات، الحدود المالية، طلبات الموافقة، إعدادات الواجهة
-- =============================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\o /dev/null

create or replace function pg_temp.expect_error(p_sql text, p_contains text)
returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then
    if position(p_contains in sqlerrm) = 0 then raise exception 'Expected "%", got "%"', p_contains, sqlerrm; end if;
    return;
  end;
  raise exception 'Expected error "%", but succeeded: %', p_contains, p_sql;
end $$;
create or replace function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), false);
  if p_user is null then reset role; else set role authenticated; end if;
end $$;

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000001701', 'gm@hotel.test'),
  ('00000000-0000-0000-0000-000000001702', 'admin@hotel.test'),
  ('00000000-0000-0000-0000-000000001703', 'front@hotel.test'),
  ('00000000-0000-0000-0000-000000001704', 'clerk@hotel.test');

create temp table ids (k text primary key, v uuid);
grant all on ids to authenticated;

select pg_temp.act_as('00000000-0000-0000-0000-000000001701');
insert into ids select 'h', public.create_hotel('فندق الصلاحيات', 'SA', 'SAR');

-- دور خاص: مدير مستخدمين بلا صلاحيات مالية
with r as (
  insert into public.roles (hotel_id, code, name_ar, name_en) values ((select v from ids where k = 'h'), 'user_admin', 'مسؤول المستخدمين', 'User admin') returning id)
insert into ids select 'role_admin', id from r;
insert into public.role_permissions (role_id, permission_code)
values ((select v from ids where k = 'role_admin'), 'settings.users.manage'), ((select v from ids where k = 'role_admin'), 'folio.view');
-- دور خاص: مشرف استقبال يملك الفوليو والخصم
with r as (
  insert into public.roles (hotel_id, code, name_ar, name_en) values ((select v from ids where k = 'h'), 'front_lead', 'مشرف استقبال', 'Front lead') returning id)
insert into ids select 'role_front', id from r;
insert into public.role_permissions (role_id, permission_code)
select (select v from ids where k = 'role_front'), c from unnest(array['folio.view', 'folio.manage', 'folio.allowance']) c;

select pg_temp.act_as(null);
insert into public.hotel_members (hotel_id, user_id) select (select v from ids where k = 'h'), u
from unnest(array['00000000-0000-0000-0000-000000001702', '00000000-0000-0000-0000-000000001703', '00000000-0000-0000-0000-000000001704']::uuid[]) u;
insert into public.user_hotel_roles (hotel_id, user_id, role_id) values
  ((select v from ids where k = 'h'), '00000000-0000-0000-0000-000000001702', (select v from ids where k = 'role_admin')),
  ((select v from ids where k = 'h'), '00000000-0000-0000-0000-000000001703', (select v from ids where k = 'role_front')),
  ((select v from ids where k = 'h'), '00000000-0000-0000-0000-000000001704', (select id from public.roles where is_system and code = 'receptionist'));

-- =============================================================================
-- الاستثناءات: المنح والمنع فوق الدور، والمنع يتقدم
-- =============================================================================
select pg_temp.act_as('00000000-0000-0000-0000-000000001701');
select public.set_member_access((select v from ids where k = 'h'), '00000000-0000-0000-0000-000000001704',
  array[(select id from public.roles where is_system and code = 'receptionist')],
  array['reports.cash.view'], array['pms.reservations.cancel'], '/front-desk', '{}'::jsonb, true);
select pg_temp.act_as('00000000-0000-0000-0000-000000001704');
do $$ begin
  assert app.has_permission((select v from ids where k = 'h'), 'reports.cash.view'), 'granted permission is effective';
  assert not app.has_permission((select v from ids where k = 'h'), 'pms.reservations.cancel'), 'denied permission beats the role';
  assert app.has_permission((select v from ids where k = 'h'), 'pms.reservations.view'), 'other role permissions remain';
  assert 'reports.cash.view' in (select public.my_permissions((select v from ids where k = 'h'))), 'my_permissions includes grants';
  assert 'pms.reservations.cancel' not in (select public.my_permissions((select v from ids where k = 'h'))), 'my_permissions excludes denies';
  assert (public.my_interface((select v from ids where k = 'h')) ->> 'home_path') = '/front-desk', 'personal home page';
end $$;

-- =============================================================================
-- الحراسات
-- =============================================================================
-- لا يعدّل أحد صلاحياته بنفسه، ولا حتى المدير العام
select pg_temp.act_as('00000000-0000-0000-0000-000000001704');
select pg_temp.expect_error($q$
  insert into public.user_permission_overrides (hotel_id, user_id, permission_code, allow)
  values ((select v from ids where k = 'h'), '00000000-0000-0000-0000-000000001704', 'gl.journal.view', true)
$q$, 'your own access');
select pg_temp.act_as('00000000-0000-0000-0000-000000001701');
select pg_temp.expect_error($q$
  select public.set_member_access((select v from ids where k = 'h'), '00000000-0000-0000-0000-000000001701',
    array[(select id from public.roles where is_system and code = 'general_manager')], '{}', '{}', null, '{}', true)
$q$, 'your own access');
-- مسؤول المستخدمين لا يمنح ما لا يملكه، لا بدور ولا باستثناء
select pg_temp.act_as('00000000-0000-0000-0000-000000001702');
select pg_temp.expect_error($q$
  select public.set_member_access((select v from ids where k = 'h'), '00000000-0000-0000-0000-000000001704',
    array[(select id from public.roles where is_system and code = 'general_manager')], '{}', '{}', null, '{}', true)
$q$, 'do not have');
select pg_temp.expect_error($q$
  select public.set_member_access((select v from ids where k = 'h'), '00000000-0000-0000-0000-000000001704',
    array[(select id from public.roles where is_system and code = 'receptionist')], array['gl.journal.post'], '{}', null, '{}', true)
$q$, 'do not have');
-- ولا يرفع نفسه إلى مدير عام
select pg_temp.expect_error($q$
  insert into public.user_hotel_roles (hotel_id, user_id, role_id)
  values ((select v from ids where k = 'h'), '00000000-0000-0000-0000-000000001702', (select id from public.roles where is_system and code = 'general_manager'))
$q$, 'your own access');
-- ولا يدير موظفًا يملك صلاحيات ليست عنده، حتى لو منحه ما يملكه
select pg_temp.expect_error($q$
  select public.set_member_access((select v from ids where k = 'h'), '00000000-0000-0000-0000-000000001704',
    array[(select id from public.roles where is_system and code = 'receptionist')], array['folio.view'], '{}', null, '{}', true)
$q$, 'permissions you do not have');
-- منح وصد نفس الصلاحية مرفوض
select pg_temp.act_as('00000000-0000-0000-0000-000000001701');
select pg_temp.expect_error($q$
  select public.set_member_access((select v from ids where k = 'h'), '00000000-0000-0000-0000-000000001704',
    '{}', array['folio.view'], array['folio.view'], null, '{}', true)
$q$, 'both granted and denied');
-- مسؤول المستخدمين لا يدير من هو أعلى منه، فلا يعطّل المدير العام ولا يمنعه من شيء
select pg_temp.act_as('00000000-0000-0000-0000-000000001702');
select pg_temp.expect_error($q$
  update public.hotel_members set is_active = false
  where hotel_id = (select v from ids where k = 'h') and user_id = '00000000-0000-0000-0000-000000001701'
$q$, 'last active general manager');
select pg_temp.expect_error($q$
  insert into public.user_permission_overrides (hotel_id, user_id, permission_code, allow)
  values ((select v from ids where k = 'h'), '00000000-0000-0000-0000-000000001701', 'gl.journal.view', false)
$q$, 'permissions you do not have');
select pg_temp.expect_error($q$
  select public.set_member_access((select v from ids where k = 'h'), '00000000-0000-0000-0000-000000001703',
    array[(select v from ids where k = 'role_front')], '{}', '{}', null, '{}', true)
$q$, 'do not have');
-- ولا يعدّل دورًا يحمله هو نفسه
select pg_temp.expect_error($q$
  insert into public.role_permissions (role_id, permission_code) values ((select v from ids where k = 'role_admin'), 'folio.manage')
$q$, 'your own access');

-- =============================================================================
-- الحدود المالية
-- =============================================================================
select pg_temp.act_as(null);
insert into ids select lower(code), id from public.charge_codes where hotel_id = (select v from ids where k = 'h') and code in ('MINIBAR', 'ROOM');
select pg_temp.act_as('00000000-0000-0000-0000-000000001703');
insert into ids select 'f1', public.open_folio((select v from ids where k = 'h'), 'نزيل الحدود');
insert into ids select 'c1', public.post_folio_charge((select v from ids where k = 'f1'), (select v from ids where k = 'room'), 400);
do $$ begin
  assert public.my_limits((select v from ids where k = 'h')) ->> 'max_allowance' is null, 'no limit by default';
end $$;
-- حد الدور 50
select pg_temp.act_as('00000000-0000-0000-0000-000000001701');
insert into public.role_settings (hotel_id, role_id, limits, home_path, quick_actions, dashboard_hidden)
values ((select v from ids where k = 'h'), (select v from ids where k = 'role_front'), '{"max_allowance": 50, "max_rate_discount_pct": 10}', '/front-desk', array['new_reservation', 'check_in'], array['profit']);
select pg_temp.act_as('00000000-0000-0000-0000-000000001703');
do $$ begin
  assert (public.my_limits((select v from ids where k = 'h')) ->> 'max_allowance')::numeric = 50, 'role limit applies';
  assert (public.my_interface((select v from ids where k = 'h')) ->> 'home_path') = '/front-desk', 'role home page';
  assert (public.my_interface((select v from ids where k = 'h')) -> 'quick_actions') ? 'check_in', 'role quick actions';
  assert (public.my_interface((select v from ids where k = 'h')) -> 'dashboard_hidden') ? 'profit', 'role hides dashboard sections';
end $$;
select pg_temp.expect_error($q$
  select public.post_folio_allowance((select v from ids where k = 'f1'), (select v from ids where k = 'c1'), 60, 'خصم كبير')
$q$, 'Approval required');
select public.post_folio_allowance((select v from ids where k = 'f1'), (select v from ids where k = 'c1'), 40, 'خصم ضمن الحد');
-- حد الموظف يتقدم على حد دوره
select pg_temp.act_as('00000000-0000-0000-0000-000000001701');
update public.hotel_members set limits = '{"max_allowance": 100}'
where hotel_id = (select v from ids where k = 'h') and user_id = '00000000-0000-0000-0000-000000001703';
select pg_temp.act_as('00000000-0000-0000-0000-000000001703');
select public.post_folio_allowance((select v from ids where k = 'f1'), (select v from ids where k = 'c1'), 60, 'خصم بحد الموظف');
-- المدير بلا حد
select pg_temp.act_as('00000000-0000-0000-0000-000000001701');
select public.post_folio_allowance((select v from ids where k = 'f1'), (select v from ids where k = 'c1'), 150, 'خصم المدير');

-- =============================================================================
-- طلبات الموافقة
-- =============================================================================
select pg_temp.act_as('00000000-0000-0000-0000-000000001703');
with r as (
  insert into public.approval_requests (hotel_id, kind, payload, summary, amount)
  values ((select v from ids where k = 'h'), 'folio_action', jsonb_build_object('folio_id', (select v from ids where k = 'f1')), 'خصم 120 على فوليو', 120)
  returning id)
insert into ids select 'req', id from r;
-- لا يُنشئ أحد طلبًا باسم غيره أو بحالة موافَق عليها
select pg_temp.expect_error($q$
  insert into public.approval_requests (hotel_id, kind, payload, summary, status)
  values ((select v from ids where k = 'h'), 'folio_action', '{}', 'تحايل', 'approved')
$q$, 'row-level security');
-- لا يوافق على طلبه، ولا يملك الموافقة أصلًا
select pg_temp.expect_error($q$ select public.decide_approval((select v from ids where k = 'req'), true) $q$, 'Permission denied');
-- موظف آخر لا يرى الطلب
select pg_temp.act_as('00000000-0000-0000-0000-000000001704');
do $$ begin
  assert (select count(*) from public.approval_requests) = 0, 'other staff cannot see requests';
end $$;
-- المدير يراه ويوافق، ثم يسجل النتيجة
select pg_temp.act_as('00000000-0000-0000-0000-000000001701');
do $$ begin
  assert (select count(*) from public.approval_requests where status = 'pending') = 1, 'manager sees pending request';
end $$;
select pg_temp.expect_error($q$ select public.finish_approval((select v from ids where k = 'req'), true) $q$, 'Only the approver');
select public.decide_approval((select v from ids where k = 'req'), true, 'موافق');
select pg_temp.expect_error($q$ select public.decide_approval((select v from ids where k = 'req'), false) $q$, 'already handled');
select public.finish_approval((select v from ids where k = 'req'), true, 'تم');
do $$ begin
  assert (select status from public.approval_requests where id = (select v from ids where k = 'req')) = 'executed', 'executed';
  assert (select decided_by from public.approval_requests where id = (select v from ids where k = 'req')) = '00000000-0000-0000-0000-000000001701', 'decided by manager';
end $$;
-- الموظف يسحب طلبه المعلّق فقط
select pg_temp.act_as('00000000-0000-0000-0000-000000001703');
with r as (
  insert into public.approval_requests (hotel_id, kind, payload, summary) values ((select v from ids where k = 'h'), 'reservation_cancel', '{}', 'إلغاء حجز')
  returning id)
insert into ids select 'req2', id from r;
select public.cancel_approval((select v from ids where k = 'req2'));
select pg_temp.expect_error($q$ select public.cancel_approval((select v from ids where k = 'req')) $q$, 'Only your own pending');

-- =============================================================================
-- تعطيل الحساب يقطع الوصول فورًا
-- =============================================================================
select pg_temp.act_as('00000000-0000-0000-0000-000000001701');
select public.set_member_access((select v from ids where k = 'h'), '00000000-0000-0000-0000-000000001704',
  array[(select id from public.roles where is_system and code = 'receptionist')], '{}', '{}', null, '{}', false);
select pg_temp.act_as('00000000-0000-0000-0000-000000001704');
do $$ begin
  assert not app.has_permission((select v from ids where k = 'h'), 'pms.reservations.view'), 'disabled user has no permissions';
  assert (select count(*) from public.my_permissions((select v from ids where k = 'h'))) = 0, 'disabled user permission list is empty';
end $$;
