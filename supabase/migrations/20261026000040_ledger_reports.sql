-- =============================================================================
-- تقارير الأستاذ:
--   1) كشف حساب لأي حساب (تفصيلي، أو إجمالي لحساب رئيسي بكل فروعه)، ولمركز تكلفة، بين تاريخين،
--      برصيد افتتاحي ورصيد جارٍ.
--   2) الحركة الشهرية للحسابات: مدين ودائن كل حساب في كل شهر من الفترة.
--   3) يومية الحسابات مجاميع: عدد القيود ومجموع المدين والدائن لكل يوم.
--   4) الأرقام المفقودة: فجوات تسلسل أرقام المستندات المالية مقارنة بآخر رقم صدر.
-- =============================================================================

-- 1) كشف الحساب: سطر افتتاحي ثم سطور الحركة بالترتيب الزمني
create or replace function public.account_statement(
  p_hotel_id uuid, p_account_id uuid, p_department_id uuid, p_from date, p_to date
)
returns table (
  is_opening boolean, entry_id uuid, entry_number text, entry_date date, source text, source_id uuid,
  reference text, description text, account_id uuid, department_id uuid, debit numeric, credit numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (app.has_permission(p_hotel_id, 'gl.journal.view') or app.has_permission(p_hotel_id, 'reports.trial_balance.view')) then
    raise exception 'Permission denied: gl.journal.view' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Invalid date range' using errcode = '22023';
  end if;
  if p_account_id is null and p_department_id is null then
    raise exception 'Choose an account or a cost center' using errcode = '22023';
  end if;
  if p_account_id is not null and not exists (select 1 from public.chart_of_accounts a where a.id = p_account_id and a.hotel_id = p_hotel_id) then
    raise exception 'Account not found' using errcode = 'P0002';
  end if;

  return query
  with recursive tree as (
    select a.id from public.chart_of_accounts a where a.id = p_account_id and a.hotel_id = p_hotel_id
    union all
    select c.id from public.chart_of_accounts c join tree t on c.parent_id = t.id where c.hotel_id = p_hotel_id
  ),
  lines as (
    select l.*, j.entry_number as jn, j.entry_date as jd, j.source::text as js, j.source_id as jsid, j.reference as jr, j.description as jdesc
    from public.journal_entry_lines l
    join public.journal_entries j on j.id = l.journal_entry_id and j.status = 'posted'
    where l.hotel_id = p_hotel_id and j.entry_date <= p_to
      and (p_account_id is null or l.account_id in (select id from tree))
      and (p_department_id is null or l.department_id = p_department_id)
  )
  select true, null::uuid, null::text, p_from, null::text, null::uuid, null::text, null::text, null::uuid, null::uuid,
         coalesce(sum(x.base_debit) filter (where x.jd < p_from), 0), coalesce(sum(x.base_credit) filter (where x.jd < p_from), 0)
  from lines x
  union all
  select * from (
    select false, x.journal_entry_id, x.jn, x.jd, x.js, x.jsid, x.jr, coalesce(nullif(x.description, ''), x.jdesc),
           x.account_id, x.department_id, x.base_debit, x.base_credit
    from lines x where x.jd >= p_from
    order by x.jd, x.jn, x.line_no
  ) s;
end;
$$;

-- 2) الحركة الشهرية لكل حساب
create or replace function public.monthly_account_movement(p_hotel_id uuid, p_from date, p_to date)
returns table (account_id uuid, month date, debit numeric, credit numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_permission(p_hotel_id, 'reports.trial_balance.view');
  if p_from is null or p_to is null or p_from > p_to or p_to > (p_from + interval '2 years')::date then
    raise exception 'Invalid date range' using errcode = '22023';
  end if;
  return query
  select l.account_id, date_trunc('month', j.entry_date)::date, sum(l.base_debit), sum(l.base_credit)
  from public.journal_entry_lines l
  join public.journal_entries j on j.id = l.journal_entry_id and j.status = 'posted'
  where l.hotel_id = p_hotel_id and j.entry_date between p_from and p_to
  group by 1, 2;
end;
$$;

-- 3) يومية الحسابات مجاميع
create or replace function public.daily_journal_totals(p_hotel_id uuid, p_from date, p_to date)
returns table (entry_date date, entries integer, debit numeric, credit numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (app.has_permission(p_hotel_id, 'gl.journal.view') or app.has_permission(p_hotel_id, 'reports.trial_balance.view')) then
    raise exception 'Permission denied: gl.journal.view' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Invalid date range' using errcode = '22023';
  end if;
  return query
  select j.entry_date, count(distinct j.id)::integer, sum(l.base_debit), sum(l.base_credit)
  from public.journal_entries j
  join public.journal_entry_lines l on l.journal_entry_id = j.id
  where j.hotel_id = p_hotel_id and j.status = 'posted' and j.entry_date between p_from and p_to
  group by 1 order by 1;
end;
$$;

-- 4) الأرقام المفقودة: كل رقم بين 1 وآخر رقم صدر في السلسلة ولا يوجد مستند يحمله
create or replace function public.document_number_gaps(p_hotel_id uuid)
returns table (doc_type text, year integer, prefix text, last_value bigint, missing_from bigint, missing_to bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (app.has_permission(p_hotel_id, 'audit.logs.view') or app.has_permission(p_hotel_id, 'reports.trial_balance.view')) then
    raise exception 'Permission denied: audit.logs.view' using errcode = '42501';
  end if;
  return query
  with used as (
    select 'journal_entry'::text as t, j.entry_number as n from public.journal_entries j where j.hotel_id = p_hotel_id and j.entry_number is not null
    union all select 'invoice', i.invoice_number from public.invoices i where i.hotel_id = p_hotel_id
    union all select 'credit_note', c.credit_note_number from public.credit_notes c where c.hotel_id = p_hotel_id
    union all select 'voucher_' || p.voucher_type::text, p.voucher_number from public.payments p where p.hotel_id = p_hotel_id
    union all select 'vendor_bill', b.bill_number from public.vendor_bills b where b.hotel_id = p_hotel_id
  ),
  nums as (
    select u.t, substring(u.n from '-(\d{4})-\d+$')::integer as y, substring(u.n from '(\d+)$')::bigint as v
    from used u where u.n ~ '-\d{4}-\d+$'
  ),
  seqs as (
    select s.doc_type, s.year, s.prefix, s.last_value from public.document_sequences s
    where s.hotel_id = p_hotel_id and s.doc_type in ('journal_entry', 'invoice', 'credit_note', 'voucher_receipt', 'voucher_disbursement', 'vendor_bill')
  ),
  missing as (
    select s.doc_type, s.year, s.prefix, s.last_value, g.v
    from seqs s cross join lateral generate_series(1::bigint, s.last_value) as g(v)
    where not exists (select 1 from nums n where n.t = s.doc_type and n.y = s.year and n.v = g.v)
  ),
  grouped as (
    select m.*, m.v - row_number() over (partition by m.doc_type, m.year order by m.v) as grp from missing m
  )
  select g.doc_type, g.year, g.prefix, g.last_value, min(g.v), max(g.v)
  from grouped g group by g.doc_type, g.year, g.prefix, g.last_value, g.grp
  order by g.doc_type, g.year, min(g.v);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.account_statement(uuid, uuid, uuid, date, date)',
    'public.monthly_account_movement(uuid, date, date)',
    'public.daily_journal_totals(uuid, date, date)',
    'public.document_number_gaps(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
