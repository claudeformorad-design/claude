-- =============================================================================
-- اختبارات الموارد البشرية: الإعدادات الافتراضية، رمز الموظف، الحضور (التأخير والإضافي والوردية الليلية)،
-- الإجازات (أيام العمل والتداخل والرصيد)، السلفة وقيدها، المسيّر المحسوب وقيده، مخصص نهاية الخدمة،
-- التسوية النهائية، وحماية البيانات من غير المصرّح لهم
-- =============================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\o /dev/null

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000001601', 'gm16@hotel.test'),
  ('00000000-0000-0000-0000-000000001602', 'acc16@hotel.test');

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
create or replace function pg_temp.check(p_ok boolean, p_what text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'Check failed: %', p_what; end if;
end $$;
create or replace function pg_temp.gl(p_hotel uuid, p_key text) returns numeric language sql as $$
  select coalesce(sum(l.debit - l.credit), 0) from public.journal_entry_lines l
  join public.journal_entries j on j.id = l.journal_entry_id and j.status = 'posted'
  join public.chart_of_accounts a on a.id = l.account_id
  where l.hotel_id = p_hotel and a.system_key = p_key;
$$;

select pg_temp.act_as('00000000-0000-0000-0000-000000001601');
create temp table h16 as select public.create_hotel('فندق الموظفين', 'SA', 'SAR') as id;
create temp table ids (k text primary key, v uuid);
grant all on h16, ids to authenticated;

-- الإعدادات الافتراضية تُنشأ مع الفندق
select pg_temp.check((select count(*) = 1 from public.hr_settings), 'settings seeded');
select pg_temp.check((select count(*) = 4 from public.hr_leave_types), 'leave types seeded');
select pg_temp.check((select count(*) = 3 from public.hr_pay_components), 'pay components seeded');
select pg_temp.check((select count(*) = 3 from public.hr_shifts), 'shifts seeded');

update public.hr_settings set insurance_employee_pct = 10, insurance_employer_pct = 12;
update public.hr_pay_components set default_value = 25 where name = 'بدل السكن';
insert into ids select 'dept', id from public.departments where hotel_id = (select id from h16) and code = 'ADMIN';
insert into ids select 'morning', id from public.hr_shifts where name = 'الوردية الصباحية';
insert into ids select 'night', id from public.hr_shifts where name = 'الوردية الليلية';
insert into ids select 'annual', id from public.hr_leave_types where name = 'الإجازة السنوية';
insert into ids select 'unpaid', id from public.hr_leave_types where name = 'إجازة بدون راتب';
insert into ids select 'transport', id from public.hr_pay_components where name = 'بدل النقل';
insert into ids select 'cash', id from public.payment_methods where hotel_id = (select id from h16) and code = 'CASH';

-- الموظفون: الرمز يُولَّد تلقائيًا
insert into public.hr_employees (hotel_id, full_name, department_id, hire_date, basic_salary, shift_id, id_expiry)
select id, 'أحمد القديم', (select v from ids where k = 'dept'), '2020-01-01', 3000, (select v from ids where k = 'morning'), '2026-10-10' from h16;
insert into public.hr_employees (hotel_id, full_name, department_id, hire_date, basic_salary)
select id, 'سالم الجديد', (select v from ids where k = 'dept'), '2026-09-16', 3000 from h16;
insert into ids select 'a', id from public.hr_employees where full_name = 'أحمد القديم';
insert into ids select 'b', id from public.hr_employees where full_name = 'سالم الجديد';
select pg_temp.check((select string_agg(code, ',' order by code) = 'E0001,E0002' from public.hr_employees), 'auto codes');
select public.hr_save_employee_components((select v from ids where k = 'a'),
  jsonb_build_array(jsonb_build_object('component_id', (select v from ids where k = 'transport'), 'value', '200')));

-- إنهاء الخدمة لا يتم بتعديل مباشر
select pg_temp.expect_error(format($q$update public.hr_employees set status = 'terminated', termination_date = '2026-09-01', termination_reason = 'termination' where id = %L$q$,
  (select v from ids where k = 'a')), 'final settlement');

-- الحضور: الوردية الصباحية 07:00 إلى 15:00، ووردية ليلية تعبر منتصف الليل
select public.hr_save_attendance((select id from h16), '2026-09-01', jsonb_build_array(
  jsonb_build_object('employee_id', (select v from ids where k = 'a'), 'status', 'present', 'check_in', '07:40', 'check_out', '17:00'),
  jsonb_build_object('employee_id', (select v from ids where k = 'b'), 'status', 'present', 'check_in', '', 'check_out', '')));
select pg_temp.check((select count(*) = 1 from public.hr_attendance where work_date = '2026-09-01'), 'ordinary day is not stored');
insert into public.hr_attendance (hotel_id, employee_id, work_date, status)
select id, (select v from ids where k = 'a'), '2026-09-02', 'absent' from h16;
select public.hr_save_roster((select id from h16), jsonb_build_array(
  jsonb_build_object('employee_id', (select v from ids where k = 'b'), 'work_date', '2026-09-20', 'shift', (select v from ids where k = 'night')),
  jsonb_build_object('employee_id', (select v from ids where k = 'b'), 'work_date', '2026-09-21', 'shift', 'off')));
select pg_temp.check((select count(*) = 2 and count(shift_id) = 1 from public.hr_roster), 'roster saved with a day off');
insert into public.hr_attendance (hotel_id, employee_id, work_date, status, check_in, check_out)
select id, (select v from ids where k = 'b'), '2026-09-20', 'present', '23:10', '07:30' from h16;
select pg_temp.check((select late_minutes = 40 and worked_minutes = 560 and overtime_minutes = 80 from public.hr_attendance
  where employee_id = (select v from ids where k = 'a') and work_date = '2026-09-01'), 'day shift late and overtime');
select pg_temp.check((select late_minutes = 10 and worked_minutes = 500 and overtime_minutes = 20 from public.hr_attendance
  where employee_id = (select v from ids where k = 'b')), 'night shift across midnight');

-- الإجازات: الأيام بلا الجمعة، ومنع التداخل، والرصيد
insert into public.hr_leaves (hotel_id, employee_id, leave_type_id, start_date, end_date, status)
select id, (select v from ids where k = 'a'), (select v from ids where k = 'annual'), '2026-09-06', '2026-09-12', 'approved' from h16;
select pg_temp.check((select days = 6 from public.hr_leaves where start_date = '2026-09-06'), 'working days exclude Friday');
select pg_temp.expect_error(format($q$insert into public.hr_leaves (hotel_id, employee_id, leave_type_id, start_date, end_date)
  values (%L, %L, %L, '2026-09-10', '2026-09-13')$q$, (select id from h16), (select v from ids where k = 'a'), (select v from ids where k = 'annual')), 'overlaps');
select pg_temp.expect_error(format($q$insert into public.hr_leaves (hotel_id, employee_id, leave_type_id, start_date, end_date, status)
  values (%L, %L, %L, '2026-10-01', '2026-12-31', 'approved')$q$, (select id from h16), (select v from ids where k = 'a'), (select v from ids where k = 'annual')), 'balance is not enough');
insert into public.hr_leaves (hotel_id, employee_id, leave_type_id, start_date, end_date, status)
select id, (select v from ids where k = 'a'), (select v from ids where k = 'unpaid'), '2026-09-14', '2026-09-15', 'approved' from h16;
-- الرصيد: 21 للسنة و21 مرحّلة من 2025، والمأخوذ 6
select pg_temp.check((select entitlement = 21 and carried = 21 and taken = 6 and remaining = 36
  from public.hr_leave_balances((select v from ids where k = 'a'), 2026) where leave_type_id = (select v from ids where k = 'annual')), 'annual balance');

-- الجزاءات: المعتمد فقط يُخصم
insert into public.hr_penalties (hotel_id, employee_id, penalty_date, amount, reason, status)
select id, (select v from ids where k = 'a'), '2026-09-10', 100, 'تأخير متكرر', 'approved' from h16;
insert into public.hr_penalties (hotel_id, employee_id, penalty_date, amount, reason)
select id, (select v from ids where k = 'a'), '2026-09-11', 50, 'مخالفة معلّقة' from h16;

-- السلفة: قيد مدين سلف الموظفين ودائن الصندوق، وتُستعاد على 3 أقساط
insert into ids select 'adv', public.hr_pay_advance((select v from ids where k = 'a'), '2026-09-05', 1200, 3, (select v from ids where k = 'cash'), 'سلفة شخصية');
select pg_temp.act_as(null);
select pg_temp.check(pg_temp.gl((select id from h16), 'employee_advances') = 1200, 'advance debited');
select pg_temp.check(app.is_control_account((select id from public.chart_of_accounts where hotel_id = (select id from h16) and system_key = 'employee_advances')), 'advances is a control account');
select pg_temp.act_as('00000000-0000-0000-0000-000000001601');

-- المسيّر المحسوب لشهر سبتمبر
create temp table pv as select jsonb_array_elements(public.hr_payroll_preview((select id from h16), '2026-09-01')) as l;
grant all on pv to authenticated;
select pg_temp.check((select count(*) = 2 from pv), 'two employees');
-- أحمد: أساسي 3000، بدلات 750 سكن و200 نقل، إضافي 80 دقيقة بمعدل 1.5،
-- خصم غياب يوم 131.67 وتأخير 25 دقيقة بعد السماح 5.21 وإجازة بدون راتب يومان 263.33 وجزاء 100،
-- تأمين الموظف 10٪ من 3750 والمنشأة 12٪، وقسط سلفة 400
select pg_temp.check((select (l ->> 'basic')::numeric = 3000 and (l ->> 'allowances')::numeric = 950 and (l ->> 'overtime')::numeric = 25
  and (l ->> 'deductions')::numeric = 500.21 and (l ->> 'insurance_employee')::numeric = 375 and (l ->> 'insurance_employer')::numeric = 450
  and (l ->> 'advance_recovery')::numeric = 400
  from pv where l ->> 'employee_code' = 'E0001'), 'employee A payroll line');
-- سالم: التحق في منتصف الشهر فيأخذ 15 يومًا من 30، وتأخيره 10 دقائق ضمن السماح
select pg_temp.check((select (l ->> 'basic')::numeric = 1500 and (l ->> 'allowances')::numeric = 375 and (l ->> 'overtime')::numeric = 6.25
  and (l ->> 'deductions')::numeric = 0 and (l ->> 'insurance_employee')::numeric = 187.5
  from pv where l ->> 'employee_code' = 'E0002'), 'employee B prorated line');

select public.hr_run_payroll((select id from h16), '2026-09-01');
select pg_temp.expect_error(format($q$select public.hr_run_payroll(%L, '2026-09-01')$q$, (select id from h16)), 'already posted');

select pg_temp.act_as(null);
select pg_temp.check((select net_pay = 2699.79 from public.payroll_lines where hotel_id = (select id from h16) and employee_code = 'E0001'), 'net pay A');
select pg_temp.check((select from_hr and total_net = (select sum(net_pay) from public.payroll_lines where hotel_id = (select id from h16)) from public.payroll_runs where hotel_id = (select id from h16)), 'run totals');
select pg_temp.check(pg_temp.gl((select id from h16), 'accrued_salaries') = -(select sum(net_pay) from public.payroll_lines where hotel_id = (select id from h16)), 'net pay accrued');
select pg_temp.check(pg_temp.gl((select id from h16), 'employee_advances') = 800, 'installment recovered in GL');
select pg_temp.check((select recovered = 400 and status = 'open' from public.hr_advances where hotel_id = (select id from h16)), 'advance recovered');
select pg_temp.check((select count(*) = 1 from public.hr_penalties where hotel_id = (select id from h16) and payroll_run_id is not null and amount = 100), 'approved penalty applied');
select pg_temp.check((select count(*) = 1 from public.hr_penalties where hotel_id = (select id from h16) and payroll_run_id is null and amount = 50), 'pending penalty left');
-- مخصص نهاية الخدمة يساوي مستحق الموظفين النشطين
select pg_temp.check(-pg_temp.gl((select id from h16), 'eos_provision') = (
  select sum((app.hr_eos(id, '2026-09-30', 'termination') ->> 'amount')::numeric) from public.hr_employees where hotel_id = (select id from h16)), 'eos provision trued up');
-- خمس سنوات بنصف شهر عن كل سنة، ثم شهر كامل عن كل سنة بعدها، على أجر 3950 يشمل بدلي السكن والنقل
select pg_temp.check((select round((least(y, 5) * 15 / 30 + greatest(y - 5, 0)) * 3950, 2) = (q ->> 'full')::numeric
  from (select app.hr_eos((select v from ids where k = 'a'), '2026-09-30', 'termination') as q,
               ('2026-09-30'::date - '2020-01-01'::date + 1)::numeric / 365 as y) t), 'eos tiers');
select pg_temp.check((app.hr_eos((select v from ids where k = 'a'), '2026-09-30', 'resignation') ->> 'pct')::numeric = 66.67, 'resignation share after 5 years');

-- التسوية النهائية بالاستقالة: المكافأة بنسبتها، وتعويض رصيد الإجازة، وخصم السلفة المتبقية
select pg_temp.act_as('00000000-0000-0000-0000-000000001601');
create temp table q as select public.hr_settlement_quote((select v from ids where k = 'a'), '2026-10-15', 'resignation') as q;
grant all on q to authenticated;
select public.hr_terminate((select v from ids where k = 'a'), '2026-10-15', 'resignation', 'استقالة');
select pg_temp.act_as(null);
select pg_temp.check((select status = 'terminated' and termination_reason = 'resignation' from public.hr_employees where id = (select v from ids where k = 'a')), 'employee terminated');
select pg_temp.check((select (q ->> 'leave_days')::numeric = 36 and (q ->> 'advances_recovered')::numeric = 800
  and (q ->> 'net')::numeric = (q ->> 'amount')::numeric + (q ->> 'leave_amount')::numeric - 800 from q), 'settlement quote');
select pg_temp.check((select net_amount = (select (q ->> 'net')::numeric from q) from public.hr_settlements where hotel_id = (select id from h16)), 'settlement stored');
select pg_temp.check(pg_temp.gl((select id from h16), 'employee_advances') = 0 and (select bool_and(status = 'closed') from public.hr_advances where hotel_id = (select id from h16)), 'advances closed');
select pg_temp.check((select count(*) = 0 from public.hr_leaves where hotel_id = (select id from h16) and status = 'pending'), 'pending leaves cancelled');

select pg_temp.act_as('00000000-0000-0000-0000-000000001601');
select pg_temp.expect_error(format($q$insert into public.hr_leaves (hotel_id, employee_id, leave_type_id, start_date, end_date)
  values (%L, %L, %L, '2026-11-01', '2026-11-02')$q$, (select id from h16), (select v from ids where k = 'a'), (select v from ids where k = 'annual')), 'not active');
select pg_temp.expect_error(format($q$select public.hr_pay_advance(%L, '2026-11-01', 100, 1, %L)$q$,
  (select v from ids where k = 'a'), (select v from ids where k = 'cash')), 'not active');

-- المحاسب بلا صلاحية الموارد البشرية لا يرى الرواتب ولا يضيف موظفين
select pg_temp.act_as(null);
insert into public.hotel_members (hotel_id, user_id) select id, '00000000-0000-0000-0000-000000001602' from h16;
insert into public.user_hotel_roles (hotel_id, user_id, role_id)
select (select id from h16), '00000000-0000-0000-0000-000000001602', id from public.roles where is_system and code = 'accountant';
select pg_temp.act_as('00000000-0000-0000-0000-000000001602');
select pg_temp.check((select count(*) = 0 from public.hr_employees), 'accountant sees no employees');
select pg_temp.check((select count(*) = 0 from public.hr_advances), 'accountant sees no advances');
select pg_temp.expect_error(format($q$insert into public.hr_employees (hotel_id, full_name, department_id, hire_date) values (%L, 'متسلل', %L, '2026-01-01')$q$,
  (select id from h16), (select v from ids where k = 'dept')), 'row-level security');
select pg_temp.expect_error(format($q$select public.hr_payroll_preview(%L, '2026-09-01')$q$, (select id from h16)), 'ermission');

select pg_temp.act_as(null);
\o
select 'hr tests passed';
