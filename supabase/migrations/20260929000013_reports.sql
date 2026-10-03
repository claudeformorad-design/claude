-- =============================================================================
-- المرحلة 5: التقارير — إحصاءات الغرف (الإشغال، ADR، RevPAR)، التدفق النقدي،
-- تقرير النقدية اليومي، واتجاه الإيرادات والمصروفات الشهري
-- =============================================================================

insert into public.permissions (code, module, action, name_ar, name_en, sort_order) values
  ('reports.financial.view', 'reports', 'view', 'القوائم المالية ولوحة المؤشرات', 'Financial statements & KPIs', 305),
  ('reports.cash.view',      'reports', 'view', 'تقرير النقدية اليومي',           'Daily cash report',           306);

insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r cross join public.permissions p
where r.is_system and (
  (r.code in ('general_manager', 'accountant', 'auditor') and p.code in ('reports.financial.view', 'reports.cash.view'))
  or (r.code = 'department_manager' and p.code = 'reports.financial.view')
  or (r.code = 'cashier' and p.code = 'reports.cash.view')
) on conflict do nothing;

-- عدد الغرف المتاحة للبيع (أساس الإشغال وRevPAR) — يُضبط من إعدادات الفندق
-- (العمود total_rooms موجود منذ المرحلة 1)

-- -----------------------------------------------------------------------------
-- إحصاءات الغرف لفترة:
--  الليالي المباعة = Σ كمية رسوم فئة "غرف" الفعّالة (بعد الإلغاءات)
--  إيراد الغرف     = Σ صافي رسوم الغرف − خصوماتها
--  الليالي المتاحة = عدد الغرف × عدد الأيام
--  الإشغال = المباعة / المتاحة، ADR = الإيراد / المباعة، RevPAR = الإيراد / المتاحة
-- ⚠ الحساب النهائي للنسب في src/lib/accounting/kpi.ts (مختبر)
-- -----------------------------------------------------------------------------
create or replace function public.room_statistics(p_hotel_id uuid, p_from date, p_to date)
returns table (business_date date, room_nights numeric, room_revenue numeric, rooms_available integer)
language plpgsql
stable
set search_path = ''
as $$
begin
  perform app.require_permission(p_hotel_id, 'reports.financial.view');
  if p_to < p_from or p_to - p_from > 366 then
    raise exception 'Invalid date range' using errcode = '22023';
  end if;
  return query
  select d::date,
         coalesce(sum(t.quantity * t.direction) filter (where t.txn_type = 'charge'), 0),
         coalesce(sum(case when t.txn_type = 'charge' then t.net_amount else -t.net_amount end * t.direction), 0),
         coalesce((select h.total_rooms from public.hotels h where h.id = p_hotel_id), 0)
  from generate_series(p_from, p_to, interval '1 day') d
  left join public.folio_transactions t
    on t.hotel_id = p_hotel_id and t.business_date = d::date and t.txn_type in ('charge', 'allowance')
   and exists (select 1 from public.charge_codes c where c.id = t.charge_code_id and c.category = 'room')
  group by d
  order by d;
end;
$$;

-- -----------------------------------------------------------------------------
-- قائمة التدفقات النقدية (الطريقة المباشرة):
-- لكل قيد مرحّل يمس حسابات النقد (صندوق، عهدة، بنك)، أثر كل سطر غير نقدي على النقد = −(مدين − دائن).
-- مجموعها يساوي صافي تغيّر النقد حرفيًا، ويُصنّف حسب نوع الحساب المقابل:
--  استثماري: أصول ثابتة/أخرى — تمويلي: حقوق ملكية وخصوم طويلة الأجل — تشغيلي: الباقي
-- -----------------------------------------------------------------------------
create or replace function public.cash_flow_lines(p_hotel_id uuid, p_from date, p_to date)
returns table (activity text, account_id uuid, amount numeric)
language plpgsql
stable
set search_path = ''
as $$
begin
  perform app.require_permission(p_hotel_id, 'reports.financial.view');
  return query
  with cash_accounts as (
    select id from public.chart_of_accounts
    where hotel_id = p_hotel_id and system_key in ('cash', 'petty_cash', 'bank')
  ),
  cash_entries as (
    select distinct j.id from public.journal_entries j
    join public.journal_entry_lines l on l.journal_entry_id = j.id
    where j.hotel_id = p_hotel_id and j.status = 'posted' and j.entry_date between p_from and p_to
      and l.account_id in (select id from cash_accounts)
  )
  select case when a.account_subtype in ('fixed_asset', 'other_asset') then 'investing'
              when a.account_subtype in ('equity', 'long_term_liability') then 'financing'
              else 'operating' end,
         l.account_id,
         sum(l.base_credit - l.base_debit)
  from public.journal_entry_lines l
  join cash_entries e on e.id = l.journal_entry_id
  join public.chart_of_accounts a on a.id = l.account_id
  where l.account_id not in (select id from cash_accounts)
  group by 1, 2;
