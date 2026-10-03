-- =============================================================================
-- الموارد البشرية: ملفات الموظفين، الرواتب والبدلات، الحضور اليدوي، الورديات، الإجازات،
-- السلف والجزاءات، مكافأة نهاية الخدمة، والتسوية النهائية.
-- كل القواعد (الإجازات، البدلات، التأمينات، نهاية الخدمة، الدوام، الجزاءات) إعدادات يعدّلها الفندق.
-- الربط المحاسبي: السلفة تُقيَّد عند صرفها، والمسيّر يخصمها ويخصم الجزاءات والغياب والتأخير،
-- ومخصص نهاية الخدمة يُسوّى مع كل مسيّر، والتسوية النهائية تُقيَّد عند إنهاء الخدمة.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- الصلاحيات: ضمن ترخيص المحاسبة، للمدير العام، والمدقق يرى فقط
-- -----------------------------------------------------------------------------
insert into public.permissions (code, module, action, name_ar, name_en, sort_order, product) values
  ('hr.view',   'hr', 'view',   'عرض الموظفين والحضور والإجازات والرواتب',          'View employees, attendance, leave & pay', 1200, 'accounting'),
  ('hr.manage', 'hr', 'manage', 'إدارة الموظفين والحضور والإجازات والسلف والجزاءات', 'Manage employees, attendance, leave, advances & penalties', 1210, 'accounting');

insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r cross join public.permissions p
where r.is_system and p.module = 'hr' and (r.code = 'general_manager' or (r.code = 'auditor' and p.action = 'view'))
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- الإعدادات
-- -----------------------------------------------------------------------------
create table public.hr_settings (
  hotel_id               uuid primary key references public.hotels (id) on delete cascade,
  work_hours_per_day     numeric(5, 2) not null default 8 check (work_hours_per_day > 0 and work_hours_per_day <= 24),
  -- أيام العطلة الأسبوعية: 0 الأحد حتى 6 السبت
  weekend_days           smallint[] not null default '{5}' check (weekend_days <@ '{0,1,2,3,4,5,6}'::smallint[]),
  month_days             smallint not null default 30 check (month_days between 28 and 31),
  late_grace_minutes     integer not null default 15 check (late_grace_minutes between 0 and 240),
  late_deduction_rate    numeric(6, 3) not null default 1 check (late_deduction_rate >= 0),
  absence_deduction_days numeric(6, 3) not null default 1 check (absence_deduction_days >= 0),
  overtime_rate          numeric(6, 3) not null default 1.5 check (overtime_rate >= 0),
  insurance_employee_pct numeric(6, 3) not null default 0 check (insurance_employee_pct between 0 and 100),
  insurance_employer_pct numeric(6, 3) not null default 0 check (insurance_employer_pct between 0 and 100),
  -- شرائح المكافأة: من سنة الخدمة كذا تُحسب كذا يومًا من الأجر عن كل سنة
  eos_tiers              jsonb not null default '[{"from": 0, "days": 15}, {"from": 5, "days": 30}]',
  -- نسبة المكافأة عند الاستقالة حسب مجموع سنوات الخدمة، وعند الإنهاء 100٪
  eos_resign             jsonb not null default '[{"from": 0, "pct": 0}, {"from": 2, "pct": 33.33}, {"from": 5, "pct": 66.67}, {"from": 10, "pct": 100}]',
  leave_encashment       boolean not null default true,
  expiry_alert_days      integer not null default 30 check (expiry_alert_days between 1 and 365),
  updated_at             timestamptz not null default now(),
  updated_by             uuid references auth.users (id),
  constraint hr_eos_tiers_array check (jsonb_typeof(eos_tiers) = 'array' and jsonb_array_length(eos_tiers) between 1 and 10),
  constraint hr_eos_resign_array check (jsonb_typeof(eos_resign) = 'array' and jsonb_array_length(eos_resign) between 1 and 10)
);

create table public.hr_leave_types (
  id             uuid primary key default gen_random_uuid(),
  hotel_id       uuid not null references public.hotels (id) on delete cascade,
  name           text not null check (char_length(trim(name)) between 1 and 60),
  -- صفر يعني بلا رصيد محدد (مثل الإجازة بدون راتب)
  days_per_year  numeric(6, 2) not null default 0 check (days_per_year between 0 and 366),
  paid           boolean not null default true,
  carry_over     boolean not null default false,
  encashable     boolean not null default false,
  is_active      boolean not null default true,
  sort_order     integer not null default 0,
  unique (hotel_id, name),
  unique (hotel_id, id)
);

create table public.hr_pay_components (
  id             uuid primary key default gen_random_uuid(),
  hotel_id       uuid not null references public.hotels (id) on delete cascade,
  name           text not null check (char_length(trim(name)) between 1 and 60),
  kind           text not null check (kind in ('allowance', 'deduction')),
  calc           text not null default 'fixed' check (calc in ('fixed', 'percent')),
  default_value  numeric(19, 4) not null default 0 check (default_value >= 0),
  insurable      boolean not null default false,
  in_eos         boolean not null default false,
  is_active      boolean not null default true,
  sort_order     integer not null default 0,
  unique (hotel_id, name),
  unique (hotel_id, id),
  constraint hr_component_percent check (calc <> 'percent' or default_value <= 100)
);

create table public.hr_shifts (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references public.hotels (id) on delete cascade,
  name        text not null check (char_length(trim(name)) between 1 and 40),
  start_time  time not null,
  end_time    time not null check (end_time <> start_time),
  is_active   boolean not null default true,
  unique (hotel_id, name),
  unique (hotel_id, id)
);

-- -----------------------------------------------------------------------------
-- الموظفون
-- -----------------------------------------------------------------------------
create table public.hr_employees (
  id                  uuid primary key default gen_random_uuid(),
  hotel_id            uuid not null references public.hotels (id) on delete cascade,
  code                text not null check (code ~ '^[A-Za-z0-9_-]{1,20}$'),
  full_name           text not null check (char_length(trim(full_name)) between 2 and 120),
  job_title           text,
  department_id       uuid not null,
  phone               text,
  email               text,
  nationality         text,
  id_number           text,
  id_expiry           date,
  birth_date          date,
  hire_date           date not null,
  contract_type       text not null default 'permanent' check (contract_type in ('permanent', 'fixed', 'part_time')),
  contract_end        date,
  basic_salary        numeric(19, 4) not null default 0 check (basic_salary >= 0),
  shift_id            uuid,
  status              text not null default 'active' check (status in ('active', 'terminated')),
  termination_date    date,
  termination_reason  text check (termination_reason in ('resignation', 'termination')),
  notes               text,
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users (id),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users (id),
  unique (hotel_id, code),
  unique (hotel_id, id),
  foreign key (hotel_id, department_id) references public.departments (hotel_id, id),
  foreign key (hotel_id, shift_id) references public.hr_shifts (hotel_id, id),
  constraint hr_contract_end check (contract_end is null or contract_end >= hire_date),
  constraint hr_termination check ((status = 'terminated') = (termination_date is not null and termination_reason is not null))
);
create index hr_employees_hotel_idx on public.hr_employees (hotel_id, status);

-- قيمة البند لموظف معيّن (تتجاوز القيمة الافتراضية للبند)
create table public.hr_employee_components (
  employee_id   uuid not null,
  hotel_id      uuid not null,
  component_id  uuid not null,
  value         numeric(19, 4) not null check (value >= 0),
  primary key (employee_id, component_id),
  foreign key (hotel_id, employee_id) references public.hr_employees (hotel_id, id) on delete cascade,
  foreign key (hotel_id, component_id) references public.hr_pay_components (hotel_id, id) on delete cascade
);

