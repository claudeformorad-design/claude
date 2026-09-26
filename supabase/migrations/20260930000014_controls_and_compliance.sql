-- =============================================================================
-- المرحلة 6: الإقفال السنوي، الموافقات (Maker-Checker)، إدارة المستخدمين،
-- إعدادات الفندق، الإقرار الضريبي، سجل التدقيق
-- =============================================================================

insert into public.permissions (code, module, action, name_ar, name_en, sort_order) values
  ('gl.journal.approve',     'gl',       'approve', 'اعتماد القيود فوق حد الموافقة',  'Approve entries above threshold', 225),
  ('payments.approve_large', 'payments', 'approve', 'اعتماد السندات فوق حد الموافقة', 'Approve large vouchers',          835),
  ('reports.tax.view',       'reports',  'view',    'الإقرار الضريبي',                'Tax return report',               330);

insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r cross join public.permissions p
where r.is_system and (
  (r.code = 'general_manager' and p.code in ('gl.journal.approve', 'payments.approve_large', 'reports.tax.view'))
  or (r.code in ('accountant', 'auditor') and p.code = 'reports.tax.view')
) on conflict do nothing;

-- -----------------------------------------------------------------------------
-- حدود الموافقة (null ⇒ لا حاجة لموافقة)
-- -----------------------------------------------------------------------------
alter table public.hotels add column journal_approval_threshold numeric(19, 4) check (journal_approval_threshold is null or journal_approval_threshold >= 0);
alter table public.hotels add column voucher_approval_threshold numeric(19, 4) check (voucher_approval_threshold is null or voucher_approval_threshold >= 0);

-- حارس القيود: القيد اليدوي فوق الحد لا يرحّله إلا شخص آخر غير منشئه ويملك صلاحية الاعتماد
create or replace function app.check_journal_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_threshold numeric;
  v_total     numeric;
begin
  if new.status = 'posted' and old.status = 'draft' and not app.is_system_posting() and auth.uid() is not null
     and new.source in ('manual', 'adjustment', 'opening') then
    select journal_approval_threshold into v_threshold from public.hotels where id = new.hotel_id;
    if v_threshold is not null then
      select coalesce(sum(base_debit), 0) into v_total from public.journal_entry_lines where journal_entry_id = new.id;
      if v_total >= v_threshold then
        if not app.has_permission(new.hotel_id, 'gl.journal.approve') then
          raise exception 'Entry total % requires approval (threshold %)', v_total, v_threshold using errcode = '42501';
        end if;
        if new.created_by = auth.uid() then
          raise exception 'Entries above the approval threshold must be posted by a different user (maker-checker)' using errcode = '42501';
        end if;
      end if;
    end if;
  end if;
  return new;
end;
$$;

-- يعمل بعد الحارس الأساسي (الترتيب الأبجدي لأسماء التريغرات: journal_entries_guard ثم journal_entries_z_approval)
create trigger journal_entries_z_approval before update on public.journal_entries
  for each row execute function app.check_journal_approval();

-- سندات الصرف فوق الحد تتطلب صلاحية الاعتماد
create or replace function app.check_voucher_approval()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_threshold numeric;
begin
  if new.voucher_type = 'disbursement' and auth.uid() is not null then
    select voucher_approval_threshold into v_threshold from public.hotels where id = new.hotel_id;
    if v_threshold is not null and new.amount >= v_threshold and not app.has_permission(new.hotel_id, 'payments.approve_large') then
      raise exception 'Payment voucher of % requires approval (threshold %)', new.amount, v_threshold using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger payments_z_approval before insert on public.payments
  for each row execute function app.check_voucher_approval();

