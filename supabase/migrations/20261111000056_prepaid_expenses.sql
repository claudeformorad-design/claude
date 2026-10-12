-- =============================================================================
-- المصروفات المدفوعة مقدمًا وتوزيعها على الشهور:
--   مبلغ دُفع مقدمًا (إيجار سنة، تأمين، ترخيص) يُسجَّل جدولًا بعدد أشهره، فيُرحَّل قسط كل شهر في آخر يوم منه:
--   من حـ/ المصروف (بالقسم) إلى حـ/ المصروفات المدفوعة مقدمًا. القسط مقرّب لخانات العملة والأخير يأخذ الباقي،
--   فمجموع الأقساط يساوي المبلغ بالضبط. الترحيل يلحق الشهور الفائتة حتى اليوم، والإيقاف يترك الباقي في حسابه.
--   الدفع نفسه لا يُسجَّل هنا: يكون بسند صرف أو فاتورة مورد على حساب المدفوع مقدمًا كالمعتاد.
-- =============================================================================

alter type public.journal_source add value if not exists 'prepaid';

create table public.prepaid_expenses (
  id                  uuid primary key default gen_random_uuid(),
  hotel_id            uuid not null references public.hotels(id) on delete cascade,
  name                text not null check (length(trim(name)) between 1 and 120),
  prepaid_account_id  uuid not null,
  expense_account_id  uuid not null,
  department_id       uuid,
  total_amount        numeric(19, 4) not null check (total_amount > 0),
  months              integer not null check (months between 1 and 120),
  start_date          date not null,
  posted_months       integer not null default 0 check (posted_months >= 0),
  amortized_amount    numeric(19, 4) not null default 0 check (amortized_amount >= 0),
  status              text not null default 'active' check (status in ('active', 'completed', 'stopped')),
  last_entry_id       uuid references public.journal_entries(id),
  notes               text,
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id),
  unique (hotel_id, id),
  foreign key (hotel_id, prepaid_account_id) references public.chart_of_accounts (hotel_id, id),
  foreign key (hotel_id, expense_account_id) references public.chart_of_accounts (hotel_id, id),
  foreign key (hotel_id, department_id) references public.departments (hotel_id, id),
  constraint prepaid_amortized_le_total check (amortized_amount <= total_amount),
  constraint prepaid_posted_le_months check (posted_months <= months)
);
create index prepaid_expenses_hotel_idx on public.prepaid_expenses (hotel_id, status);
create trigger prepaid_expenses_set_created before insert on public.prepaid_expenses for each row execute function app.set_created_by();
create trigger prepaid_expenses_system_only before insert or update or delete on public.prepaid_expenses
  for each row execute function app.system_write_only();
create trigger audit_prepaid_expenses after insert or update or delete on public.prepaid_expenses for each row execute function app.audit_trigger();
alter table public.prepaid_expenses enable row level security;
create policy prepaid_expenses_read on public.prepaid_expenses for select to authenticated
  using (hotel_id in (select app.permitted_hotels('gl.journal.view')));

-- آخر يوم في الشهر رقم n من بداية الجدول (0 = شهر البداية)
create or replace function app.prepaid_month_end(p_start date, p_n integer)
returns date language sql immutable set search_path = '' as $$
  select (date_trunc('month', p_start) + make_interval(months => p_n + 1) - interval '1 day')::date;
$$;

-- القسط رقم n: المبلغ ÷ الأشهر مقربًا لخانات العملة، والأخير يأخذ الباقي
create or replace function app.prepaid_installment(p public.prepaid_expenses, p_decimals integer)
returns numeric language sql immutable set search_path = '' as $$
  select case when p.posted_months + 1 >= p.months then p.total_amount - p.amortized_amount
              else round(p.total_amount / p.months, p_decimals) end;
$$;

