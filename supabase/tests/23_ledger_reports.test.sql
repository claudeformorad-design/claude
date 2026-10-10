-- =============================================================================
-- اختبارات تقارير الأستاذ: كشف الحساب (تفصيلي وإجمالي ومركز تكلفة)، الحركة الشهرية،
-- يومية المجاميع، والأرقام المفقودة، مع الصلاحيات وعزل الفنادق
-- =============================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\o /dev/null

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000002301', 'gm23@hotel.test'),
  ('00000000-0000-0000-0000-000000002302', 'hk23@hotel.test'),
  ('00000000-0000-0000-0000-000000002303', 'gm23b@hotel.test');

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

select pg_temp.act_as('00000000-0000-0000-0000-000000002301');
create temp table h23 as select public.create_hotel('فندق الأستاذ', 'SA', 'SAR') as id;
grant all on h23 to authenticated;
create or replace function pg_temp.acc(p_code text) returns uuid language sql as $$
  select id from public.chart_of_accounts where hotel_id = (select id from h23) and code = p_code;
$$;
create or replace function pg_temp.dept(p_code text) returns uuid language sql as $$
  select id from public.departments where hotel_id = (select id from h23) and code = p_code;
$$;
create temp table cash23 as select pg_temp.acc('1101') as id;
grant all on cash23 to authenticated;
select public.add_hotel_member((select id from h23), 'hk23@hotel.test',
  array[(select id from public.roles where is_system and code = 'housekeeping')]);

-- ثلاثة قيود: قبل الفترة، وداخلها في شهرين، مع مركز تكلفة
select public.save_journal_entry((select id from h23), (date_trunc('year', current_date))::date, 'رأس المال',
  jsonb_build_array(jsonb_build_object('account_id', pg_temp.acc('1101'), 'debit', 1000),
                    jsonb_build_object('account_id', pg_temp.acc('3101'), 'credit', 1000)), null, null, 1, null, true);
select public.save_journal_entry((select id from h23), (date_trunc('year', current_date) + interval '1 month')::date, 'كهرباء',
  jsonb_build_array(jsonb_build_object('account_id', pg_temp.acc('5204'), 'debit', 200, 'department_id', pg_temp.dept('ROOMS')),
                    jsonb_build_object('account_id', pg_temp.acc('1101'), 'credit', 200)), null, null, 1, null, true);
select public.save_journal_entry((select id from h23), (date_trunc('year', current_date) + interval '2 month')::date, 'مياه',
  jsonb_build_array(jsonb_build_object('account_id', pg_temp.acc('5205'), 'debit', 50, 'department_id', pg_temp.dept('ROOMS')),
                    jsonb_build_object('account_id', pg_temp.acc('1101'), 'credit', 50)), null, null, 1, null, true);

create temp table r as select (date_trunc('year', current_date) + interval '1 month')::date as f, (date_trunc('year', current_date) + interval '3 month')::date as t;
grant all on r to authenticated;

-- كشف الصندوق: افتتاحي 1000 مدين، ثم سطران دائنان 200 و50
create temp table st as select * from public.account_statement((select id from h23), pg_temp.acc('1101'), null, (select f from r), (select t from r));
grant all on st to authenticated;
select pg_temp.check((select debit from st where is_opening) = 1000, 'opening debit 1000');
select pg_temp.check((select count(*) from st where not is_opening) = 2, 'two lines in period');
select pg_temp.check((select sum(credit) from st where not is_opening) = 250, 'period credits 250');

-- كشف إجمالي للحساب الرئيسي 5 (كل المصروفات) يجمع الفروع
select pg_temp.check((select sum(debit) from public.account_statement((select id from h23),
  (select id from public.chart_of_accounts where hotel_id = (select id from h23) and code = '5'), null, (select f from r), (select t from r)) where not is_opening) = 250,
  'parent account statement includes children');

-- كشف مركز التكلفة وحده
select pg_temp.check((select count(*) from public.account_statement((select id from h23), null, pg_temp.dept('ROOMS'), (select f from r), (select t from r)) where not is_opening) = 2,
  'cost center statement');

-- مدخلات خاطئة
select pg_temp.expect_error($q$ select * from public.account_statement((select id from h23), null, null, current_date, current_date) $q$, 'Choose an account');
select pg_temp.expect_error($q$ select * from public.account_statement((select id from h23), pg_temp.acc('1101'), null, current_date, current_date - 1) $q$, 'Invalid date range');

-- الحركة الشهرية ويومية المجاميع
select pg_temp.check((select count(*) from public.monthly_account_movement((select id from h23), (select f from r), (select t from r)) where account_id = pg_temp.acc('1101')) = 2,
  'cash moved in two months');
select pg_temp.check((select sum(debit) from public.daily_journal_totals((select id from h23), (select f from r), (select t from r))) = 250, 'daily totals');

-- لا فجوات في التسلسل؛ ثم فجوة مصطنعة بحذف قيد مرحّل مباشرة (بصلاحية النظام)
select pg_temp.check((select count(*) from public.document_number_gaps((select id from h23))) = 0, 'no gaps');
select pg_temp.act_as(null);
alter table public.journal_entries disable trigger user;
alter table public.journal_entry_lines disable trigger user;
delete from public.journal_entry_lines where journal_entry_id = (select id from public.journal_entries where hotel_id = (select id from h23) and description = 'كهرباء');
delete from public.journal_entries where hotel_id = (select id from h23) and description = 'كهرباء';
alter table public.journal_entries enable trigger user;
alter table public.journal_entry_lines enable trigger user;
select pg_temp.act_as('00000000-0000-0000-0000-000000002301');
select pg_temp.check((select count(*) from public.document_number_gaps((select id from h23)) where doc_type = 'journal_entry' and missing_from = 2 and missing_to = 2) = 1,
  'gap detected at number 2');

-- مشرف التدبير بلا صلاحية القيود لا يرى الكشف
select pg_temp.act_as('00000000-0000-0000-0000-000000002302');
select pg_temp.expect_error($q$ select * from public.account_statement((select id from h23), pg_temp.acc('1101'), null, current_date, current_date) $q$, 'Permission denied');
select pg_temp.expect_error($q$ select * from public.document_number_gaps((select id from h23)) $q$, 'Permission denied');

-- مدير فندق آخر لا يرى حسابات هذا الفندق
select pg_temp.act_as('00000000-0000-0000-0000-000000002303');
create temp table h23b as select public.create_hotel('فندق آخر', 'SA', 'SAR') as id;
select pg_temp.expect_error($q$ select * from public.account_statement((select id from h23), pg_temp.acc('1101'), null, current_date, current_date) $q$, 'Permission denied');
select pg_temp.expect_error($q$ select * from public.account_statement((select id from h23b), (select id from cash23), null, current_date, current_date) $q$, 'Account not found');

select pg_temp.act_as(null);
\o
select 'ledger reports tests passed';
