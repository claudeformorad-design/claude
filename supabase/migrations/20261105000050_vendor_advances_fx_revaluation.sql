-- =============================================================================
-- 1) عربون الموردين (دفعة مقدمة قبل الفاتورة): سند صرف للمورد بلا فاتورة يُقيَّد مدين «دفعات مقدمة
--    للموردين» ودائن الصندوق أو البنك. عند وصول الفاتورة يُطبَّق العربون عليها: مدين الذمم الدائنة ودائن
--    الدفعات المقدمة، ويقل المستحق على الفاتورة. سند العربون لا يُلغى بعد تطبيق جزء منه.
-- 2) إعادة تقييم أرصدة العملات: لكل طريقة دفع بعملة أجنبية على حساب خاص بها، يُدخل الرصيد الفعلي
--    بالعملة، فيُقيَّم بسعر اليوم ويُقيَّد الفرق أرباحًا أو خسائر فروقات عملة في قيد واحد.
-- 3) ميزان المراجعة بالعملات: حركة كل حساب بكل عملة أجنبية قُيّدت بها القيود، مع ما يعادلها.
-- =============================================================================

alter type public.journal_source add value if not exists 'fx_revaluation';

-- حساب نظامي يُنشأ عند أول حاجة تحت مجموعة حساب مجاور
create or replace function app.ensure_system_account(
  p_hotel_id uuid, p_key text, p_near_key text, p_name_ar text, p_name_en text,
  p_type public.account_type, p_subtype public.account_subtype
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id   uuid;
  v_prev text := coalesce(current_setting('app.system_posting', true), 'off');
begin
  select id into v_id from public.chart_of_accounts where hotel_id = p_hotel_id and system_key = p_key;
  if v_id is null then
    perform set_config('app.system_posting', 'on', true);
    insert into public.chart_of_accounts
      (hotel_id, code, name_ar, name_en, account_type, account_subtype, is_postable, system_key, parent_id, level)
    select p_hotel_id,
           coalesce((select max(code::bigint) + 1 from public.chart_of_accounts
                      where hotel_id = p_hotel_id and parent_id = p.id and code ~ '^[0-9]+$')::text, p.code || '01'),
           p_name_ar, p_name_en, p_type, p_subtype, true, p_key, p.id, p.level + 1
    from public.chart_of_accounts p
    where p.hotel_id = p_hotel_id and p.id = (select parent_id from public.chart_of_accounts where hotel_id = p_hotel_id and system_key = p_near_key)
    returning id into v_id;
    perform set_config('app.system_posting', v_prev, true);
  end if;
  if v_id is null then
    raise exception 'System account "%" is not configured in the chart of accounts', p_key using errcode = '23514';
  end if;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 1) عربون الموردين
-- -----------------------------------------------------------------------------
create table public.vendor_advances (
  id               uuid primary key default gen_random_uuid(),
  hotel_id         uuid not null references public.hotels(id),
  vendor_id        uuid not null,
  payment_id       uuid not null unique references public.payments(id),
  amount           numeric(19, 4) not null check (amount > 0),
  applied_amount   numeric(19, 4) not null default 0 check (applied_amount >= 0),
  status           text not null default 'open' check (status in ('open', 'applied', 'voided')),
  created_at       timestamptz not null default now(),
  unique (hotel_id, id),
  foreign key (hotel_id, vendor_id) references public.vendors (hotel_id, id),
  constraint vendor_advance_applied_le_amount check (applied_amount <= amount)
);
create table public.vendor_advance_applications (
  id                uuid primary key default gen_random_uuid(),
  hotel_id          uuid not null references public.hotels(id),
  advance_id        uuid not null references public.vendor_advances(id),
  bill_id           uuid not null,
  amount            numeric(19, 4) not null check (amount > 0),
  applied_on        date not null,
  journal_entry_id  uuid references public.journal_entries(id),
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id),
  foreign key (hotel_id, bill_id) references public.vendor_bills (hotel_id, id)
);
create trigger vendor_advances_system_only before insert or update or delete on public.vendor_advances
  for each row execute function app.system_write_only();
