-- =============================================================================
-- اختبارات الموازنة التقديرية: الحفظ والتعديل والحذف، التحقق من الحساب وعدد الفترات،
-- الموازنة مقابل الفعلي حتى فترة وللقسم، والصلاحيات
-- =============================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\o /dev/null

-- الاختبارات السابقة قد تترك التسجيل بالدعوة فقط؛ مستخدمو الاختبار يُضافون مباشرة
delete from app.system_settings where key = 'signup_mode';

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000002901', 'gm29@hotel.test'),
  ('00000000-0000-0000-0000-000000002902', 'hk29@hotel.test');

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

select pg_temp.act_as('00000000-0000-0000-0000-000000002901');
create temp table h29 as select public.create_hotel('فندق الموازنة', 'SA', 'SAR') as id;
create temp table ids (k text primary key, v uuid);
grant all on h29, ids to authenticated;
insert into ids select 'fy', id from public.fiscal_years where hotel_id = (select id from h29) and current_date between start_date and end_date;
insert into ids select 'a_' || code, id from public.chart_of_accounts where hotel_id = (select id from h29) and code in ('1101', '3101', '4201', '5204', '5205');
insert into ids select 'rooms', id from public.departments where hotel_id = (select id from h29) and code = 'ROOMS';
select public.add_hotel_member((select id from h29), 'hk29@hotel.test', array[(select id from public.roles where is_system and code = 'housekeeping')]);

create or replace function pg_temp.v(p_k text) returns uuid language sql as $$ select v from ids where k = p_k $$;
create or replace function pg_temp.months(p_amount numeric) returns numeric[] language sql as $$ select array_fill(p_amount, array[12]) $$;

select pg_temp.check((select count(*) from public.accounting_periods where fiscal_year_id = pg_temp.v('fy')) = 12, 'twelve periods');

-- التحقق
select pg_temp.expect_error($q$ select public.save_budget((select id from h29), pg_temp.v('fy'), pg_temp.v('a_1101'), null, pg_temp.months(10)) $q$, 'revenue and expense');
select pg_temp.expect_error($q$ select public.save_budget((select id from h29), pg_temp.v('fy'), pg_temp.v('a_5204'), null, array[1, 2, 3]::numeric[]) $q$, 'each of the 12 periods');
select pg_temp.expect_error($q$ select public.save_budget((select id from h29), pg_temp.v('fy'), pg_temp.v('a_5204'), null, pg_temp.months(-1)) $q$, 'zero or more');
select pg_temp.expect_error($q$ select public.save_budget((select id from h29), pg_temp.v('fy'), pg_temp.v('a_5204'), null, pg_temp.months(1.234)) $q$, 'zero or more');

-- كهرباء قسم الغرف 100 شهريًا، وإيراد متنوع 500 شهريًا
select public.save_budget((select id from h29), pg_temp.v('fy'), pg_temp.v('a_5204'), pg_temp.v('rooms'), pg_temp.months(90));
select public.save_budget((select id from h29), pg_temp.v('fy'), pg_temp.v('a_5204'), pg_temp.v('rooms'), pg_temp.months(100));
select public.save_budget((select id from h29), pg_temp.v('fy'), pg_temp.v('a_4201'), null, pg_temp.months(500));
select pg_temp.check((select count(*) from public.budgets where hotel_id = (select id from h29)) = 2, 'saving again updates the same line');
-- مياه ثم تصفيرها يحذفها
select public.save_budget((select id from h29), pg_temp.v('fy'), pg_temp.v('a_5205'), null, pg_temp.months(30));
select public.save_budget((select id from h29), pg_temp.v('fy'), pg_temp.v('a_5205'), null, pg_temp.months(0));
select pg_temp.check((select count(*) from public.budgets where hotel_id = (select id from h29)) = 2, 'all zero removes the line');

-- الفعلي: كهرباء 150 في الفترة 1 للغرف، وإيراد 700 في الفترة 2
select public.save_journal_entry((select id from h29), (select start_date from public.fiscal_years where id = pg_temp.v('fy')), 'كهرباء',
  jsonb_build_array(jsonb_build_object('account_id', pg_temp.v('a_5204'), 'debit', 150, 'department_id', pg_temp.v('rooms')),
                    jsonb_build_object('account_id', pg_temp.v('a_1101'), 'credit', 150)), null, null, 1, null, true);
select public.save_journal_entry((select id from h29), (select start_date + 40 from public.fiscal_years where id = pg_temp.v('fy')), 'إيراد متنوع',
  jsonb_build_array(jsonb_build_object('account_id', pg_temp.v('a_1101'), 'debit', 700),
                    jsonb_build_object('account_id', pg_temp.v('a_4201'), 'credit', 700)), null, null, 1, null, true);

create temp table bva as select * from public.budget_vs_actual((select id from h29), pg_temp.v('fy'), 2);
grant all on bva to authenticated;
select pg_temp.check((select budget from bva where code = '5204') = 200, 'two periods of electricity budget');
select pg_temp.check((select actual from bva where code = '5204') = 150, 'electricity actual');
select pg_temp.check((select variance from bva where code = '5204') = 50, 'expense under budget is favorable');
select pg_temp.check((select budget from bva where code = '4201') = 1000 and (select actual from bva where code = '4201') = 700, 'revenue budget and actual');
select pg_temp.check((select variance from bva where code = '4201') = -300, 'revenue short of budget is unfavorable');
select pg_temp.check((select code from public.budget_vs_actual((select id from h29), pg_temp.v('fy'), 2) limit 1) = '4201', 'revenue listed first');
-- حتى الفترة 1 فقط
select pg_temp.check((select actual from public.budget_vs_actual((select id from h29), pg_temp.v('fy'), 1) where code = '4201') = 0, 'period 2 revenue excluded');
-- قسم الغرف: لا إيراد متنوع عليه
select pg_temp.check((select count(*) from public.budget_vs_actual((select id from h29), pg_temp.v('fy'), null, pg_temp.v('rooms'))) = 1, 'department filter');
select pg_temp.check((select budget from public.budget_vs_actual((select id from h29), pg_temp.v('fy'), null, pg_temp.v('rooms'))) = 1200, 'full year');

-- الصلاحيات والكتابة المباشرة
select pg_temp.act_as('00000000-0000-0000-0000-000000002902');
select pg_temp.expect_error($q$ select public.save_budget((select id from h29), (select v from ids where k = 'fy'), (select v from ids where k = 'a_5204'), null, array_fill(1::numeric, array[12])) $q$, 'Permission denied');
select pg_temp.expect_error($q$ select * from public.budget_vs_actual((select id from h29), (select v from ids where k = 'fy')) $q$, 'Permission denied');
select pg_temp.check((select count(*) from public.budgets where hotel_id = (select id from h29)) = 0, 'housekeeping cannot read budgets');
select pg_temp.act_as('00000000-0000-0000-0000-000000002901');
update public.budgets set amounts = array_fill(1::numeric, array[12]) where hotel_id = (select id from h29);
delete from public.budgets where hotel_id = (select id from h29);
select pg_temp.check((select sum(amounts[1]) from public.budgets where hotel_id = (select id from h29)) = 600, 'direct writes have no effect');

select pg_temp.act_as(null);
\o
select 'budgets tests passed';