-- جدول الورديات الأسبوعي: وردية الموظف في يوم معيّن، أو راحة (بلا وردية)
create table public.hr_roster (
  hotel_id     uuid not null,
  employee_id  uuid not null,
  work_date    date not null,
  shift_id     uuid,
  primary key (employee_id, work_date),
  foreign key (hotel_id, employee_id) references public.hr_employees (hotel_id, id) on delete cascade,
  foreign key (hotel_id, shift_id) references public.hr_shifts (hotel_id, id)
);

-- الحضور اليدوي: يُسجَّل الاستثناء (غياب، تأخير، إضافي)، واليوم غير المسجل يُعد حضورًا عاديًا
create table public.hr_attendance (
  id                uuid primary key default gen_random_uuid(),
  hotel_id          uuid not null,
  employee_id       uuid not null,
  work_date         date not null,
  status            text not null default 'present' check (status in ('present', 'absent', 'leave', 'off')),
  check_in          time,
  check_out         time,
  shift_start       time,
  shift_end         time,
  late_minutes      integer not null default 0,
  overtime_minutes  integer not null default 0,
  worked_minutes    integer not null default 0,
  notes             text,
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users (id),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references auth.users (id),
  unique (employee_id, work_date),
  foreign key (hotel_id, employee_id) references public.hr_employees (hotel_id, id) on delete cascade
);
create index hr_attendance_date_idx on public.hr_attendance (hotel_id, work_date);

create table public.hr_leaves (
  id             uuid primary key default gen_random_uuid(),
  hotel_id       uuid not null,
  employee_id    uuid not null,
  leave_type_id  uuid not null,
  start_date     date not null,
  end_date       date not null,
  days           numeric(6, 2) not null default 0,
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  reason         text,
  decided_by     uuid references auth.users (id),
  decided_at     timestamptz,
  created_at     timestamptz not null default now(),
  created_by     uuid references auth.users (id),
  foreign key (hotel_id, employee_id) references public.hr_employees (hotel_id, id) on delete cascade,
  foreign key (hotel_id, leave_type_id) references public.hr_leave_types (hotel_id, id),
  constraint hr_leave_dates check (end_date >= start_date and end_date - start_date <= 366)
);
create index hr_leaves_employee_idx on public.hr_leaves (employee_id, start_date);

create table public.hr_advances (
  id                  uuid primary key default gen_random_uuid(),
  hotel_id            uuid not null,
  advance_number      text not null,
  employee_id         uuid not null,
  advance_date        date not null,
  amount              numeric(19, 4) not null check (amount > 0),
  installments        integer not null check (installments between 1 and 60),
  installment_amount  numeric(19, 4) not null check (installment_amount > 0),
  recovered           numeric(19, 4) not null default 0 check (recovered >= 0),
  status              text not null default 'open' check (status in ('open', 'closed')),
  payment_method_id   uuid not null references public.payment_methods (id),
  journal_entry_id    uuid references public.journal_entries (id),
  notes               text,
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users (id),
  unique (hotel_id, advance_number),
  foreign key (hotel_id, employee_id) references public.hr_employees (hotel_id, id),
  constraint hr_advance_recovered check (recovered <= amount)
);

create table public.hr_penalties (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null,
  employee_id     uuid not null,
  penalty_date    date not null,
  amount          numeric(19, 4) not null check (amount > 0),
  reason          text not null check (char_length(trim(reason)) between 2 and 300),
  status          text not null default 'pending' check (status in ('pending', 'approved', 'cancelled')),
  payroll_run_id  uuid references public.payroll_runs (id),
  decided_by      uuid references auth.users (id),
  decided_at      timestamptz,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users (id),
  foreign key (hotel_id, employee_id) references public.hr_employees (hotel_id, id)
);

create table public.hr_settlements (
  id                  uuid primary key default gen_random_uuid(),
  hotel_id            uuid not null,
  employee_id         uuid not null unique,
  settlement_date     date not null,
  reason              text not null check (reason in ('resignation', 'termination')),
  service_years       numeric(8, 3) not null,
  eos_amount          numeric(19, 4) not null,
  leave_days          numeric(8, 2) not null default 0,
  leave_amount        numeric(19, 4) not null default 0,
  advances_recovered  numeric(19, 4) not null default 0,
  net_amount          numeric(19, 4) not null,
  journal_entry_id    uuid references public.journal_entries (id),
  details             jsonb not null default '{}',
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users (id),
  foreign key (hotel_id, employee_id) references public.hr_employees (hotel_id, id)
);

-- سطور المسيّر: ربط بالموظف، والإضافي والسلف في أعمدة مستقلة، وتفصيل كشف الراتب
alter table public.payroll_lines
  add column employee_id uuid,
  add column overtime numeric(19, 4) not null default 0 check (overtime >= 0),
  add column advance_recovery numeric(19, 4) not null default 0 check (advance_recovery >= 0),
  add column details jsonb,
  add foreign key (hotel_id, employee_id) references public.hr_employees (hotel_id, id);
alter table public.payroll_lines drop constraint payroll_net_positive;
alter table public.payroll_lines drop column net_pay;
alter table public.payroll_lines
  add column net_pay numeric(19, 4) generated always as (basic + allowances + overtime - deductions - insurance_employee - advance_recovery) stored,
  add constraint payroll_net_positive check (basic + allowances + overtime - deductions - insurance_employee - advance_recovery >= 0);
alter table public.payroll_runs add column from_hr boolean not null default false;

