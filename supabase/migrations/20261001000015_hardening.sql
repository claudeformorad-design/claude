-- =============================================================================
-- تدقيق نهائي: إصلاح ثغرات منطقية وأمنية اكتُشفت في المراجعة
-- (كل بند مغطى باختبار في supabase/tests/07_hardening.test.sql)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) btree_gist خارج المخطط العام (لا تُكشف دواله الداخلية عبر الواجهة البرمجية)
-- -----------------------------------------------------------------------------
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, service_role;
alter extension btree_gist set schema extensions;

-- -----------------------------------------------------------------------------
-- 2) require_permission: "سياق النظام" فقط عندما لا يكون الطلب من الواجهة البرمجية.
--    طلب anon/authenticated بلا مستخدم يُرفض دائمًا (دفاع إضافي).
-- -----------------------------------------------------------------------------
create or replace function app.request_role()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
    ''
  );
$$;

create or replace function app.require_permission(p_hotel_id uuid, p_permission text)
returns void
language plpgsql
stable
set search_path = ''
as $$
begin
  if auth.uid() is null then
    if app.request_role() in ('anon', 'authenticated') then
      raise exception 'Permission denied: %', p_permission using errcode = '42501';
    end if;
    return; -- سياق النظام (service_role / ترحيلات / مهام مجدولة)
  end if;
  if not app.has_permission(p_hotel_id, p_permission) then
    raise exception 'Permission denied: %', p_permission using errcode = '42501';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3) حسابات المراقبة لا تُحرَّك بقيد يدوي: ذمم النزلاء، الودائع، الذمم المدينة والدائنة،
--    وحسابات المخزون المرتبطة بأصناف. وإلا لانكسر تطابق الأستاذ مع الدفاتر الفرعية.
--    تُحرَّك فقط من مستنداتها (فوليو، فواتير، سندات، فواتير موردين، حركات مخزون).
-- -----------------------------------------------------------------------------
create or replace function app.is_control_account(p_account_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.chart_of_accounts
                 where id = p_account_id and system_key in ('guest_ledger', 'guest_deposits', 'ar_control', 'ap_control'))
      or exists (select 1 from public.inventory_items where inventory_account_id = p_account_id);
$$;

create or replace function app.journal_lines_block_control()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source public.journal_source;
begin
  if app.is_system_posting() then
    return new;
  end if;
  select source into v_source from public.journal_entries where id = new.journal_entry_id;
  -- القيد العكسي لقيد يدوي مسموح (لأن الأصل نفسه لم يكن ليمس حساب مراقبة)
  if v_source <> 'reversal' and app.is_control_account(new.account_id) then
    raise exception 'Account is a control account (receivables/payables/deposits/inventory); use its source document'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger journal_lines_z_block_control before insert or update of account_id on public.journal_entry_lines
  for each row execute function app.journal_lines_block_control();

-- -----------------------------------------------------------------------------
-- 4) المفتاح النظامي للحساب لا يُغيّره المستخدم (يوجّه الترحيل الآلي)
-- -----------------------------------------------------------------------------
create or replace function app.coa_protect_system_key()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not app.is_system_posting() and auth.uid() is not null
     and (tg_op = 'INSERT' and new.system_key is not null
          or tg_op = 'UPDATE' and new.system_key is distinct from old.system_key) then
    raise exception 'System keys are managed by the system' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger coa_protect_system_key before insert or update of system_key on public.chart_of_accounts
  for each row execute function app.coa_protect_system_key();

