-- =============================================================================
-- اختبارات تخصيص النظام: إطفاء قسم أو جزء يُسقط صلاحياته من كل موظفي الفندق، والأقسام لصاحب النظام فقط
-- =============================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\o /dev/null

-- إعدادات صاحب النظام تُحفظ وتُعاد كما كانت في آخر الاختبار
create temp table saved_settings as select * from app.system_settings where key in ('owner_user', 'owner_email', 'signup_mode');
delete from app.system_settings where key in ('owner_user', 'owner_email', 'signup_mode');

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000003901', 'gm39@hotel.test'),
  ('00000000-0000-0000-0000-000000003902', 'rc39@hotel.test'),
  ('00000000-0000-0000-0000-000000003903', 'owner39@hotel.test'),
  ('00000000-0000-0000-0000-000000003904', 'other39@hotel.test');

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
create or replace function pg_temp.check(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin if not coalesce(p_ok, false) then raise exception 'Check failed: %', p_msg; end if; end $$;

select pg_temp.act_as('00000000-0000-0000-0000-000000003901');
create temp table h39 as select public.create_hotel('فندق التخصيص', 'YE', 'YER') as id;
grant all on h39 to authenticated;
select public.add_hotel_member((select id from h39), 'rc39@hotel.test', array[(select id from public.roles where is_system and code = 'general_manager')]);

-- بلا صاحب نظام محدد: مدير الفندق يتحكم في الأقسام
do $$ begin
  perform pg_temp.check(public.can_manage_sections((select id from h39)), 'manager controls sections when no owner is set');
  perform pg_temp.check(app.has_permission((select id from h39), 'laundry.manage'), 'laundry on by default');
end $$;

-- إطفاء قسم المغسلة: تسقط صلاحيته من المدير ومن زميله
select public.save_hotel_sections((select id from h39), array['accounting', 'pms'], array['laundry'], array['laundry.manage']);
do $$ begin
  perform pg_temp.check(not app.has_permission((select id from h39), 'laundry.manage'), 'laundry permission gone');
  perform pg_temp.check(not exists (select 1 from public.my_permissions((select id from h39)) p where p = 'laundry.manage'), 'my_permissions drops laundry');
  perform pg_temp.check((select blocked_sections from public.hotels where id = (select id from h39)) = array['laundry'], 'blocked section stored');
end $$;
select pg_temp.act_as('00000000-0000-0000-0000-000000003902');
do $$ begin
  perform pg_temp.check(not app.has_permission((select id from h39), 'laundry.manage'), 'colleague loses laundry too');
  perform pg_temp.check(app.has_permission((select id from h39), 'pms.reservations.view'), 'other permissions untouched');
end $$;

-- إطفاء زر (إلغاء حركات الفوليو) ثم إعادته
select pg_temp.act_as('00000000-0000-0000-0000-000000003901');
select public.save_hotel_features((select id from h39), array['folio.void_button', 'customers.tax_number'], array['folio.void']);
do $$ begin
  perform pg_temp.check(not app.has_permission((select id from h39), 'folio.void'), 'button permission gone');
  perform pg_temp.check((select disabled_features from public.hotels where id = (select id from h39)) = array['customers.tax_number', 'folio.void_button'], 'features stored sorted');
end $$;
select public.save_hotel_features((select id from h39), array['customers.tax_number'], '{}');
do $$ begin
  perform pg_temp.check(app.has_permission((select id from h39), 'folio.void'), 'button back on');
end $$;

-- إدارة الفندق والمستخدمين لا تُطفأ حتى لو طُلب ذلك
select public.save_hotel_features((select id from h39), '{}', array['settings.hotel.manage', 'settings.users.manage', 'events.manage']);
do $$ begin
  perform pg_temp.check(app.has_permission((select id from h39), 'settings.hotel.manage'), 'hotel settings never turned off');
  perform pg_temp.check(app.has_permission((select id from h39), 'settings.users.manage'), 'user admin never turned off');
  perform pg_temp.check(not app.has_permission((select id from h39), 'events.manage'), 'other permission turned off');
end $$;
select pg_temp.act_as(null);
select pg_temp.expect_error($q$ update public.hotels set feature_permissions = array['settings.hotel.manage'] where id = (select id from h39) $q$, 'hotels_toggles_keep_admin');
select pg_temp.act_as('00000000-0000-0000-0000-000000003901');
select public.save_hotel_features((select id from h39), '{}', '{}');

-- فندق آخر لا يتحكم في هذا الفندق
select pg_temp.act_as('00000000-0000-0000-0000-000000003904');
select pg_temp.expect_error($q$ select public.save_hotel_features((select id from h39), array['x'], '{}') $q$, 'Permission denied');
select pg_temp.expect_error($q$ select public.save_hotel_sections((select id from h39), array['pms'], '{}', '{}') $q$, 'Permission denied');

-- بعد تحديد صاحب النظام: الأقسام له وحده، والمدير يبقى يتحكم في الأجزاء
select pg_temp.act_as(null);
insert into app.system_settings (key, value) values ('owner_email', 'owner39@hotel.test');
select pg_temp.act_as('00000000-0000-0000-0000-000000003901');
do $$ begin
  perform pg_temp.check(not public.can_manage_sections((select id from h39)), 'manager no longer controls sections');
end $$;
select pg_temp.expect_error($q$ select public.save_hotel_sections((select id from h39), array['accounting', 'pms'], '{}', '{}') $q$, 'Only the system owner');
select pg_temp.expect_error($q$ select public.set_hotel_modules((select id from h39), array['pms']) $q$, 'Only the system owner');
select pg_temp.expect_error($q$ update public.hotels set blocked_sections = '{}', section_permissions = '{}' where id = (select id from h39) $q$, 'Only the system owner');
select pg_temp.expect_error($q$ update public.hotels set enabled_modules = array['pms'] where id = (select id from h39) $q$, 'Only the system owner');
-- تعديل باقي إعدادات الفندق مباشرة لا يتأثر
update public.hotels set name_en = 'Toggle Hotel' where id = (select id from h39);
select public.save_hotel_features((select id from h39), array['reservations.notes'], '{}');
do $$ begin
  perform pg_temp.check(not app.has_permission((select id from h39), 'laundry.manage'), 'laundry still off');
end $$;

-- صاحب النظام يعيد المغسلة
select pg_temp.act_as('00000000-0000-0000-0000-000000003903');
select public.save_hotel_sections((select id from h39), array['accounting', 'pms'], '{}', '{}');
select pg_temp.expect_error($q$ select public.save_hotel_sections((select id from h39), '{}', '{}', '{}') $q$, 'At least one module');
select pg_temp.act_as('00000000-0000-0000-0000-000000003901');
do $$ begin
  perform pg_temp.check(app.has_permission((select id from h39), 'laundry.manage'), 'laundry back on for the manager');
  perform pg_temp.check((select name_en from public.hotels where id = (select id from h39)) = 'Toggle Hotel', 'direct settings update kept');
end $$;

select pg_temp.act_as(null);
delete from app.system_settings where key in ('owner_user', 'owner_email', 'signup_mode');
insert into app.system_settings select * from saved_settings;

\o
select 'feature toggle tests passed';