create or replace function public.create_prepaid_expense(
  p_hotel_id uuid, p_name text, p_expense_account_id uuid, p_department_id uuid,
  p_amount numeric, p_months integer, p_start_date date, p_prepaid_account_id uuid default null, p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prepaid uuid := coalesce(p_prepaid_account_id, app.account_by_key(p_hotel_id, 'prepaid'));
  v_id uuid;
begin
  perform app.require_permission(p_hotel_id, 'gl.journal.create');
  if p_amount is null or p_amount <= 0 then raise exception 'Amount must be positive' using errcode = '23514'; end if;
  if p_months is null or p_months not between 1 and 120 then raise exception 'Months must be between 1 and 120' using errcode = '23514'; end if;
  if p_start_date is null then raise exception 'Start date is required' using errcode = '23514'; end if;
  perform app.assert_account(p_hotel_id, v_prepaid, array['asset']::public.account_type[]);
  perform app.assert_account(p_hotel_id, p_expense_account_id, array['expense']::public.account_type[]);
  if p_department_id is not null and not exists (select 1 from public.departments where id = p_department_id and hotel_id = p_hotel_id) then
    raise exception 'Department does not belong to this hotel' using errcode = '23503';
  end if;
  perform set_config('app.system_posting', 'on', true);
  insert into public.prepaid_expenses (hotel_id, name, prepaid_account_id, expense_account_id, department_id, total_amount, months, start_date, notes)
  values (p_hotel_id, trim(p_name), v_prepaid, p_expense_account_id, p_department_id, p_amount, p_months, p_start_date, nullif(trim(p_notes), ''))
  returning id into v_id;
  perform set_config('app.system_posting', 'off', true);
  return v_id;
end;
$$;

-- ترحيل كل قسط حان شهره حتى اليوم (ويلحق الفائت)، ويعيد عدد القيود المرحّلة
create or replace function public.post_due_prepaid_expenses(p_hotel_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today    date := app.today_for_hotel(p_hotel_id);
  v_decimals integer;
  v_p        public.prepaid_expenses%rowtype;
  v_date     date;
  v_amount   numeric;
  v_entry    uuid;
  v_count    integer := 0;
begin
  perform app.require_permission(p_hotel_id, 'gl.journal.create');
  perform app.require_permission(p_hotel_id, 'gl.journal.post');
  perform pg_advisory_xact_lock(hashtext('nazeel.prepaid.' || p_hotel_id::text));
  select c.decimals into v_decimals from public.hotels h join public.currencies c on c.code = h.base_currency where h.id = p_hotel_id;
  for v_p in select * from public.prepaid_expenses where hotel_id = p_hotel_id and status = 'active' order by start_date, name for update loop
    loop
      exit when v_p.posted_months >= v_p.months;
      v_date := app.prepaid_month_end(v_p.start_date, v_p.posted_months);
      exit when v_date > v_today;
      v_amount := app.prepaid_installment(v_p, coalesce(v_decimals, 2));
      v_entry := app.post_system_entry(p_hotel_id, v_date,
        'إطفاء مصروف مقدم / Prepaid amortization — ' || v_p.name || ' (' || (v_p.posted_months + 1) || '/' || v_p.months || ')',
        'prepaid', v_p.id, 'PRE ' || left(v_p.name, 40) || ' #' || (v_p.posted_months + 1)::text,
        jsonb_build_array(
          jsonb_build_object('account_id', v_p.expense_account_id, 'department_id', v_p.department_id, 'debit', v_amount),
          jsonb_build_object('account_id', v_p.prepaid_account_id, 'credit', v_amount)));
      v_p.posted_months := v_p.posted_months + 1;
      v_p.amortized_amount := v_p.amortized_amount + v_amount;
      v_count := v_count + 1;
      perform set_config('app.system_posting', 'on', true);
      update public.prepaid_expenses
         set posted_months = v_p.posted_months, amortized_amount = v_p.amortized_amount, last_entry_id = v_entry,
             status = case when v_p.posted_months >= v_p.months then 'completed' else status end
       where id = v_p.id;
      perform set_config('app.system_posting', 'off', true);
    end loop;
  end loop;
  return v_count;
end;
$$;

-- إيقاف الجدول: لا يُرحَّل شيء بعده، والباقي يبقى في حساب المدفوع مقدمًا ليُعالج بقيد يدوي
create or replace function public.stop_prepaid_expense(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare v public.prepaid_expenses%rowtype;
begin
  select * into v from public.prepaid_expenses where id = p_id for update;
  if not found then raise exception 'Prepaid expense not found' using errcode = 'P0002'; end if;
  perform app.require_permission(v.hotel_id, 'gl.journal.create');
  if v.status <> 'active' then raise exception 'Prepaid expense is not active' using errcode = '23514'; end if;
  perform set_config('app.system_posting', 'on', true);
  update public.prepaid_expenses set status = 'stopped' where id = p_id;
  perform set_config('app.system_posting', 'off', true);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.create_prepaid_expense(uuid, text, uuid, uuid, numeric, integer, date, uuid, text)',
    'public.post_due_prepaid_expenses(uuid)',
    'public.stop_prepaid_expense(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function app.prepaid_month_end(date, integer) from public, anon;
revoke all on function app.prepaid_installment(public.prepaid_expenses, integer) from public, anon;