create trigger vendor_advance_applications_system_only before insert or update or delete on public.vendor_advance_applications
  for each row execute function app.system_write_only();
alter table public.vendor_advances enable row level security;
alter table public.vendor_advance_applications enable row level security;
create policy vendor_advances_read on public.vendor_advances for select to authenticated
  using (hotel_id in (select app.permitted_hotels('bills.view')) or hotel_id in (select app.permitted_hotels('payments.view')));
create policy vendor_advance_applications_read on public.vendor_advance_applications for select to authenticated
  using (hotel_id in (select app.permitted_hotels('bills.view')) or hotel_id in (select app.permitted_hotels('payments.view')));
create trigger audit_vendor_advance_applications after insert on public.vendor_advance_applications for each row execute function app.audit_trigger();

-- المسدد على الفاتورة يشمل الآن العربون المطبَّق عليها
create or replace function app.refresh_bill_paid(p_bill_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_paid numeric;
begin
  select coalesce((select sum(a.amount) from public.bill_payment_allocations a
                   join public.payments p on p.id = a.payment_id and p.status = 'posted' where a.bill_id = p_bill_id), 0)
       + coalesce((select sum(d.total) from public.vendor_debit_notes d where d.bill_id = p_bill_id), 0)
       + coalesce((select sum(x.amount) from public.vendor_advance_applications x where x.bill_id = p_bill_id), 0)
    into v_paid;
  update public.vendor_bills
     set amount_paid = v_paid,
         status = case when v_paid >= total then 'paid' when v_paid = 0 then 'open' else 'partially_paid' end::public.bill_status
   where id = p_bill_id;
end;
$$;

create or replace function public.pay_vendor_advance(
  p_hotel_id uuid, p_vendor_id uuid, p_payment_method_id uuid, p_amount numeric,
  p_payment_date date default null, p_reference text default null, p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_vendor public.vendors%rowtype;
  v_method public.payment_methods%rowtype;
  v_date   date := coalesce(p_payment_date, app.today_for_hotel(p_hotel_id));
  v_id     uuid;
  v_number text;
  v_acc    uuid;
begin
  perform app.require_permission(p_hotel_id, 'payments.disbursement');
  select * into v_vendor from public.vendors where id = p_vendor_id and hotel_id = p_hotel_id;
  if not found then
    raise exception 'Vendor not found' using errcode = '23503';
  end if;
  v_method := app.active_payment_method(p_hotel_id, p_payment_method_id);
  if v_method.kind in ('city_ledger', 'cheque') or v_method.currency_code is not null then
    raise exception 'Vouchers require a cash or bank payment method' using errcode = '23514';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount <> round(p_amount, app.currency_decimals(p_hotel_id)) then
    raise exception 'Enter a valid advance amount' using errcode = '22023';
  end if;
  v_acc := app.ensure_system_account(p_hotel_id, 'vendor_advances', 'ar_control', 'دفعات مقدمة للموردين', 'Vendor advances', 'asset', 'current_asset');

  perform set_config('app.system_posting', 'on', true);
  v_number := app.next_document_number(p_hotel_id, 'voucher_disbursement', 'PV', v_date);
  insert into public.payments (hotel_id, voucher_number, voucher_type, party_type, payment_date, payment_method_id,
                               amount, vendor_id, party_name, reference, description, created_by)
  values (p_hotel_id, v_number, 'disbursement', 'vendor', v_date, v_method.id, p_amount, v_vendor.id, v_vendor.name_ar,
          nullif(trim(p_reference), ''), coalesce(nullif(trim(p_description), ''), 'عربون مورد'), auth.uid())
  returning id into v_id;
  insert into public.vendor_advances (hotel_id, vendor_id, payment_id, amount) values (p_hotel_id, v_vendor.id, v_id, p_amount);
  update public.payments
     set journal_entry_id = app.post_system_entry(p_hotel_id, v_date, 'عربون مورد / Vendor advance — ' || v_vendor.name_ar,
           'payment', v_id, v_number, jsonb_build_array(
             jsonb_build_object('account_id', v_acc, 'debit', p_amount),
             jsonb_build_object('account_id', v_method.account_id, 'credit', p_amount)))
   where id = v_id;
  perform set_config('app.system_posting', 'off', true);
  return v_id;
end;
$$;

create or replace function public.apply_vendor_advance(p_advance_id uuid, p_bill_id uuid, p_amount numeric, p_date date default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_adv  public.vendor_advances%rowtype;
  v_bill public.vendor_bills%rowtype;
  v_date date;
  v_id   uuid;
  v_no   text;
begin
  select * into v_adv from public.vendor_advances where id = p_advance_id for update;
  if not found then
    raise exception 'Advance not found' using errcode = 'P0002';
  end if;
  perform app.require_permission(v_adv.hotel_id, 'payments.disbursement');
  if v_adv.status <> 'open' then
    raise exception 'This advance is fully applied or cancelled' using errcode = '23514';
  end if;
  select * into v_bill from public.vendor_bills where id = p_bill_id and hotel_id = v_adv.hotel_id for update;
  if not found or v_bill.vendor_id <> v_adv.vendor_id then
    raise exception 'Bill not found for this vendor' using errcode = '23503';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > v_adv.amount - v_adv.applied_amount or p_amount > v_bill.total - v_bill.amount_paid then
    raise exception 'Amount must be within the advance balance (%) and the bill outstanding (%)',
      v_adv.amount - v_adv.applied_amount, v_bill.total - v_bill.amount_paid using errcode = '23514';
  end if;
  v_date := coalesce(p_date, app.today_for_hotel(v_adv.hotel_id));
  select voucher_number into v_no from public.payments where id = v_adv.payment_id;

  perform set_config('app.system_posting', 'on', true);
  insert into public.vendor_advance_applications (hotel_id, advance_id, bill_id, amount, applied_on, created_by)
  values (v_adv.hotel_id, v_adv.id, v_bill.id, p_amount, v_date, auth.uid())
  returning id into v_id;
  update public.vendor_advances
     set applied_amount = applied_amount + p_amount,
         status = case when applied_amount + p_amount >= amount then 'applied' else 'open' end
   where id = v_adv.id;
  perform app.refresh_bill_paid(v_bill.id);
  update public.vendor_advance_applications
     set journal_entry_id = app.post_system_entry(v_adv.hotel_id, v_date,
           'تطبيق عربون مورد / Vendor advance applied — ' || v_bill.bill_number, 'vendor_bill', v_id, v_no,
           jsonb_build_array(
             jsonb_build_object('account_id', app.account_by_key(v_adv.hotel_id, 'ap_control'), 'debit', p_amount),
             jsonb_build_object('account_id', app.account_by_key(v_adv.hotel_id, 'vendor_advances'), 'credit', p_amount)))
   where id = v_id;
  perform set_config('app.system_posting', 'off', true);
  return v_id;
end;
$$;

-- إلغاء سند العربون: مسموح قبل تطبيق أي جزء منه، ويُعلَّم العربون ملغى
create or replace function app.vendor_advance_on_void() returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_adv public.vendor_advances%rowtype;
begin
  if new.status = 'voided' and old.status = 'posted' then
    select * into v_adv from public.vendor_advances where payment_id = new.id for update;
    if found then
      if v_adv.applied_amount > 0 then
        raise exception 'This advance is already applied to bills; it cannot be voided' using errcode = '23514';
      end if;
      perform set_config('app.system_posting', 'on', true);
      update public.vendor_advances set status = 'voided' where id = v_adv.id;
    end if;
  end if;
  return new;
end; $$;
create trigger payments_vendor_advance_void after update of status on public.payments
  for each row execute function app.vendor_advance_on_void();

-- -----------------------------------------------------------------------------
-- 2) إعادة تقييم أرصدة العملات
-- -----------------------------------------------------------------------------
create table public.fx_revaluations (
  id                uuid primary key default gen_random_uuid(),
  hotel_id          uuid not null references public.hotels(id),
  revaluation_date  date not null,
  total_gain        numeric(19, 4) not null,
  total_loss        numeric(19, 4) not null,
  journal_entry_id  uuid references public.journal_entries(id),
  lines             jsonb not null,
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id)
);
create trigger fx_revaluations_system_only before insert or update or delete on public.fx_revaluations
  for each row execute function app.system_write_only();
alter table public.fx_revaluations enable row level security;
create policy fx_revaluations_read on public.fx_revaluations for select to authenticated
  using (hotel_id in (select app.permitted_hotels('gl.journal.view')));
create trigger audit_fx_revaluations after insert on public.fx_revaluations for each row execute function app.audit_trigger();

-- طرق الدفع بالعملات الأجنبية مع رصيد حسابها الدفتري وسعر اليوم. «shared» تعني أن الحساب
-- يُستخدم لعملة أخرى أيضًا فلا يمكن إعادة تقييمه منفصلًا.
create or replace function public.fx_revaluation_preview(p_hotel_id uuid, p_date date default null)
returns table (payment_method_id uuid, method_name text, currency_code text, account_id uuid, account_code text, account_name text,
               book_balance numeric, rate numeric, shared boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_date date := coalesce(p_date, app.today_for_hotel(p_hotel_id));
begin
  perform app.require_permission(p_hotel_id, 'gl.journal.post');
  return query
  select m.id, m.name_ar, m.currency_code::text, a.id, a.code, a.name_ar,
         coalesce((select sum(l.base_debit - l.base_credit) from public.journal_entry_lines l
                   join public.journal_entries j on j.id = l.journal_entry_id and j.status = 'posted'
                   where l.account_id = a.id and j.entry_date <= v_date), 0),
         (select r.rate from public.exchange_rates r where r.hotel_id = p_hotel_id and r.currency_code = m.currency_code
            and r.rate_date <= v_date order by r.rate_date desc limit 1),
         exists (select 1 from public.payment_methods o where o.hotel_id = p_hotel_id and o.account_id = m.account_id
                   and o.id <> m.id and o.currency_code is distinct from m.currency_code)
  from public.payment_methods m
  join public.chart_of_accounts a on a.id = m.account_id
  where m.hotel_id = p_hotel_id and m.currency_code is not null and m.is_active
  order by m.currency_code, m.name_ar;
end;
$$;

-- p_lines: [{payment_method_id, foreign_balance}] ؛ قيد واحد بالفروقات
create or replace function public.post_fx_revaluation(p_hotel_id uuid, p_lines jsonb, p_date date default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date   date := coalesce(p_date, app.today_for_hotel(p_hotel_id));
  v_dec    smallint := app.currency_decimals(p_hotel_id);
  v_line   jsonb;
  r        record;
  v_fb     numeric;
  v_new    numeric;
  v_diff   numeric;
  v_gain   numeric := 0;
  v_loss   numeric := 0;
  v_jl     jsonb := '[]'::jsonb;
  v_detail jsonb := '[]'::jsonb;
  v_id     uuid;
  v_seen   uuid[] := '{}';
begin
  perform app.require_permission(p_hotel_id, 'gl.journal.post');
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'Enter the actual balance for at least one currency account' using errcode = '22023';
  end if;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    select * into r from public.fx_revaluation_preview(p_hotel_id, v_date) x where x.payment_method_id = (v_line ->> 'payment_method_id')::uuid;
    if not found then
      raise exception 'Payment method not found' using errcode = 'P0002';
    end if;
    if r.shared then
      raise exception 'The account of % is shared with another currency; give it its own account first', r.method_name using errcode = '23514';
    end if;
    if r.rate is null then
      raise exception 'No exchange rate for % on or before %', r.currency_code, v_date using errcode = '23514';
    end if;
    if r.account_id = any (v_seen) then
      raise exception 'Each account can be revalued once per entry' using errcode = '23514';
    end if;
    v_seen := v_seen || r.account_id;
    v_fb := (v_line ->> 'foreign_balance')::numeric;
    if v_fb is null or v_fb < 0 then
      raise exception 'Enter the actual balance for at least one currency account' using errcode = '22023';
    end if;
    v_new := round(v_fb * r.rate, v_dec);
    v_diff := v_new - r.book_balance;
    v_detail := v_detail || jsonb_build_array(jsonb_build_object('payment_method_id', r.payment_method_id, 'currency', r.currency_code,
      'foreign_balance', v_fb, 'rate', r.rate, 'book_balance', r.book_balance, 'revalued', v_new, 'difference', v_diff));
    if v_diff > 0 then
      v_jl := v_jl || jsonb_build_array(jsonb_build_object('account_id', r.account_id, 'debit', v_diff,
        'description', r.currency_code || ' ' || trim(to_char(v_fb, 'FM999999999990.0999')) || ' @ ' || r.rate));
      v_gain := v_gain + v_diff;
    elsif v_diff < 0 then
      v_jl := v_jl || jsonb_build_array(jsonb_build_object('account_id', r.account_id, 'credit', -v_diff,
        'description', r.currency_code || ' ' || trim(to_char(v_fb, 'FM999999999990.0999')) || ' @ ' || r.rate));
      v_loss := v_loss - v_diff;
    end if;
  end loop;
  if v_gain = 0 and v_loss = 0 then
    raise exception 'Balances already match the current rates; nothing to post' using errcode = '23514';
  end if;
  if v_gain > 0 then
    v_jl := v_jl || jsonb_build_array(jsonb_build_object('account_id', app.account_by_key(p_hotel_id, 'fx_gain'), 'credit', v_gain));
  end if;
  if v_loss > 0 then
    v_jl := v_jl || jsonb_build_array(jsonb_build_object('account_id', app.account_by_key(p_hotel_id, 'fx_loss'), 'debit', v_loss));
  end if;

  perform set_config('app.system_posting', 'on', true);
  insert into public.fx_revaluations (hotel_id, revaluation_date, total_gain, total_loss, lines, created_by)
  values (p_hotel_id, v_date, v_gain, v_loss, v_detail, auth.uid())
  returning id into v_id;
  update public.fx_revaluations
     set journal_entry_id = app.post_system_entry(p_hotel_id, v_date, 'إعادة تقييم أرصدة العملات / FX revaluation', 'fx_revaluation', v_id, null, v_jl)
   where id = v_id;
  perform set_config('app.system_posting', 'off', true);
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3) ميزان المراجعة بالعملات
-- -----------------------------------------------------------------------------
create or replace function public.currency_trial_balance(p_hotel_id uuid, p_from date, p_to date)
returns table (account_id uuid, currency_code text, debit numeric, credit numeric, base_debit numeric, base_credit numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_permission(p_hotel_id, 'reports.trial_balance.view');
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Invalid date range' using errcode = '22023';
  end if;
  return query
  select l.account_id, j.currency_code::text, sum(l.debit), sum(l.credit), sum(l.base_debit), sum(l.base_credit)
  from public.journal_entry_lines l
  join public.journal_entries j on j.id = l.journal_entry_id and j.status = 'posted'
  join public.hotels h on h.id = j.hotel_id
  where l.hotel_id = p_hotel_id and j.entry_date between p_from and p_to and j.currency_code <> h.base_currency
  group by l.account_id, j.currency_code;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.pay_vendor_advance(uuid, uuid, uuid, numeric, date, text, text)',
    'public.apply_vendor_advance(uuid, uuid, numeric, date)',
    'public.fx_revaluation_preview(uuid, date)',
    'public.post_fx_revaluation(uuid, jsonb, date)',
    'public.currency_trial_balance(uuid, date, date)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