-- البذور الافتراضية تُنشأ داخل دوال نظامية: نفعّل علَم النظام أثناءها
create or replace function app.seed_default_chart_of_accounts_wrapper(p_hotel_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_prev text := coalesce(current_setting('app.system_posting', true), 'off');
begin
  perform set_config('app.system_posting', 'on', true);
  perform app.seed_default_chart_of_accounts(p_hotel_id);
  perform set_config('app.system_posting', v_prev, true);
end;
$$;

create or replace function public.create_hotel(
  p_name_ar                 text,
  p_country_code            char(2),
  p_base_currency           char(3),
  p_name_en                 text default null,
  p_fiscal_year_start_month smallint default 1,
  p_timezone                text default 'Asia/Riyadh',
  p_seed_defaults           boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hotel_id  uuid;
  v_gm_role   uuid;
  v_fy_start  date;
  v_today     date;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  insert into public.hotels (name_ar, name_en, country_code, base_currency, fiscal_year_start_month, timezone)
  values (p_name_ar, p_name_en, upper(p_country_code), upper(p_base_currency), p_fiscal_year_start_month, p_timezone)
  returning id into v_hotel_id;

  select id into v_gm_role from public.roles where is_system and code = 'general_manager';
  insert into public.hotel_members (hotel_id, user_id) values (v_hotel_id, auth.uid());
  insert into public.user_hotel_roles (hotel_id, user_id, role_id) values (v_hotel_id, auth.uid(), v_gm_role);

  update public.users_profiles set default_hotel_id = v_hotel_id
   where id = auth.uid() and default_hotel_id is null;

  if p_seed_defaults then
    perform app.seed_default_departments(v_hotel_id);
    perform app.seed_default_chart_of_accounts_wrapper(v_hotel_id);
    perform app.seed_revenue_defaults(v_hotel_id);

    v_today := (now() at time zone p_timezone)::date;
    v_fy_start := make_date(extract(year from v_today)::integer, p_fiscal_year_start_month, 1);
    if v_fy_start > v_today then
      v_fy_start := (v_fy_start - interval '1 year')::date;
    end if;
    perform public.create_fiscal_year(v_hotel_id, v_fy_start);
  end if;

  return v_hotel_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5) طريقة دفع مستخدمة: نوعها وحسابها ثابتان (التصنيف التاريخي للمدفوعات يعتمد عليهما)
--    صنف مخزون له حركات: حساباه ثابتان (وإلا لا يطابق المخزون الأستاذ)
-- -----------------------------------------------------------------------------
create or replace function app.payment_methods_protect_used()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.kind is distinct from old.kind or new.account_id is distinct from old.account_id)
     and (exists (select 1 from public.folio_transactions where payment_method_id = old.id)
          or exists (select 1 from public.payments where payment_method_id = old.id)) then
    raise exception 'Payment method is already used; its kind and account cannot change (create a new method instead)'
      using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger payment_methods_protect_used before update on public.payment_methods
  for each row execute function app.payment_methods_protect_used();

create or replace function app.inventory_items_protect_used()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.inventory_account_id is distinct from old.inventory_account_id or new.expense_account_id is distinct from old.expense_account_id)
     and exists (select 1 from public.inventory_transactions where item_id = old.id) then
    raise exception 'Item already has movements; its accounts cannot change' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger inventory_items_protect_used before update on public.inventory_items
  for each row execute function app.inventory_items_protect_used();

-- -----------------------------------------------------------------------------
-- 6) قيد الإقفال السنوي لا يُحتسب في قائمة الدخل والربحية والاتجاه الشهري
-- -----------------------------------------------------------------------------
drop function public.gl_account_activity(uuid, date, date, date);
create function public.gl_account_activity(
  p_hotel_id uuid, p_fiscal_year_start date, p_from date, p_to date, p_exclude_closing boolean default false
)
returns table (
  account_id uuid, prior_years_debit numeric, prior_years_credit numeric,
  ytd_before_debit numeric, ytd_before_credit numeric, period_debit numeric, period_credit numeric
)
language plpgsql
stable
set search_path = ''
as $$
begin
  if auth.uid() is not null and not (app.has_permission(p_hotel_id, 'reports.trial_balance.view')
                                     or app.has_permission(p_hotel_id, 'reports.financial.view')) then
    raise exception 'Permission denied: reports.financial.view' using errcode = '42501';
  end if;
  if auth.uid() is null and app.request_role() in ('anon', 'authenticated') then
    raise exception 'Permission denied' using errcode = '42501';
  end if;
  if p_from > p_to or p_fiscal_year_start > p_from then
    raise exception 'Invalid date range' using errcode = '22023';
  end if;
  return query
  select l.account_id,
         coalesce(sum(l.base_debit)  filter (where j.entry_date <  p_fiscal_year_start), 0),
         coalesce(sum(l.base_credit) filter (where j.entry_date <  p_fiscal_year_start), 0),
         coalesce(sum(l.base_debit)  filter (where j.entry_date >= p_fiscal_year_start and j.entry_date < p_from), 0),
         coalesce(sum(l.base_credit) filter (where j.entry_date >= p_fiscal_year_start and j.entry_date < p_from), 0),
         coalesce(sum(l.base_debit)  filter (where j.entry_date between p_from and p_to), 0),
         coalesce(sum(l.base_credit) filter (where j.entry_date between p_from and p_to), 0)
  from public.journal_entry_lines l
  join public.journal_entries j on j.id = l.journal_entry_id
  where j.hotel_id = p_hotel_id and j.status = 'posted' and j.entry_date <= p_to
    -- استبعاد قيد الإقفال لقائمة الدخل (ميزان ما قبل الإقفال)؛ القيد كاملًا يُستبعد فيبقى الميزان متوازنًا
    and not (p_exclude_closing and j.source = 'closing' and j.entry_date >= p_fiscal_year_start)
  group by l.account_id;