end;
$$;

-- رصيد النقد في تاريخ (لبداية ونهاية قائمة التدفقات)
create or replace function public.cash_balance(p_hotel_id uuid, p_as_of date)
returns numeric
language plpgsql
stable
set search_path = ''
as $$
declare v numeric;
begin
  perform app.require_permission(p_hotel_id, 'reports.financial.view');
  select coalesce(sum(l.base_debit - l.base_credit), 0) into v
  from public.journal_entry_lines l
  join public.journal_entries j on j.id = l.journal_entry_id and j.status = 'posted' and j.entry_date <= p_as_of
  join public.chart_of_accounts a on a.id = l.account_id and a.system_key in ('cash', 'petty_cash', 'bank')
  where l.hotel_id = p_hotel_id;
  return v;
end;
$$;

-- -----------------------------------------------------------------------------
-- تقرير النقدية اليومي: المقبوضات والمدفوعات حسب طريقة الدفع (فوليو + سندات)
-- -----------------------------------------------------------------------------
create or replace function public.daily_cash_report(p_hotel_id uuid, p_date date)
returns table (payment_method_id uuid, method_name text, source text, receipts numeric, payments numeric)
language plpgsql
stable
set search_path = ''
as $$
begin
  perform app.require_permission(p_hotel_id, 'reports.cash.view');
  return query
  select m.id, m.name_ar, 'folio'::text,
         coalesce(sum(t.total_amount * t.direction) filter (where t.txn_type in ('payment', 'deposit')), 0),
         coalesce(sum(t.total_amount * t.direction) filter (where t.txn_type in ('refund', 'deposit_refund')), 0)
  from public.folio_transactions t join public.payment_methods m on m.id = t.payment_method_id
  where t.hotel_id = p_hotel_id and t.business_date = p_date
  group by m.id, m.name_ar
  union all
  select m.id, m.name_ar, 'voucher'::text,
         coalesce(sum(p.amount) filter (where p.voucher_type = 'receipt'), 0),
         coalesce(sum(p.amount) filter (where p.voucher_type = 'disbursement'), 0)
  from public.payments p join public.payment_methods m on m.id = p.payment_method_id
  where p.hotel_id = p_hotel_id and p.payment_date = p_date and p.status = 'posted'
  group by m.id, m.name_ar;
end;
$$;

-- -----------------------------------------------------------------------------
-- اتجاه شهري للإيرادات والمصروفات (للوحة التحكم)
-- -----------------------------------------------------------------------------
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
  join public.journal_entries j on j.id = l.journal_entry_id and j.status = 'posted'
  join public.chart_of_accounts a on a.id = l.account_id and a.account_type in ('revenue', 'expense')
  where l.hotel_id = p_hotel_id and j.entry_date between p_from and p_to
  group by 1 order by 1;
end;
$$;

-- القوائم المالية تستخدم gl_account_activity؛ نسمح بها أيضًا لمن يملك صلاحية القوائم المالية
create or replace function public.gl_account_activity(
  p_hotel_id uuid, p_fiscal_year_start date, p_from date, p_to date
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
  group by l.account_id;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.room_statistics(uuid, date, date)',
    'public.cash_flow_lines(uuid, date, date)',
    'public.cash_balance(uuid, date)',
    'public.daily_cash_report(uuid, date)',
    'public.monthly_pnl(uuid, date, date)',
    'public.gl_account_activity(uuid, date, date, date)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