-- -----------------------------------------------------------------------------
-- الإقفال السنوي: قيد إقفال يصفّر حسابات الإيرادات والمصروفات في الأرباح المبقاة،
-- ثم تُقفل كل فترات السنة والسنة نفسها. لا تعديل بعدها إلا باستثناء post_closed.
-- -----------------------------------------------------------------------------
create or replace function public.close_fiscal_year(p_fiscal_year_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  fy       public.fiscal_years%rowtype;
  v_re     uuid;
  v_id     uuid;
  v_no     integer := 0;
  r        record;
  v_net    numeric := 0;
begin
  select * into fy from public.fiscal_years where id = p_fiscal_year_id for update;
  if not found then raise exception 'Fiscal year not found' using errcode = 'P0002'; end if;
  perform app.require_permission(fy.hotel_id, 'gl.periods.manage');
  if fy.status = 'closed' then raise exception 'Fiscal year is already closed' using errcode = '23514'; end if;
  if exists (select 1 from public.journal_entries where hotel_id = fy.hotel_id and status = 'draft'
             and entry_date between fy.start_date and fy.end_date) then
    raise exception 'Post or delete draft entries in this year before closing' using errcode = '23514';
  end if;
  v_re := app.account_by_key(fy.hotel_id, 'retained_earnings');

  perform set_config('app.system_posting', 'on', true);
  insert into public.journal_entries (hotel_id, entry_date, period_id, description, reference, source, source_id, currency_code, exchange_rate)
  select fy.hotel_id, fy.end_date, '00000000-0000-0000-0000-000000000000', 'قيد إقفال السنة / Year-end closing ' || fy.name,
         fy.name, 'closing', fy.id, h.base_currency, 1
  from public.hotels h where h.id = fy.hotel_id
  returning id into v_id;

  for r in
    select l.account_id, l.department_id, sum(l.base_debit - l.base_credit) as net
    from public.journal_entry_lines l
    join public.journal_entries j on j.id = l.journal_entry_id and j.status = 'posted'
    join public.chart_of_accounts a on a.id = l.account_id and a.account_type in ('revenue', 'expense')
    where l.hotel_id = fy.hotel_id and j.entry_date between fy.start_date and fy.end_date
    group by l.account_id, l.department_id
    having sum(l.base_debit - l.base_credit) <> 0
  loop
    v_no := v_no + 1;
    insert into public.journal_entry_lines (journal_entry_id, hotel_id, line_no, account_id, department_id, debit, credit)
    values (v_id, fy.hotel_id, v_no, r.account_id, r.department_id, greatest(-r.net, 0), greatest(r.net, 0));
    v_net := v_net + r.net;
  end loop;

  if v_no = 0 then
    delete from public.journal_entries where id = v_id;
    v_id := null;
  else
    -- صافي مدين الحسابات = خسارة ⇒ مدين الأرباح المبقاة؛ صافي دائن = ربح ⇒ دائن الأرباح المبقاة
    insert into public.journal_entry_lines (journal_entry_id, hotel_id, line_no, account_id, debit, credit)
    values (v_id, fy.hotel_id, v_no + 1, v_re, greatest(v_net, 0), greatest(-v_net, 0));
    update public.journal_entries set status = 'posted' where id = v_id;
  end if;

  update public.accounting_periods set status = 'closed' where fiscal_year_id = fy.id and status = 'open';
  update public.fiscal_years set status = 'closed' where id = fy.id;
  perform set_config('app.system_posting', 'off', true);
  return v_id;
end;
$$;

-- إغلاق/إعادة فتح فترة (إعادة الفتح تتطلب سنة مفتوحة)
create or replace function public.set_period_status(p_period_id uuid, p_status public.period_status)
returns void
language plpgsql
set search_path = ''
as $$
declare
  p public.accounting_periods%rowtype;
begin
  select * into p from public.accounting_periods where id = p_period_id;
  if not found then raise exception 'Period not found' using errcode = 'P0002'; end if;
  perform app.require_permission(p.hotel_id, 'gl.periods.manage');
  if p_status = 'open' and (select status from public.fiscal_years where id = p.fiscal_year_id) = 'closed' then
    raise exception 'Cannot reopen a period of a closed fiscal year' using errcode = '23514';
  end if;
  update public.accounting_periods set status = p_status where id = p_period_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- إدارة المستخدمين: إضافة مستخدم مسجّل (بالبريد) لعضوية الفندق مع أدوار
-- -----------------------------------------------------------------------------
create or replace function public.add_hotel_member(p_hotel_id uuid, p_email text, p_role_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  perform app.require_permission(p_hotel_id, 'settings.users.manage');
  select id into v_user from auth.users where lower(email) = lower(trim(p_email));
  if v_user is null then
    raise exception 'No registered user with this email — ask them to sign up first' using errcode = 'P0002';
  end if;
  insert into public.hotel_members (hotel_id, user_id, is_active) values (p_hotel_id, v_user, true)
  on conflict (hotel_id, user_id) do update set is_active = true;
  insert into public.user_hotel_roles (hotel_id, user_id, role_id)
  select p_hotel_id, v_user, r from unnest(coalesce(p_role_ids, '{}')) r
  on conflict do nothing;
  return v_user;
end;
$$;

-- قائمة أعضاء الفندق مع بريدهم وأدوارهم (لمن يدير المستخدمين)
create or replace function public.hotel_members_overview(p_hotel_id uuid)
returns table (user_id uuid, email text, full_name text, is_active boolean, role_ids uuid[])
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_permission(p_hotel_id, 'settings.users.manage');
  return query
  select m.user_id, u.email::text, coalesce(p.full_name, ''), m.is_active,
         coalesce(array_agg(r.role_id) filter (where r.role_id is not null), '{}')
  from public.hotel_members m
  join auth.users u on u.id = m.user_id
  left join public.users_profiles p on p.id = m.user_id
  left join public.user_hotel_roles r on r.hotel_id = m.hotel_id and r.user_id = m.user_id
  where m.hotel_id = p_hotel_id
  group by m.user_id, u.email, p.full_name, m.is_active
  order by u.email;
end;
$$;

-- -----------------------------------------------------------------------------
-- الإقرار الضريبي للفترة (لكل ضريبة): المبيعات (الوعاء والضريبة) والمشتريات (للقيمة المضافة)
--  المبيعات: رسوم الفوليو − خصوماتها (بتاريخ العمل) + الفواتير المباشرة (بتاريخ الإصدار)
--           − الإشعارات الدائنة (موزعة بنسبة ضرائب فاتورتها)
--  المشتريات: سطور فواتير الموردين بضريبة من نوع vat (بتاريخ الفاتورة)
-- -----------------------------------------------------------------------------
create or replace function public.tax_return(p_hotel_id uuid, p_from date, p_to date)
returns table (tax_rate_id uuid, code text, name text, kind public.tax_kind, rate numeric,
               sales_base numeric, sales_tax numeric, purchases_base numeric, purchases_tax numeric)
language plpgsql
stable
set search_path = ''
as $$
begin
  perform app.require_permission(p_hotel_id, 'reports.tax.view');
  return query
  with sales as (
    select x.tax_rate_id, sum(x.taxable_base * t.direction * case when t.txn_type = 'allowance' then -1 else 1 end) as base,
           sum(x.amount * t.direction * case when t.txn_type = 'allowance' then -1 else 1 end) as tax
    from public.folio_transaction_taxes x join public.folio_transactions t on t.id = x.transaction_id
    where t.hotel_id = p_hotel_id and t.business_date between p_from and p_to
    group by x.tax_rate_id
    union all
    select it.tax_rate_id, sum(it.taxable_base), sum(it.amount)
    from public.invoice_taxes it join public.invoices i on i.id = it.invoice_id and i.invoice_type = 'direct'
    where i.hotel_id = p_hotel_id and i.issue_date between p_from and p_to
    group by it.tax_rate_id
    union all
    select it.tax_rate_id,
           -- الوعاء بنسبة وعاء كل ضريبة إلى صافي الفاتورة، والضريبة بنسبة كل ضريبة إلى ضريبة الفاتورة
           -sum(cn.net_amount * it.taxable_base / nullif(i.subtotal, 0)),
           -sum(cn.tax_amount * it.amount / nullif(i.tax_total, 0))
    from public.credit_notes cn
    join public.invoices i on i.id = cn.invoice_id
    join public.invoice_taxes it on it.invoice_id = i.id
    where cn.hotel_id = p_hotel_id and cn.issue_date between p_from and p_to
    group by it.tax_rate_id
  ),
  purchases as (
    select l.tax_rate_id, sum(l.net_amount) as base, sum(l.tax_amount) as tax
    from public.vendor_bill_lines l join public.vendor_bills b on b.id = l.bill_id
    where b.hotel_id = p_hotel_id and b.bill_date between p_from and p_to and l.tax_rate_id is not null
    group by l.tax_rate_id
  )
  select t.id, t.code, t.name_ar, t.kind, t.rate,
         coalesce((select sum(s.base) from sales s where s.tax_rate_id = t.id), 0),
         coalesce((select sum(s.tax) from sales s where s.tax_rate_id = t.id), 0),
         coalesce((select sum(p.base) from purchases p where p.tax_rate_id = t.id), 0),
         coalesce((select sum(p.tax) from purchases p where p.tax_rate_id = t.id), 0)
  from public.tax_rates t
  where t.hotel_id = p_hotel_id
  order by t.code;
end;
$$;

-- RLS: قراءة سجل التدقيق مع اسم المستخدم (عرض)
create view public.audit_log_view
with (security_invoker = true) as
select a.*, p.full_name as actor_name
from public.audit_logs a left join public.users_profiles p on p.id = a.actor_id;

do $$
declare f text;
begin
  foreach f in array array[
    'public.close_fiscal_year(uuid)',
    'public.set_period_status(uuid, public.period_status)',
    'public.add_hotel_member(uuid, text, uuid[])',
    'public.hotel_members_overview(uuid)',
    'public.tax_return(uuid, date, date)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
