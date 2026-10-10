-- =============================================================================
-- الموازنة التقديرية: لكل حساب إيراد أو مصروف (واختياريًا لكل قسم) مبلغ مخطط لكل فترة من فترات
-- السنة المالية. تقرير «الموازنة مقابل الفعلي» يقارن المخطط بالمرحّل فعلًا حتى فترة معينة،
-- ويحسب الانحراف (موجب = في صالح الفندق: إيراد أعلى أو مصروف أقل).
-- =============================================================================

insert into public.permissions (code, module, action, name_ar, name_en, sort_order, product) values
  ('budgets.manage', 'reports', 'manage', 'إعداد الموازنة التقديرية', 'Manage budgets', 905, 'core');
insert into public.role_permissions (role_id, permission_code)
select r.id, 'budgets.manage' from public.roles r
where r.is_system and r.code in ('general_manager', 'accountant')
on conflict do nothing;

create table public.budgets (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null references public.hotels(id) on delete cascade,
  fiscal_year_id  uuid not null,
  account_id      uuid not null,
  department_id   uuid,
  amounts         numeric(19, 4)[] not null check (array_length(amounts, 1) between 1 and 13 and array_ndims(amounts) = 1),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id),
  unique (hotel_id, id),
  foreign key (hotel_id, fiscal_year_id) references public.fiscal_years (hotel_id, id) on delete cascade,
  foreign key (hotel_id, account_id) references public.chart_of_accounts (hotel_id, id),
  foreign key (hotel_id, department_id) references public.departments (hotel_id, id)
);
create unique index budgets_one_line on public.budgets
  (hotel_id, fiscal_year_id, account_id, coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid));
-- الكتابة عبر save_budget فقط (لا سياسة كتابة على الجدول)
create trigger budgets_system_only before insert or update on public.budgets
  for each row execute function app.system_write_only();
alter table public.budgets enable row level security;
create policy budgets_read on public.budgets for select to authenticated
  using (hotel_id in (select app.permitted_hotels('budgets.manage')) or hotel_id in (select app.permitted_hotels('reports.financial.view')));
create trigger audit_budgets after insert or update or delete on public.budgets for each row execute function app.audit_trigger();

-- يحفظ مبالغ فترات السنة لحساب (وقسم)، والمبالغ كلها أصفار تحذف السطر
create or replace function public.save_budget(
  p_hotel_id uuid, p_fiscal_year_id uuid, p_account_id uuid, p_department_id uuid, p_amounts numeric[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_periods integer;
  v_dec     smallint;
  v_amt     numeric;
begin
  perform app.require_permission(p_hotel_id, 'budgets.manage');
  if not exists (select 1 from public.fiscal_years where id = p_fiscal_year_id and hotel_id = p_hotel_id) then
    raise exception 'Fiscal year not found' using errcode = 'P0002';
  end if;
  if not exists (select 1 from public.chart_of_accounts where id = p_account_id and hotel_id = p_hotel_id
                 and is_postable and account_type in ('revenue', 'expense')) then
    raise exception 'Budgets are for postable revenue and expense accounts' using errcode = '23514';
  end if;
  if p_department_id is not null and not exists (select 1 from public.departments where id = p_department_id and hotel_id = p_hotel_id) then
    raise exception 'Department not found' using errcode = 'P0002';
  end if;
  select count(*) into v_periods from public.accounting_periods where fiscal_year_id = p_fiscal_year_id and hotel_id = p_hotel_id;
  if p_amounts is null or coalesce(array_length(p_amounts, 1), 0) <> v_periods then
    raise exception 'Enter one amount for each of the % periods', v_periods using errcode = '22023';
  end if;
  v_dec := app.currency_decimals(p_hotel_id);
  foreach v_amt in array p_amounts loop
    if v_amt is null or v_amt < 0 or v_amt <> round(v_amt, v_dec) then
      raise exception 'Budget amounts must be zero or more with at most % decimals', v_dec using errcode = '23514';
    end if;
  end loop;

  perform set_config('app.system_posting', 'on', true);
  if (select coalesce(sum(x), 0) from unnest(p_amounts) x) = 0 then
    delete from public.budgets
     where hotel_id = p_hotel_id and fiscal_year_id = p_fiscal_year_id and account_id = p_account_id
       and department_id is not distinct from p_department_id;
  else
    insert into public.budgets (hotel_id, fiscal_year_id, account_id, department_id, amounts, updated_by)
    values (p_hotel_id, p_fiscal_year_id, p_account_id, p_department_id, p_amounts, auth.uid())
    on conflict (hotel_id, fiscal_year_id, account_id, coalesce(department_id, '00000000-0000-0000-0000-000000000000'::uuid))
    do update set amounts = excluded.amounts, updated_at = now(), updated_by = auth.uid();
  end if;
  perform set_config('app.system_posting', 'off', true);
end;
$$;

-- الموازنة مقابل الفعلي حتى فترة معينة (افتراضيًا آخر فترة)، لقسم أو للفندق كله.
-- الفعلي من القيود المرحّلة في فترات السنة بلا قيود الإقفال.
create or replace function public.budget_vs_actual(
  p_hotel_id uuid, p_fiscal_year_id uuid, p_to_period integer default null, p_department_id uuid default null
)
returns table (
  account_id uuid, code text, name_ar text, name_en text, account_type public.account_type,
  budget numeric, actual numeric, variance numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_to integer;
begin
  if not (app.has_permission(p_hotel_id, 'reports.financial.view') or app.has_permission(p_hotel_id, 'budgets.manage')) then
    raise exception 'Permission denied: reports.financial.view' using errcode = '42501';
  end if;
  if not exists (select 1 from public.fiscal_years where id = p_fiscal_year_id and hotel_id = p_hotel_id) then
    raise exception 'Fiscal year not found' using errcode = 'P0002';
  end if;
  v_to := coalesce(p_to_period, 13);
  return query
  with b as (
    select bu.account_id, sum((select coalesce(sum(x), 0) from unnest(bu.amounts[1:v_to]) x)) as amt
    from public.budgets bu
    where bu.hotel_id = p_hotel_id and bu.fiscal_year_id = p_fiscal_year_id
      and (p_department_id is null or bu.department_id = p_department_id)
    group by bu.account_id
  ), a as (
    select l.account_id, sum(l.base_debit - l.base_credit) as net
    from public.journal_entry_lines l
    join public.journal_entries j on j.id = l.journal_entry_id and j.status = 'posted' and j.source <> 'closing'
    join public.accounting_periods p on p.id = j.period_id and p.fiscal_year_id = p_fiscal_year_id and p.period_no <= v_to
    where l.hotel_id = p_hotel_id and (p_department_id is null or l.department_id = p_department_id)
    group by l.account_id
  )
  select c.id, c.code, c.name_ar, c.name_en, c.account_type,
         coalesce(b.amt, 0),
         case when c.account_type = 'revenue' then -coalesce(a.net, 0) else coalesce(a.net, 0) end,
         case when c.account_type = 'revenue' then -coalesce(a.net, 0) - coalesce(b.amt, 0) else coalesce(b.amt, 0) - coalesce(a.net, 0) end
  from public.chart_of_accounts c
  left join b on b.account_id = c.id
  left join a on a.account_id = c.id
  where c.hotel_id = p_hotel_id and c.account_type in ('revenue', 'expense') and (b.amt is not null or coalesce(a.net, 0) <> 0)
  order by c.account_type, c.code;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.save_budget(uuid, uuid, uuid, uuid, numeric[])',
    'public.budget_vs_actual(uuid, uuid, integer, uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