end;
$$;
revoke execute on function public.gl_account_activity(uuid, date, date, date, boolean) from public, anon;
grant execute on function public.gl_account_activity(uuid, date, date, date, boolean) to authenticated;

create or replace function public.department_profitability(p_hotel_id uuid, p_from date, p_to date)
returns table (department_id uuid, account_type public.account_type, account_subtype public.account_subtype, amount numeric)
language plpgsql
stable
set search_path = ''
as $$
begin
  perform app.require_permission(p_hotel_id, 'reports.profitability.view');
  return query
  select l.department_id, a.account_type, a.account_subtype,
         sum(case when a.account_type = 'revenue' then l.base_credit - l.base_debit else l.base_debit - l.base_credit end)
  from public.journal_entry_lines l
  join public.journal_entries j on j.id = l.journal_entry_id and j.status = 'posted' and j.source <> 'closing'
  join public.chart_of_accounts a on a.id = l.account_id and a.account_type in ('revenue', 'expense')
  where l.hotel_id = p_hotel_id and j.entry_date between p_from and p_to
  group by l.department_id, a.account_type, a.account_subtype;
end;
$$;

create or replace function public.monthly_pnl(p_hotel_id uuid, p_from date, p_to date)
returns table (month date, revenue numeric, expenses numeric)
language plpgsql
stable
set search_path = ''
as $$
begin
  perform app.require_permission(p_hotel_id, 'reports.financial.view');
  return query
  select date_trunc('month', j.entry_date)::date,
         coalesce(sum(l.base_credit - l.base_debit) filter (where a.account_type = 'revenue'), 0),
         coalesce(sum(l.base_debit - l.base_credit) filter (where a.account_type = 'expense'), 0)
  from public.journal_entry_lines l
  join public.journal_entries j on j.id = l.journal_entry_id and j.status = 'posted' and j.source <> 'closing'
  join public.chart_of_accounts a on a.id = l.account_id and a.account_type in ('revenue', 'expense')
  where l.hotel_id = p_hotel_id and j.entry_date between p_from and p_to
  group by 1 order by 1;
end;
$$;

-- -----------------------------------------------------------------------------
-- صلاحيات التنفيذ (الدوال الجديدة في app تُمنح لـ PUBLIC افتراضيًا)
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema app from public, anon;
grant execute on function app.is_hotel_member(uuid) to authenticated;
grant execute on function app.has_permission(uuid, text) to authenticated;
grant execute on function app.require_permission(uuid, text) to authenticated;
grant execute on function app.request_role() to authenticated, service_role;
grant execute on function app.normal_balance_of(public.account_type) to authenticated, service_role;
grant execute on function app.subtype_matches_type(public.account_type, public.account_subtype) to authenticated, service_role;
grant execute on function app.is_system_posting() to authenticated, service_role;
grant execute on function app.assert_account(uuid, uuid, public.account_type[]) to authenticated, service_role;
grant execute on function app.today_for_hotel(uuid) to authenticated;
