-- =============================================================================
-- المصروفات المدفوعة مقدمًا: الإنشاء والتحقق، ترحيل الأقساط حتى اليوم مع اللحاق،
-- القسط الأخير يأخذ الباقي فيتطابق المجموع، الإيقاف، الحماية من الكتابة المباشرة، والصلاحيات
-- =============================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\o /dev/null

delete from app.system_settings where key = 'signup_mode';

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000004001', 'gm40@hotel.test'),
  ('00000000-0000-0000-0000-000000004002', 'aud40@hotel.test');

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

select pg_temp.act_as('00000000-0000-0000-0000-000000004001');
create temp table h40 as select public.create_hotel('فندق المقدم', 'SA', 'SAR') as id;
create temp table ids (k text primary key, v uuid);
grant all on h40, ids to authenticated;
create or replace function pg_temp.acc(p_code text) returns uuid language sql as $$
  select id from public.chart_of_accounts where hotel_id = (select id from h40) and code = p_code;
$$;
create or replace function pg_temp.net(p_code text) returns numeric language sql as $$
  select coalesce(sum(l.base_debit - l.base_credit), 0) from public.journal_entry_lines l join public.journal_entries j on j.id = l.journal_entry_id
  where j.hotel_id = (select id from h40) and j.status = 'posted' and l.account_id = pg_temp.acc(p_code);
$$;
select public.create_fiscal_year((select id from h40), (date_trunc('year', current_date) - interval '1 year')::date);
select public.add_hotel_member((select id from h40), 'aud40@hotel.test', array[(select id from public.roles where is_system and code = 'auditor')]);

-- مدخلات خاطئة: مبلغ، أشهر، حساب مصروف ليس مصروفًا
select pg_temp.expect_error($q$ select public.create_prepaid_expense((select id from h40), 'x', pg_temp.acc('5302'), null, 0, 3, current_date) $q$, 'Amount must be positive');
select pg_temp.expect_error($q$ select public.create_prepaid_expense((select id from h40), 'x', pg_temp.acc('5302'), null, 100, 0, current_date) $q$, 'Months must be between');
select pg_temp.expect_error($q$ select public.create_prepaid_expense((select id from h40), 'x', pg_temp.acc('1103'), null, 100, 3, current_date) $q$, 'is required');
-- لا كتابة مباشرة في الجدول
select pg_temp.expect_error($q$ insert into public.prepaid_expenses (hotel_id, name, prepaid_account_id, expense_account_id, total_amount, months, start_date)
  values ((select id from h40), 'x', pg_temp.acc('1130'), pg_temp.acc('5302'), 1, 1, current_date) $q$, 'maintained by the system');

-- تأمين 1000 على 3 أشهر بدأ قبل 4 أشهر: ثلاثة أقساط 333.33 + 333.33 + 333.34
insert into ids select 'ins', public.create_prepaid_expense((select id from h40), 'تأمين المبنى', pg_temp.acc('5302'), null, 1000, 3,
  (date_trunc('month', current_date) - interval '4 month')::date);
select pg_temp.check((select prepaid_account_id = pg_temp.acc('1130') from public.prepaid_expenses where id = (select v from ids where k = 'ins')), 'default prepaid account');
-- إيجار 12000 على 12 شهرًا بدأ الشهر الماضي: قسط واحد حتى الآن (آخر الشهر الماضي)
insert into ids select 'rent', public.create_prepaid_expense((select id from h40), 'إيجار المستودع', pg_temp.acc('5301'), null, 12000, 12,
  (date_trunc('month', current_date) - interval '1 month')::date);

-- المدقق يقرأ ولا يرحّل
select pg_temp.act_as('00000000-0000-0000-0000-000000004002');
select pg_temp.check((select count(*) from public.prepaid_expenses where hotel_id = (select id from h40)) = 2, 'auditor reads schedules');
select pg_temp.expect_error($q$ select public.post_due_prepaid_expenses((select id from h40)) $q$, 'Permission denied');
select pg_temp.act_as('00000000-0000-0000-0000-000000004001');

select pg_temp.check(public.post_due_prepaid_expenses((select id from h40)) = 4, 'four installments posted');
select pg_temp.check(public.post_due_prepaid_expenses((select id from h40)) = 0, 'second run posts nothing');
select pg_temp.check((select status = 'completed' and posted_months = 3 and amortized_amount = 1000 from public.prepaid_expenses where id = (select v from ids where k = 'ins')), 'insurance completed exactly');
select pg_temp.check((select array_agg(l.debit order by j.entry_date) from public.journal_entry_lines l join public.journal_entries j on j.id = l.journal_entry_id
  where j.source = 'prepaid' and j.source_id = (select v from ids where k = 'ins') and l.debit > 0) = array[333.33, 333.33, 333.34]::numeric[], 'last installment takes the remainder');
select pg_temp.check((select bool_and(j.entry_date = (date_trunc('month', j.entry_date) + interval '1 month' - interval '1 day')::date)
  from public.journal_entries j where j.source = 'prepaid' and j.hotel_id = (select id from h40)), 'posted on month end');
select pg_temp.check(pg_temp.net('5302') = 1000 and pg_temp.net('5301') = 1000 and pg_temp.net('1130') = -2000, 'ledger: expenses 2000 out of prepaid');
select pg_temp.check((select status = 'active' and posted_months = 1 and amortized_amount = 1000 from public.prepaid_expenses where id = (select v from ids where k = 'rent')), 'rent one month');

-- الإيقاف: لا يُرحّل بعده، ولا يُوقف مرتين
select public.stop_prepaid_expense((select v from ids where k = 'rent'));
select pg_temp.check((select status from public.prepaid_expenses where id = (select v from ids where k = 'rent')) = 'stopped', 'stopped');
select pg_temp.expect_error($q$ select public.stop_prepaid_expense((select v from ids where k = 'rent')) $q$, 'not active');
select pg_temp.check(public.post_due_prepaid_expenses((select id from h40)) = 0, 'stopped posts nothing');

select pg_temp.act_as(null);
\o
select 'ok 40_prepaid_expenses';