-- -----------------------------------------------------------------------------
-- حسابات الموارد البشرية: تُنشأ عند أول حاجة، وسلف الموظفين حساب مراقبة لا يُقيَّد يدويًا
-- -----------------------------------------------------------------------------
create or replace function app.hr_account(p_hotel_id uuid, p_key text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id      uuid;
  v_sibling text := case p_key when 'employee_advances' then 'prepaid' when 'eos_expense' then 'salaries' end;
  v_prev    text := coalesce(current_setting('app.system_posting', true), 'off');
begin
  if v_sibling is null then
    raise exception 'Unknown HR account %', p_key using errcode = '22023';
  end if;
  select id into v_id from public.chart_of_accounts where hotel_id = p_hotel_id and system_key = p_key;
  if v_id is null then
    perform set_config('app.system_posting', 'on', true);
    insert into public.chart_of_accounts
      (hotel_id, code, name_ar, name_en, account_type, account_subtype, is_postable, system_key, parent_id)
    select p_hotel_id,
           coalesce((select max(code::bigint) + 1 from public.chart_of_accounts
                      where hotel_id = p_hotel_id and parent_id = p.id and code ~ '^[0-9]+$')::text, p.code || '01'),
           case p_key when 'employee_advances' then 'سلف الموظفين' else 'مصروف مكافأة نهاية الخدمة' end,
           case p_key when 'employee_advances' then 'Employee Advances' else 'End of Service Expense' end,
           case p_key when 'employee_advances' then 'asset' else 'expense' end::public.account_type,
           case p_key when 'employee_advances' then 'current_asset' else 'operating_expense' end::public.account_subtype,
           true, p_key, p.id
    from public.chart_of_accounts p
    where p.hotel_id = p_hotel_id
      and p.id = (select parent_id from public.chart_of_accounts where hotel_id = p_hotel_id and system_key = v_sibling)
    returning id into v_id;
    perform set_config('app.system_posting', v_prev, true);
  end if;
  return v_id;
end;
$$;

create or replace function app.is_control_account(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.chart_of_accounts
                 where id = p_account_id and system_key in ('guest_ledger', 'guest_deposits', 'ar_control', 'ap_control', 'employee_advances'))
      or exists (select 1 from public.inventory_items where inventory_account_id = p_account_id);
$$;

-- -----------------------------------------------------------------------------
-- القيم الافتراضية لكل فندق: قابلة للتعديل كلها من الإعدادات
-- -----------------------------------------------------------------------------
create or replace function app.hr_seed(p_hotel_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.hr_settings (hotel_id) values (p_hotel_id) on conflict do nothing;
  insert into public.hr_leave_types (hotel_id, name, days_per_year, paid, carry_over, encashable, sort_order) values
    (p_hotel_id, 'الإجازة السنوية', 21, true, true, true, 1),
    (p_hotel_id, 'الإجازة المرضية', 30, true, false, false, 2),
    (p_hotel_id, 'إجازة اضطرارية', 5, true, false, false, 3),
    (p_hotel_id, 'إجازة بدون راتب', 0, false, false, false, 4)
  on conflict do nothing;
  insert into public.hr_pay_components (hotel_id, name, kind, calc, default_value, insurable, in_eos, sort_order) values
    (p_hotel_id, 'بدل السكن', 'allowance', 'percent', 0, true, true, 1),
    (p_hotel_id, 'بدل النقل', 'allowance', 'fixed', 0, false, true, 2),
    (p_hotel_id, 'بدل الطعام', 'allowance', 'fixed', 0, false, false, 3)
  on conflict do nothing;
  insert into public.hr_shifts (hotel_id, name, start_time, end_time) values
    (p_hotel_id, 'الوردية الصباحية', '07:00', '15:00'),
    (p_hotel_id, 'الوردية المسائية', '15:00', '23:00'),
    (p_hotel_id, 'الوردية الليلية', '23:00', '07:00')
  on conflict do nothing;
end;
$$;

create or replace function app.hr_seed_hotel()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.hr_seed(new.id);
  return new;
end;
$$;
create trigger hotels_hr_seed after insert on public.hotels for each row execute function app.hr_seed_hotel();

select app.hr_seed(id) from public.hotels;

-- -----------------------------------------------------------------------------
-- رمز الموظف التلقائي وحماية حالة الخدمة
-- -----------------------------------------------------------------------------
create or replace function app.hr_employee_before()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' and coalesce(trim(new.code), '') = '' then
    new.code := 'E' || lpad((coalesce((select max(substring(code from '^E([0-9]+)$')::integer) from public.hr_employees
                                        where hotel_id = new.hotel_id), 0) + 1)::text, 4, '0');
  end if;
  -- إنهاء الخدمة وإرجاعها يتمان من التسوية النهائية فقط، لأن لها أثرًا محاسبيًا
  if not app.is_system_posting() then
    if tg_op = 'INSERT' and new.status <> 'active' then
      raise exception 'New employees start active' using errcode = '23514';
    end if;
    if tg_op = 'UPDATE' and (new.status, new.termination_date, new.termination_reason)
       is distinct from (old.status, old.termination_date, old.termination_reason) then
      raise exception 'End of service is recorded through the final settlement' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger hr_employees_before before insert or update on public.hr_employees
  for each row execute function app.hr_employee_before();

-- -----------------------------------------------------------------------------
-- الحضور: الوردية من جدول الورديات ثم وردية الموظف، والتأخير والإضافي بالدقائق (مع الورديات الليلية)
-- -----------------------------------------------------------------------------
create or replace function app.hr_attendance_compute()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s      time;
  v_e      time;
  v_hours  numeric;
  v_in     integer;
  v_out    integer;
  v_start  integer;
  v_len    integer;
begin
  select s.start_time, s.end_time into v_s, v_e
  from public.hr_roster r join public.hr_shifts s on s.id = r.shift_id
  where r.employee_id = new.employee_id and r.work_date = new.work_date;
  if v_s is null then
    select s.start_time, s.end_time into v_s, v_e
    from public.hr_employees e join public.hr_shifts s on s.id = e.shift_id
    where e.id = new.employee_id;
  end if;
  new.shift_start := v_s;
  new.shift_end := v_e;
  new.late_minutes := 0;
  new.overtime_minutes := 0;
  new.worked_minutes := 0;

  if new.status <> 'present' then
    new.check_in := null;
    new.check_out := null;
    return new;
  end if;

  select work_hours_per_day into v_hours from public.hr_settings where hotel_id = new.hotel_id;
  v_hours := coalesce(v_hours, 8);
  if new.shift_start is not null then
    v_start := extract(epoch from new.shift_start)::integer / 60;
    v_len := (extract(epoch from new.shift_end)::integer / 60 - v_start + 1440) % 1440;
  end if;

  if new.check_in is not null then
    v_in := extract(epoch from new.check_in)::integer / 60;
    if v_start is not null then
      -- الفرق الأقرب على مدار اليوم (وصول قبل منتصف الليل لوردية تبدأ بعده والعكس)
      new.late_minutes := greatest(0, ((v_in - v_start + 720 + 1440) % 1440) - 720);
    end if;
    if new.check_out is not null then
      v_out := extract(epoch from new.check_out)::integer / 60;
      new.worked_minutes := (v_out - v_in + 1440) % 1440;
      new.overtime_minutes := greatest(0, new.worked_minutes - coalesce(v_len, round(v_hours * 60)::integer));
    end if;
  end if;
  return new;
end;
$$;
create trigger hr_attendance_compute before insert or update on public.hr_attendance
  for each row execute function app.hr_attendance_compute();

-- -----------------------------------------------------------------------------
-- الإجازات: الأيام بلا العطلة الأسبوعية، الرصيد، ومنع التداخل
-- -----------------------------------------------------------------------------
create or replace function app.hr_working_days(p_hotel_id uuid, p_from date, p_to date)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer
  from generate_series(p_from, p_to, interval '1 day') d
  where extract(dow from d)::smallint <> all (coalesce((select weekend_days from public.hr_settings where hotel_id = p_hotel_id), '{}'));
$$;

-- رصيد نوع إجازة لموظف في سنة: الاستحقاق (نسبي في سنة التعيين) والمرحّل من السنة السابقة والمأخوذ والمعلّق
create or replace function app.hr_leave_balance(p_employee_id uuid, p_type_id uuid, p_year integer, p_exclude uuid default null)
returns table (entitlement numeric, carried numeric, taken numeric, pending numeric, remaining numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_emp   public.hr_employees%rowtype;
  v_type  public.hr_leave_types%rowtype;
  v_start date := make_date(p_year, 1, 1);
  v_end   date := make_date(p_year, 12, 31);
  v_prev_ent numeric := 0;
  v_prev_taken numeric := 0;
begin
  select * into v_emp from public.hr_employees where id = p_employee_id;
  select * into v_type from public.hr_leave_types where id = p_type_id;
  entitlement := case
    when v_emp.hire_date > v_end then 0
    when v_emp.hire_date <= v_start then v_type.days_per_year
    else round(v_type.days_per_year * ((v_end - v_emp.hire_date + 1)::numeric / (v_end - v_start + 1)) * 2) / 2
  end;
  carried := 0;
  if v_type.carry_over and v_emp.hire_date < v_start then
    v_prev_ent := case when v_emp.hire_date <= make_date(p_year - 1, 1, 1) then v_type.days_per_year
      else round(v_type.days_per_year * ((make_date(p_year - 1, 12, 31) - v_emp.hire_date + 1)::numeric / 365) * 2) / 2 end;
    select coalesce(sum(days), 0) into v_prev_taken from public.hr_leaves
     where employee_id = p_employee_id and leave_type_id = p_type_id and status = 'approved'
       and extract(year from start_date) = p_year - 1;
    carried := greatest(v_prev_ent - v_prev_taken, 0);
  end if;
  select coalesce(sum(days) filter (where status = 'approved'), 0), coalesce(sum(days) filter (where status = 'pending'), 0)
    into taken, pending
  from public.hr_leaves
  where employee_id = p_employee_id and leave_type_id = p_type_id and extract(year from start_date) = p_year
    and (p_exclude is null or id <> p_exclude);
  remaining := entitlement + carried - taken;
  return next;
end;
$$;

create or replace function public.hr_leave_balances(p_employee_id uuid, p_year integer)
returns table (leave_type_id uuid, name text, paid boolean, limited boolean, entitlement numeric, carried numeric, taken numeric, pending numeric, remaining numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select t.id, t.name, t.paid, t.days_per_year > 0, b.entitlement, b.carried, b.taken, b.pending, b.remaining
  from public.hr_employees e
  join public.hr_leave_types t on t.hotel_id = e.hotel_id and t.is_active
  cross join lateral app.hr_leave_balance(e.id, t.id, p_year) b
  where e.id = p_employee_id and app.has_permission(e.hotel_id, 'hr.view')
  order by t.sort_order, t.name;
$$;

create or replace function app.hr_leave_before()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type public.hr_leave_types%rowtype;
  v_left numeric;
begin
  if not exists (select 1 from public.hr_employees where id = new.employee_id and status = 'active') then
    raise exception 'Employee is not active' using errcode = '23514';
  end if;
  new.days := app.hr_working_days(new.hotel_id, new.start_date, new.end_date);
  if new.days = 0 then
    raise exception 'Leave has no working days' using errcode = '23514';
  end if;
  if new.status in ('pending', 'approved') and exists (
    select 1 from public.hr_leaves l
    where l.employee_id = new.employee_id and l.id <> new.id and l.status in ('pending', 'approved')
      and daterange(l.start_date, l.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')
  ) then
    raise exception 'Leave overlaps another leave' using errcode = '23514';
  end if;
  if new.status in ('approved', 'rejected') and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    new.decided_by := auth.uid();
    new.decided_at := now();
  end if;
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status <> 'approved') then
    select * into v_type from public.hr_leave_types where id = new.leave_type_id;
    if v_type.days_per_year > 0 then
      select remaining into v_left from app.hr_leave_balance(new.employee_id, new.leave_type_id, extract(year from new.start_date)::integer, new.id);
      if new.days > v_left then
        raise exception 'Leave balance is not enough' using errcode = '23514';
      end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger hr_leaves_before before insert or update on public.hr_leaves
  for each row execute function app.hr_leave_before();

create or replace function app.hr_penalty_before()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.payroll_run_id is not null and not app.is_system_posting() then
    raise exception 'Penalty was already deducted in payroll' using errcode = '23514';
  end if;
  if new.status in ('approved', 'cancelled') and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    new.decided_by := auth.uid();
    new.decided_at := now();
  end if;
  return new;
end;
$$;
create trigger hr_penalties_before before insert or update on public.hr_penalties
  for each row execute function app.hr_penalty_before();

-- -----------------------------------------------------------------------------
-- مكافأة نهاية الخدمة حسب الشرائح ونسبة الاستقالة
-- -----------------------------------------------------------------------------
create or replace function app.hr_component_amount(p_employee_id uuid, p_component_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select case c.calc when 'percent' then e.basic_salary * coalesce(ec.value, c.default_value) / 100
                     else coalesce(ec.value, c.default_value) end
  from public.hr_employees e
  join public.hr_pay_components c on c.id = p_component_id
  left join public.hr_employee_components ec on ec.employee_id = e.id and ec.component_id = c.id
  where e.id = p_employee_id;
$$;

create or replace function app.hr_eos(p_employee_id uuid, p_as_of date, p_reason text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_emp    public.hr_employees%rowtype;
  v_set    public.hr_settings%rowtype;
  v_wage   numeric;
  v_years  numeric;
  v_amount numeric := 0;
  v_pct    numeric := 100;
  t        record;
begin
  select * into v_emp from public.hr_employees where id = p_employee_id;
  select * into v_set from public.hr_settings where hotel_id = v_emp.hotel_id;
  v_wage := v_emp.basic_salary + coalesce((
    select sum(app.hr_component_amount(v_emp.id, c.id)) from public.hr_pay_components c
    where c.hotel_id = v_emp.hotel_id and c.is_active and c.kind = 'allowance' and c.in_eos), 0);
  v_years := greatest(p_as_of - v_emp.hire_date + 1, 0)::numeric / 365;
  for t in
    select (x ->> 'from')::numeric as lo, (x ->> 'days')::numeric as days,
           lead((x ->> 'from')::numeric) over (order by (x ->> 'from')::numeric) as hi
    from jsonb_array_elements(v_set.eos_tiers) x
  loop
    v_amount := v_amount + greatest(least(v_years, coalesce(t.hi, v_years)) - t.lo, 0) * t.days / 30 * v_wage;
  end loop;
  if p_reason = 'resignation' then
    select coalesce((select (x ->> 'pct')::numeric from jsonb_array_elements(v_set.eos_resign) x
                      where (x ->> 'from')::numeric <= v_years order by (x ->> 'from')::numeric desc limit 1), 0) into v_pct;
  end if;
  return jsonb_build_object('years', round(v_years, 3), 'wage', round(v_wage, 2), 'full', round(v_amount, 2),
                            'pct', v_pct, 'amount', round(v_amount * v_pct / 100, 2));
end;
$$;

-- يسوّي مخصص نهاية الخدمة ليساوي مستحق كل الموظفين النشطين بافتراض الإنهاء في التاريخ
create or replace function app.hr_post_eos_provision(p_hotel_id uuid, p_as_of date, p_source_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_target  numeric;
  v_current numeric;
  v_diff    numeric;
  v_prov    uuid := app.account_by_key(p_hotel_id, 'eos_provision');
  v_exp     uuid := app.hr_account(p_hotel_id, 'eos_expense');
begin
  select coalesce(sum((app.hr_eos(e.id, p_as_of, 'termination') ->> 'amount')::numeric), 0) into v_target
  from public.hr_employees e where e.hotel_id = p_hotel_id and e.status = 'active' and e.hire_date <= p_as_of;
  select coalesce(sum(l.credit - l.debit), 0) into v_current
  from public.journal_entry_lines l join public.journal_entries j on j.id = l.journal_entry_id and j.status = 'posted'
  where l.hotel_id = p_hotel_id and l.account_id = v_prov and j.entry_date <= p_as_of;
  v_diff := round(v_target - v_current, 2);
  if v_diff = 0 then
    return null;
  end if;
  return app.post_system_entry(p_hotel_id, p_as_of, 'مخصص مكافأة نهاية الخدمة ' || to_char(p_as_of, 'YYYY-MM'), 'payroll', p_source_id,
    'EOS-' || to_char(p_as_of, 'YYYY-MM'), jsonb_build_array(
      jsonb_build_object('account_id', v_exp, 'debit', greatest(v_diff, 0), 'credit', greatest(-v_diff, 0)),
      jsonb_build_object('account_id', v_prov, 'debit', greatest(-v_diff, 0), 'credit', greatest(v_diff, 0))));
end;
$$;

-- -----------------------------------------------------------------------------
-- المسيّر: يُحسب من بيانات الموظفين والحضور والإجازات والجزاءات والسلف
-- -----------------------------------------------------------------------------
create or replace function app.hr_payroll_lines(p_hotel_id uuid, p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_set     public.hr_settings%rowtype;
  v_ms      date := date_trunc('month', p_month)::date;
  v_me      date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  v_dim     integer := extract(day from (date_trunc('month', p_month) + interval '1 month - 1 day'))::integer;
  e         record;
  v_from    date;
  v_to      date;
  v_ratio   numeric;
  v_basic   numeric;
  v_allow   numeric;
  v_allow_full numeric;
  v_insurable numeric;
  v_comp_ded numeric;
  v_daily   numeric;
  v_hourly  numeric;
  v_absent  integer;
  v_late    integer;
  v_ot_min  integer;
  v_unpaid  numeric;
  v_ot      numeric;
  v_abs_amt numeric;
  v_late_amt numeric;
  v_unpaid_amt numeric;
  v_pen     numeric;
  v_pen_ids jsonb;
  v_ded     numeric;
  v_ins_ee  numeric;
  v_ins_er  numeric;
  v_gross   numeric;
  v_room    numeric;
  v_adv     numeric;
  v_adv_list jsonb;
  v_items   jsonb;
  a         record;
  v_take    numeric;
  v_out     jsonb := '[]'::jsonb;
begin
  select * into v_set from public.hr_settings where hotel_id = p_hotel_id;
  for e in
    select * from public.hr_employees
    where hotel_id = p_hotel_id and hire_date <= v_me and (termination_date is null or termination_date >= v_ms)
    order by code
  loop
    v_from := greatest(e.hire_date, v_ms);
    v_to := least(coalesce(e.termination_date, v_me), v_me);
    v_ratio := (v_to - v_from + 1)::numeric / v_dim;
    v_basic := round(e.basic_salary * v_ratio, 2);

    select coalesce(jsonb_agg(jsonb_build_object('name', c.name, 'amount', round(app.hr_component_amount(e.id, c.id) * v_ratio, 2)) order by c.sort_order)
             filter (where c.kind = 'allowance' and app.hr_component_amount(e.id, c.id) > 0), '[]'),
           coalesce(sum(app.hr_component_amount(e.id, c.id)) filter (where c.kind = 'allowance'), 0),
           coalesce(sum(app.hr_component_amount(e.id, c.id)) filter (where c.kind = 'allowance' and c.insurable), 0),
           coalesce(sum(round(app.hr_component_amount(e.id, c.id) * v_ratio, 2)) filter (where c.kind = 'deduction'), 0)
      into v_items, v_allow_full, v_insurable, v_comp_ded
    from public.hr_pay_components c where c.hotel_id = p_hotel_id and c.is_active;
    v_allow := coalesce((select sum((x ->> 'amount')::numeric) from jsonb_array_elements(v_items) x), 0);

    v_daily := (e.basic_salary + v_allow_full) / v_set.month_days;
    v_hourly := e.basic_salary / v_set.month_days / v_set.work_hours_per_day;

    select count(*) filter (where status = 'absent'),
           coalesce(sum(greatest(late_minutes - v_set.late_grace_minutes, 0)) filter (where status = 'present'), 0),
           coalesce(sum(overtime_minutes) filter (where status = 'present'), 0)
      into v_absent, v_late, v_ot_min
    from public.hr_attendance where employee_id = e.id and work_date between v_from and v_to;

    select coalesce(sum(app.hr_working_days(p_hotel_id, greatest(l.start_date, v_from), least(l.end_date, v_to))), 0) into v_unpaid
    from public.hr_leaves l join public.hr_leave_types t on t.id = l.leave_type_id
    where l.employee_id = e.id and l.status = 'approved' and not t.paid and l.start_date <= v_to and l.end_date >= v_from;

    v_ot := round(v_ot_min / 60.0 * v_hourly * v_set.overtime_rate, 2);
    v_abs_amt := round(v_absent * v_daily * v_set.absence_deduction_days, 2);
    v_late_amt := round(v_late / 60.0 * v_hourly * v_set.late_deduction_rate, 2);
    v_unpaid_amt := round(v_unpaid * v_daily, 2);

    select coalesce(sum(amount), 0), coalesce(jsonb_agg(id), '[]') into v_pen, v_pen_ids
    from public.hr_penalties where employee_id = e.id and status = 'approved' and payroll_run_id is null and penalty_date <= v_me;

    v_ins_ee := round((e.basic_salary + v_insurable) * v_ratio * v_set.insurance_employee_pct / 100, 2);
    v_ins_er := round((e.basic_salary + v_insurable) * v_ratio * v_set.insurance_employer_pct / 100, 2);
    v_gross := v_basic + v_allow + v_ot;
    -- الخصومات لا تتجاوز المستحق، ثم السلف بما يتبقى
    v_ded := least(v_comp_ded + v_abs_amt + v_late_amt + v_unpaid_amt + v_pen, greatest(v_gross - v_ins_ee, 0));
    v_room := greatest(v_gross - v_ins_ee - v_ded, 0);
    v_ins_ee := least(v_ins_ee, v_gross);

    v_adv := 0;
    v_adv_list := '[]';
    for a in select id, installment_amount, amount - recovered as left_amount from public.hr_advances
             where employee_id = e.id and status = 'open' and advance_date <= v_me order by advance_date loop
      v_take := least(a.installment_amount, a.left_amount, v_room - v_adv);
      if v_take > 0 then
        v_adv := v_adv + v_take;
        v_adv_list := v_adv_list || jsonb_build_array(jsonb_build_object('id', a.id, 'amount', v_take));
      end if;
    end loop;

    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'employee_id', e.id, 'employee_name', e.full_name, 'employee_code', e.code, 'department_id', e.department_id,
      'basic', v_basic, 'allowances', v_allow, 'overtime', v_ot, 'deductions', v_ded,
      'insurance_employee', v_ins_ee, 'insurance_employer', v_ins_er, 'advance_recovery', v_adv,
      'details', jsonb_build_object(
        'days', v_to - v_from + 1, 'month_days', v_dim, 'allowances', v_items,
        'overtime_minutes', v_ot_min, 'absent_days', v_absent, 'absence', v_abs_amt,
        'late_minutes', v_late, 'late', v_late_amt, 'unpaid_leave_days', v_unpaid, 'unpaid_leave', v_unpaid_amt,
        'penalties', v_pen, 'penalty_ids', v_pen_ids, 'component_deductions', v_comp_ded, 'advances', v_adv_list)));
  end loop;
  return v_out;
end;
$$;

create or replace function public.hr_payroll_preview(p_hotel_id uuid, p_month date)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_permission(p_hotel_id, 'hr.view');
  return app.hr_payroll_lines(p_hotel_id, p_month);
end;
$$;

-- ترحيل المسيّر: نفس محرك الرواتب، مع سطور الإضافي وخصم السلف على حساب سلف الموظفين
create or replace function public.post_payroll(
  p_hotel_id uuid, p_period_month date, p_lines jsonb, p_posting_date date default null, p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', p_period_month)::date;
  v_date  date := coalesce(p_posting_date, (date_trunc('month', p_period_month) + interval '1 month - 1 day')::date);
  v_id    uuid;
  v_lines jsonb;
  v_prev  text := coalesce(current_setting('app.system_posting', true), 'off');
begin
  perform app.require_permission(p_hotel_id, 'payroll.manage');
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Payroll needs at least one employee line' using errcode = '22023';
  end if;

  perform set_config('app.system_posting', 'on', true);
  insert into public.payroll_runs (hotel_id, run_number, period_month, posting_date, total_gross, total_net, notes, created_by)
  values (p_hotel_id, app.next_document_number(p_hotel_id, 'payroll', 'PR', v_date), v_month, v_date, 0, 0,
          nullif(trim(p_notes), ''), auth.uid())
  returning id into v_id;

  insert into public.payroll_lines (run_id, hotel_id, employee_id, employee_name, employee_code, department_id, basic, allowances,
                                    overtime, deductions, insurance_employee, insurance_employer, advance_recovery, details)
  select v_id, p_hotel_id, nullif(e ->> 'employee_id', '')::uuid, e ->> 'employee_name', nullif(e ->> 'employee_code', ''),
         (e ->> 'department_id')::uuid,
         coalesce((e ->> 'basic')::numeric, 0), coalesce((e ->> 'allowances')::numeric, 0), coalesce((e ->> 'overtime')::numeric, 0),
         coalesce((e ->> 'deductions')::numeric, 0), coalesce((e ->> 'insurance_employee')::numeric, 0),
         coalesce((e ->> 'insurance_employer')::numeric, 0), coalesce((e ->> 'advance_recovery')::numeric, 0), e -> 'details'
  from jsonb_array_elements(p_lines) e;

  update public.payroll_runs r
     set total_gross = s.gross, total_net = s.net
    from (select sum(basic + allowances + overtime) as gross, sum(net_pay) as net from public.payroll_lines where run_id = v_id) s
   where r.id = v_id;

  -- سطور القيد مجمّعة لكل قسم (مركز تكلفة)
  select jsonb_agg(x) into v_lines from (
    select jsonb_build_object('account_id', app.account_by_key(p_hotel_id, 'salaries'), 'department_id', department_id, 'debit', sum(basic + overtime)) as x
      from public.payroll_lines where run_id = v_id group by department_id
    union all
    select jsonb_build_object('account_id', app.account_by_key(p_hotel_id, 'benefits'), 'department_id', department_id, 'debit', sum(allowances))
      from public.payroll_lines where run_id = v_id group by department_id
    union all
    select jsonb_build_object('account_id', app.account_by_key(p_hotel_id, 'social_insurance'), 'department_id', department_id, 'debit', sum(insurance_employer))
      from public.payroll_lines where run_id = v_id group by department_id
    union all
    select jsonb_build_object('account_id', app.account_by_key(p_hotel_id, 'salaries'), 'department_id', department_id, 'credit', sum(deductions))
      from public.payroll_lines where run_id = v_id group by department_id
    union all
    select jsonb_build_object('account_id', app.hr_account(p_hotel_id, 'employee_advances'), 'credit', sum(advance_recovery))
      from public.payroll_lines where run_id = v_id having sum(advance_recovery) > 0
    union all
    select jsonb_build_object('account_id', app.account_by_key(p_hotel_id, 'accrued_salaries'), 'credit', sum(net_pay))
      from public.payroll_lines where run_id = v_id
    union all
    select jsonb_build_object('account_id', app.account_by_key(p_hotel_id, 'accrued_expenses'), 'credit', sum(insurance_employee + insurance_employer))
      from public.payroll_lines where run_id = v_id
  ) s;

  update public.payroll_runs
     set journal_entry_id = app.post_system_entry(p_hotel_id, v_date, 'مسيّر رواتب ' || to_char(v_month, 'YYYY-MM'),
                                                  'payroll', v_id, to_char(v_month, 'YYYY-MM'), v_lines)
   where id = v_id;
  perform set_config('app.system_posting', v_prev, true);
  return v_id;
end;
$$;

create or replace function public.hr_run_payroll(p_hotel_id uuid, p_month date, p_posting_date date default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lines jsonb;
  v_id    uuid;
  v_month date := date_trunc('month', p_month)::date;
  v_me    date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
  l       jsonb;
  a       jsonb;
begin
  perform app.require_permission(p_hotel_id, 'hr.manage');
  if exists (select 1 from public.payroll_runs where hotel_id = p_hotel_id and period_month = v_month) then
    raise exception 'Payroll for this month is already posted' using errcode = '23505';
  end if;
  v_lines := app.hr_payroll_lines(p_hotel_id, v_month);
  if jsonb_array_length(v_lines) = 0 then
    raise exception 'No active employees for this month' using errcode = '22023';
  end if;
  v_id := public.post_payroll(p_hotel_id, v_month, v_lines, coalesce(p_posting_date, v_me), 'من بيانات الموظفين');

  perform set_config('app.system_posting', 'on', true);
  update public.payroll_runs set from_hr = true where id = v_id;
  for l in select * from jsonb_array_elements(v_lines) loop
    update public.hr_penalties set payroll_run_id = v_id
     where id in (select (x #>> '{}')::uuid from jsonb_array_elements(l -> 'details' -> 'penalty_ids') x);
    for a in select * from jsonb_array_elements(l -> 'details' -> 'advances') loop
      update public.hr_advances
         set recovered = recovered + (a ->> 'amount')::numeric,
             status = case when recovered + (a ->> 'amount')::numeric >= amount then 'closed' else 'open' end
       where id = (a ->> 'id')::uuid;
    end loop;
  end loop;
  perform app.hr_post_eos_provision(p_hotel_id, coalesce(p_posting_date, v_me), v_id);
  perform set_config('app.system_posting', 'off', true);
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- السلفة: تُصرف من طريقة دفع بالعملة الأساسية وتُستعاد أقساطًا من المسيّر
-- -----------------------------------------------------------------------------
create or replace function public.hr_pay_advance(
  p_employee_id uuid, p_date date, p_amount numeric, p_installments integer, p_payment_method_id uuid, p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_emp    public.hr_employees%rowtype;
  v_method public.payment_methods%rowtype;
  v_id     uuid;
  v_no     text;
begin
  select * into v_emp from public.hr_employees where id = p_employee_id;
  if not found then raise exception 'Employee not found' using errcode = 'P0002'; end if;
  perform app.require_permission(v_emp.hotel_id, 'hr.manage');
  if v_emp.status <> 'active' then raise exception 'Employee is not active' using errcode = '23514'; end if;
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive' using errcode = '22023'; end if;
  if p_installments is null or p_installments not between 1 and 60 then
    raise exception 'Installments must be between 1 and 60' using errcode = '22023';
  end if;
  select * into v_method from public.payment_methods where id = p_payment_method_id and hotel_id = v_emp.hotel_id and is_active;
  if not found then raise exception 'Payment method not found' using errcode = 'P0002'; end if;
  if v_method.currency_code is not null and v_method.currency_code <> (select base_currency from public.hotels where id = v_emp.hotel_id) then
    raise exception 'Advances are paid in the base currency' using errcode = '22023';
  end if;

  v_no := app.next_document_number(v_emp.hotel_id, 'hr_advance', 'ADV', p_date);
  perform set_config('app.system_posting', 'on', true);
  insert into public.hr_advances (hotel_id, advance_number, employee_id, advance_date, amount, installments, installment_amount,
                                  payment_method_id, notes, created_by)
  values (v_emp.hotel_id, v_no, v_emp.id, p_date, round(p_amount, 2), p_installments, round(p_amount / p_installments, 2),
          v_method.id, nullif(trim(p_notes), ''), auth.uid())
  returning id into v_id;
  update public.hr_advances set journal_entry_id = app.post_system_entry(v_emp.hotel_id, p_date, 'سلفة موظف ' || v_emp.full_name,
    'payroll', v_id, v_no, jsonb_build_array(
      jsonb_build_object('account_id', app.hr_account(v_emp.hotel_id, 'employee_advances'), 'debit', round(p_amount, 2)),
      jsonb_build_object('account_id', v_method.account_id, 'credit', round(p_amount, 2))))
  where id = v_id;
  perform set_config('app.system_posting', 'off', true);
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- التسوية النهائية: المكافأة، وتعويض رصيد الإجازات، وخصم السلف المتبقية
-- -----------------------------------------------------------------------------
create or replace function public.hr_settlement_quote(p_employee_id uuid, p_date date, p_reason text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_emp    public.hr_employees%rowtype;
  v_set    public.hr_settings%rowtype;
  v_eos    jsonb;
  v_days   numeric := 0;
  v_daily  numeric;
  v_leave  numeric := 0;
  v_adv    numeric;
  v_gross  numeric;
  v_rec    numeric;
begin
  select * into v_emp from public.hr_employees where id = p_employee_id;
  if not found then raise exception 'Employee not found' using errcode = 'P0002'; end if;
  perform app.require_permission(v_emp.hotel_id, 'hr.view');
  if p_reason not in ('resignation', 'termination') then raise exception 'Unknown end of service reason' using errcode = '22023'; end if;
  if p_date < v_emp.hire_date then raise exception 'End of service date is before hire date' using errcode = '22023'; end if;
  select * into v_set from public.hr_settings where hotel_id = v_emp.hotel_id;
  v_eos := app.hr_eos(v_emp.id, p_date, p_reason);
  if v_set.leave_encashment then
    select coalesce(sum(greatest(b.remaining, 0)), 0) into v_days
    from public.hr_leave_types t cross join lateral app.hr_leave_balance(v_emp.id, t.id, extract(year from p_date)::integer) b
    where t.hotel_id = v_emp.hotel_id and t.is_active and t.encashable and t.days_per_year > 0;
  end if;
  v_daily := (v_eos ->> 'wage')::numeric / v_set.month_days;
  v_leave := round(v_days * v_daily, 2);
  select coalesce(sum(amount - recovered), 0) into v_adv from public.hr_advances where employee_id = v_emp.id and status = 'open';
  v_gross := (v_eos ->> 'amount')::numeric + v_leave;
  v_rec := least(v_adv, v_gross);
  return v_eos || jsonb_build_object('reason', p_reason, 'date', p_date, 'leave_days', v_days, 'daily', round(v_daily, 2),
    'leave_amount', v_leave, 'advances_open', v_adv, 'advances_recovered', v_rec, 'net', v_gross - v_rec,
    'advances_left', v_adv - v_rec);
end;
$$;

create or replace function public.hr_terminate(p_employee_id uuid, p_date date, p_reason text, p_notes text default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_emp   public.hr_employees%rowtype;
  v_q     jsonb;
  v_prov  uuid;
  v_bal   numeric;
  v_eos   numeric;
  v_from_prov numeric;
  v_je    uuid;
  v_id    uuid;
  v_left  numeric;
  a       record;
begin
  select * into v_emp from public.hr_employees where id = p_employee_id for update;
  if not found then raise exception 'Employee not found' using errcode = 'P0002'; end if;
  perform app.require_permission(v_emp.hotel_id, 'hr.manage');
  if v_emp.status <> 'active' then raise exception 'Employee is not active' using errcode = '23514'; end if;
  v_q := public.hr_settlement_quote(p_employee_id, p_date, p_reason);
  v_eos := (v_q ->> 'amount')::numeric;
  v_prov := app.account_by_key(v_emp.hotel_id, 'eos_provision');
  select coalesce(sum(l.credit - l.debit), 0) into v_bal
  from public.journal_entry_lines l join public.journal_entries j on j.id = l.journal_entry_id and j.status = 'posted'
  where l.hotel_id = v_emp.hotel_id and l.account_id = v_prov;
  v_from_prov := least(v_eos, greatest(v_bal, 0));

  perform set_config('app.system_posting', 'on', true);
  if v_eos + (v_q ->> 'leave_amount')::numeric > 0 then
    v_je := app.post_system_entry(v_emp.hotel_id, p_date, 'التسوية النهائية ' || v_emp.full_name, 'payroll', v_emp.id, v_emp.code,
      jsonb_build_array(
        jsonb_build_object('account_id', v_prov, 'debit', v_from_prov),
        jsonb_build_object('account_id', app.hr_account(v_emp.hotel_id, 'eos_expense'), 'department_id', v_emp.department_id, 'debit', v_eos - v_from_prov),
        jsonb_build_object('account_id', app.account_by_key(v_emp.hotel_id, 'salaries'), 'department_id', v_emp.department_id,
                           'debit', (v_q ->> 'leave_amount')::numeric),
        jsonb_build_object('account_id', app.hr_account(v_emp.hotel_id, 'employee_advances'), 'credit', (v_q ->> 'advances_recovered')::numeric),
        jsonb_build_object('account_id', app.account_by_key(v_emp.hotel_id, 'accrued_salaries'), 'credit', (v_q ->> 'net')::numeric)));
  end if;

  v_left := (v_q ->> 'advances_recovered')::numeric;
  for a in select id, amount - recovered as open_amount from public.hr_advances where employee_id = v_emp.id and status = 'open' order by advance_date loop
    exit when v_left <= 0;
    update public.hr_advances
       set recovered = recovered + least(a.open_amount, v_left),
           status = case when least(a.open_amount, v_left) >= a.open_amount then 'closed' else 'open' end
     where id = a.id;
    v_left := v_left - least(a.open_amount, v_left);
  end loop;

  insert into public.hr_settlements (hotel_id, employee_id, settlement_date, reason, service_years, eos_amount, leave_days, leave_amount,
                                     advances_recovered, net_amount, journal_entry_id, details, created_by)
  values (v_emp.hotel_id, v_emp.id, p_date, p_reason, (v_q ->> 'years')::numeric, v_eos, (v_q ->> 'leave_days')::numeric,
          (v_q ->> 'leave_amount')::numeric, (v_q ->> 'advances_recovered')::numeric, (v_q ->> 'net')::numeric, v_je,
          v_q || jsonb_build_object('notes', nullif(trim(p_notes), '')), auth.uid())
  returning id into v_id;
  update public.hr_employees set status = 'terminated', termination_date = p_date, termination_reason = p_reason where id = v_emp.id;
  -- الإجازات والجزاءات المعلّقة تسقط بإنهاء الخدمة
  update public.hr_leaves set status = 'cancelled' where employee_id = v_emp.id and status = 'pending';
  perform set_config('app.system_posting', 'off', true);
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- الحفظ الجماعي من الشاشات (بصلاحيات المستخدم نفسه عبر RLS):
-- كشف الحضور ليوم، وجدول الورديات لأسبوع، وبنود راتب موظف
-- -----------------------------------------------------------------------------
create or replace function public.hr_save_attendance(p_hotel_id uuid, p_date date, p_rows jsonb)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_n integer;
begin
  -- اليوم العادي (حاضر بلا أوقات ولا ملاحظة) لا يُخزَّن
  delete from public.hr_attendance a
   using jsonb_array_elements(p_rows) r
   where a.hotel_id = p_hotel_id and a.work_date = p_date and a.employee_id = (r ->> 'employee_id')::uuid
     and r ->> 'status' = 'present' and coalesce(r ->> 'check_in', '') = '' and coalesce(r ->> 'check_out', '') = ''
     and coalesce(trim(r ->> 'notes'), '') = '';
  insert into public.hr_attendance (hotel_id, employee_id, work_date, status, check_in, check_out, notes)
  select p_hotel_id, (r ->> 'employee_id')::uuid, p_date, r ->> 'status', nullif(r ->> 'check_in', '')::time,
         nullif(r ->> 'check_out', '')::time, nullif(trim(r ->> 'notes'), '')
  from jsonb_array_elements(p_rows) r
  where not (r ->> 'status' = 'present' and coalesce(r ->> 'check_in', '') = '' and coalesce(r ->> 'check_out', '') = ''
             and coalesce(trim(r ->> 'notes'), '') = '')
  on conflict (employee_id, work_date) do update
    set status = excluded.status, check_in = excluded.check_in, check_out = excluded.check_out, notes = excluded.notes;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

-- shift: معرّف وردية، أو off للراحة، أو default لوردية الموظف الافتراضية
create or replace function public.hr_save_roster(p_hotel_id uuid, p_rows jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  delete from public.hr_roster o
   using jsonb_array_elements(p_rows) r
   where o.hotel_id = p_hotel_id and o.employee_id = (r ->> 'employee_id')::uuid and o.work_date = (r ->> 'work_date')::date
     and r ->> 'shift' = 'default';
  insert into public.hr_roster (hotel_id, employee_id, work_date, shift_id)
  select p_hotel_id, (r ->> 'employee_id')::uuid, (r ->> 'work_date')::date, case when r ->> 'shift' = 'off' then null else (r ->> 'shift')::uuid end
  from jsonb_array_elements(p_rows) r
  where r ->> 'shift' <> 'default'
  on conflict (employee_id, work_date) do update set shift_id = excluded.shift_id;
end;
$$;

-- value فارغة تعني الرجوع للقيمة الافتراضية للبند
create or replace function public.hr_save_employee_components(p_employee_id uuid, p_rows jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_hotel uuid := (select hotel_id from public.hr_employees where id = p_employee_id);
begin
  delete from public.hr_employee_components c
   using jsonb_array_elements(p_rows) r
   where c.employee_id = p_employee_id and c.component_id = (r ->> 'component_id')::uuid and coalesce(r ->> 'value', '') = '';
  insert into public.hr_employee_components (employee_id, hotel_id, component_id, value)
  select p_employee_id, v_hotel, (r ->> 'component_id')::uuid, (r ->> 'value')::numeric
  from jsonb_array_elements(p_rows) r
  where coalesce(r ->> 'value', '') <> ''
  on conflict (employee_id, component_id) do update set value = excluded.value;
end;
$$;

-- -----------------------------------------------------------------------------
-- الحماية: القراءة لمن يملك عرض الموارد البشرية، والكتابة لمن يملك إدارتها، والمالية عبر الدوال فقط
-- -----------------------------------------------------------------------------
create trigger hr_advances_system_only before insert or update or delete on public.hr_advances
  for each row execute function app.system_write_only();
create trigger hr_settlements_system_only before insert or update or delete on public.hr_settlements
  for each row execute function app.system_write_only();

do $$
declare
  t text;
begin
  foreach t in array array['hr_settings', 'hr_leave_types', 'hr_pay_components', 'hr_shifts', 'hr_employees', 'hr_employee_components',
                           'hr_roster', 'hr_attendance', 'hr_leaves', 'hr_advances', 'hr_penalties', 'hr_settlements'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format($p$create policy %I on public.%I for select to authenticated
      using (hotel_id in (select app.permitted_hotels('hr.view')) or hotel_id in (select app.permitted_hotels('hr.manage')))$p$, t || '_read', t);
    if t not in ('hr_advances', 'hr_settlements') then
      execute format($p$create policy %I on public.%I for all to authenticated
        using (hotel_id in (select app.permitted_hotels('hr.manage'))) with check (hotel_id in (select app.permitted_hotels('hr.manage')))$p$, t || '_write', t);
    end if;
  end loop;
end $$;
-- الإعدادات تُعدَّل ولا تُحذف ولا تُضاف يدويًا (تُنشأ مع الفندق)
drop policy hr_settings_write on public.hr_settings;
create policy hr_settings_update on public.hr_settings for update to authenticated
  using (hotel_id in (select app.permitted_hotels('hr.manage'))) with check (hotel_id in (select app.permitted_hotels('hr.manage')));

create trigger hr_settings_set_updated before update on public.hr_settings for each row execute function app.set_updated_at();
create trigger hr_employees_set_created before insert on public.hr_employees for each row execute function app.set_created_by();
create trigger hr_employees_set_updated before update on public.hr_employees for each row execute function app.set_updated_at();
create trigger hr_attendance_set_created before insert on public.hr_attendance for each row execute function app.set_created_by();
create trigger hr_attendance_set_updated before update on public.hr_attendance for each row execute function app.set_updated_at();
create trigger hr_leaves_set_created before insert on public.hr_leaves for each row execute function app.set_created_by();
create trigger hr_penalties_set_created before insert on public.hr_penalties for each row execute function app.set_created_by();

create trigger audit_hr_settings after insert or update or delete on public.hr_settings for each row execute function app.audit_trigger();
create trigger audit_hr_employees after insert or update or delete on public.hr_employees for each row execute function app.audit_trigger();
create trigger audit_hr_employee_components after insert or update or delete on public.hr_employee_components for each row execute function app.audit_trigger();
create trigger audit_hr_pay_components after insert or update or delete on public.hr_pay_components for each row execute function app.audit_trigger();
create trigger audit_hr_leave_types after insert or update or delete on public.hr_leave_types for each row execute function app.audit_trigger();
create trigger audit_hr_attendance after insert or update or delete on public.hr_attendance for each row execute function app.audit_trigger();
create trigger audit_hr_leaves after insert or update or delete on public.hr_leaves for each row execute function app.audit_trigger();
create trigger audit_hr_advances after insert or update or delete on public.hr_advances for each row execute function app.audit_trigger();
create trigger audit_hr_penalties after insert or update or delete on public.hr_penalties for each row execute function app.audit_trigger();
create trigger audit_hr_settlements after insert or update or delete on public.hr_settlements for each row execute function app.audit_trigger();

revoke execute on all functions in schema app from public, anon;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.hr_leave_balances(uuid, integer)',
    'public.hr_payroll_preview(uuid, date)',
    'public.hr_run_payroll(uuid, date, date)',
    'public.hr_pay_advance(uuid, date, numeric, integer, uuid, text)',
    'public.hr_settlement_quote(uuid, date, text)',
    'public.hr_terminate(uuid, date, text, text)',
    'public.hr_save_attendance(uuid, date, jsonb)',
    'public.hr_save_roster(uuid, jsonb)',
    'public.hr_save_employee_components(uuid, jsonb)',
    'public.post_payroll(uuid, date, jsonb, date, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
