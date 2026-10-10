-- =============================================================================
-- اختبارات نصوص رسائل واتساب: الحفظ والتعديل والعودة للافتراضي والصلاحيات وعزل الفنادق
-- =============================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\o /dev/null

delete from app.system_settings where key = 'signup_mode';

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000003501', 'gm35@hotel.test'),
  ('00000000-0000-0000-0000-000000003502', 'desk35@hotel.test'),
  ('00000000-0000-0000-0000-000000003503', 'other35@hotel.test');

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

select pg_temp.act_as('00000000-0000-0000-0000-000000003501');
create temp table h35 as select public.create_hotel('فندق الرسائل', 'YE', 'YER') as id;
grant all on h35 to authenticated;
select public.add_hotel_member((select id from h35), 'desk35@hotel.test', array[(select id from public.roles where is_system and code = 'receptionist')]);

select public.save_message_template((select id from h35), 'arrival_reminder', '  أهلًا {guest}، ننتظرك يوم {arrival}  ');
select pg_temp.check((select body from public.message_templates where hotel_id = (select id from h35) and key = 'arrival_reminder') = 'أهلًا {guest}، ننتظرك يوم {arrival}', 'saved trimmed');
select public.save_message_template((select id from h35), 'arrival_reminder', 'نص ثانٍ');
select pg_temp.check((select count(*) from public.message_templates where hotel_id = (select id from h35)) = 1, 'updated in place');
select pg_temp.check((select body from public.message_templates where hotel_id = (select id from h35)) = 'نص ثانٍ', 'updated body');
select pg_temp.expect_error($q$ select public.save_message_template((select id from h35), 'spam', 'x') $q$, 'Unknown message template');
select pg_temp.expect_error($q$ select public.save_message_template((select id from h35), 'arrival_reminder', repeat('ي', 2001)) $q$, 'longer than 2000');
-- نص فارغ يعيد الافتراضي
select public.save_message_template((select id from h35), 'arrival_reminder', '   ');
select pg_temp.check(not exists (select 1 from public.message_templates where hotel_id = (select id from h35)), 'reset to default');
select public.save_message_template((select id from h35), 'payment_receipt', 'استلمنا {amount}');

-- موظف الاستقبال يقرأ ولا يعدّل
select pg_temp.act_as('00000000-0000-0000-0000-000000003502');
select pg_temp.check((select count(*) from public.message_templates) = 1, 'member reads');
select pg_temp.expect_error($q$ select public.save_message_template((select id from h35), 'payment_receipt', 'x') $q$, 'Permission denied');
update public.message_templates set body = 'اختراق';
select pg_temp.check((select body from public.message_templates) = 'استلمنا {amount}', 'no direct writes');

-- مستخدم من فندق آخر لا يرى شيئًا
select pg_temp.act_as('00000000-0000-0000-0000-000000003503');
select public.create_hotel('فندق آخر', 'YE', 'YER');
select pg_temp.check((select count(*) from public.message_templates) = 0, 'isolated by hotel');
select pg_temp.expect_error($q$ select public.save_message_template((select id from h35), 'payment_receipt', 'x') $q$, 'Permission denied');

\o
select 'message templates tests passed';
