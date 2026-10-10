-- =============================================================================
-- الصندوق بعدة عملات (احتياجات السوق اليمني):
--   1) الريال اليمني بطبعتيه: «طبعة قديمة» و«طبعة جديدة» كعملتين يُسجَّل لكل منهما سعر صرف مستقل
--      مقابل العملة الأساسية للفندق، فيُقبل الدفع بأي منهما بصندوق خاص به.
--   2) صندوق أو محفظة بحساب مستقل في دليل الحسابات بضغطة واحدة (صندوق الدولار، محفظة جوالي...).
--   3) المحافظ الإلكترونية: طريقة الدفع قد تشترط «رقم العملية»، ولا يُقبل رقم عملية سبق استخدامه
--      لنفس المحفظة (يمنع تكرار إيصال واحد لأكثر من دفعة).
--   4) وردية الكاشير: عهدة افتتاحية لكل صندوق بعملته، وتُحسب على الوردية سندات القبض والصرف
--      وسندات التحويل التي ينشئها صاحبها أثناءها (مثل توريد النقد للبنك أو تصريف الدولار).
--   5) تقرير النقدية بالعملات: رصيد كل صندوق ومحفظة وبنك بعملته (أول المدة، المقبوض، المدفوع، الرصيد)
--      ومعادله بالعملة الأساسية بسعر آخر يوم في الفترة.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) طبعتا الريال اليمني
-- -----------------------------------------------------------------------------
insert into public.currencies (code, name_ar, name_en, symbol, decimals) values
  ('YRO', 'ريال يمني (طبعة قديمة)', 'Yemeni Rial (old notes)', 'ر.ي.ق', 2),
  ('YRN', 'ريال يمني (طبعة جديدة)', 'Yemeni Rial (new notes)', 'ر.ي.ج', 2)
on conflict (code) do nothing;

-- -----------------------------------------------------------------------------
-- 2) صندوق أو محفظة بحساب مستقل
-- -----------------------------------------------------------------------------
alter table public.payment_methods add column requires_reference boolean not null default false;

-- حساب تفصيلي جديد بجوار حساب نظامي (نفس الحساب الأب)، برقم يلي آخر رقم بين إخوته
create or replace function app.add_sibling_account(p_hotel_id uuid, p_near_key text, p_name_ar text, p_name_en text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id   uuid;
  v_prev text := coalesce(current_setting('app.system_posting', true), 'off');
begin
  perform set_config('app.system_posting', 'on', true);
  insert into public.chart_of_accounts (hotel_id, code, name_ar, name_en, account_type, account_subtype, is_postable, parent_id)
  select p_hotel_id,
         coalesce((select max(code::bigint) + 1 from public.chart_of_accounts
                    where hotel_id = p_hotel_id and parent_id = p.id and code ~ '^[0-9]+$')::text, p.code || '01'),
         p_name_ar, p_name_en, p.account_type, 'current_asset', true, p.id
  from public.chart_of_accounts p
  where p.hotel_id = p_hotel_id and p.id = (select parent_id from public.chart_of_accounts where hotel_id = p_hotel_id and system_key = p_near_key)
  returning id into v_id;
  perform set_config('app.system_posting', v_prev, true);
  if v_id is null then
    raise exception 'System account "%" is not configured in the chart of accounts', p_near_key using errcode = '23514';
  end if;
  return v_id;
end;
$$;

create or replace function public.create_payment_box(
  p_hotel_id uuid, p_kind text, p_code text, p_name_ar text, p_name_en text default null,
  p_currency_code text default null, p_requires_reference boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_code text := upper(trim(coalesce(p_code, '')));
  v_name text := trim(coalesce(p_name_ar, ''));
  v_cur  text := nullif(upper(trim(coalesce(p_currency_code, ''))), '');
  v_acc  uuid;
  v_id   uuid;
begin
  perform app.require_permission(p_hotel_id, 'settings.revenue.manage');
  if p_kind not in ('cash', 'e_wallet', 'bank_transfer') then
    raise exception 'A box is a cash box, an e-wallet or a bank account' using errcode = '22023';
  end if;
  if v_code !~ '^[A-Z0-9_-]{1,20}$' then
    raise exception 'Code must be 1 to 20 English capital letters, digits, dash or underscore' using errcode = '22023';
  end if;
  if length(v_name) = 0 then
    raise exception 'Write the name' using errcode = '22023';
  end if;
  if exists (select 1 from public.payment_methods where hotel_id = p_hotel_id and code = v_code) then
    raise exception 'A payment method with code % already exists', v_code using errcode = '23505';
  end if;
  if v_cur = (select base_currency from public.hotels where id = p_hotel_id) then
    v_cur := null;
  end if;
  if v_cur is not null and not exists (select 1 from public.currencies where code = v_cur and is_active) then
    raise exception 'Unknown currency %', v_cur using errcode = '22023';
  end if;

  v_acc := app.add_sibling_account(p_hotel_id, case when p_kind = 'bank_transfer' then 'bank' else 'cash' end,
                                   v_name, nullif(trim(coalesce(p_name_en, '')), ''));
  insert into public.payment_methods (hotel_id, code, name_ar, name_en, kind, account_id, currency_code, requires_reference)
  values (p_hotel_id, v_code, v_name, nullif(trim(coalesce(p_name_en, '')), ''), p_kind::public.payment_method_kind, v_acc, v_cur,
          coalesce(p_requires_reference, false))
  returning id into v_id;
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 3) رقم العملية للمحافظ: إلزامي، ولا يتكرر لنفس الطريقة في المقبوضات القائمة
-- -----------------------------------------------------------------------------
create index folio_transactions_method_ref on public.folio_transactions (payment_method_id, upper(trim(reference)))
  where reference is not null;
create index payments_method_ref on public.payments (payment_method_id, upper(trim(reference)))
  where reference is not null;

create or replace function app.check_payment_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_method public.payment_methods%rowtype;
  v_ref    text := nullif(upper(trim(coalesce(new.reference, ''))), '');
  v_in     boolean;
begin
  if new.payment_method_id is null then
    return new;
  end if;
  if tg_table_name = 'folio_transactions' then
    -- الإلغاء يحمل بيانات الحركة الأصلية؛ والتحقق للحركات المالية فقط
    if new.direction <> 1 or new.txn_type not in ('payment', 'deposit', 'refund', 'deposit_refund') then
      return new;
    end if;
    v_in := new.txn_type in ('payment', 'deposit');
  else
    v_in := new.voucher_type = 'receipt';
  end if;
  select * into v_method from public.payment_methods where id = new.payment_method_id;
  if not coalesce(v_method.requires_reference, false) then
    return new;
  end if;
  if v_ref is null then
    raise exception 'Enter the transaction number for %', v_method.name_ar using errcode = '23514';
  end if;
  if v_in and (
       exists (select 1 from public.folio_transactions t
                where t.payment_method_id = new.payment_method_id and t.reference is not null
                  and upper(trim(t.reference)) = v_ref and t.direction = 1 and t.txn_type in ('payment', 'deposit')
                  and not exists (select 1 from public.folio_transactions r where r.related_transaction_id = t.id))
    or exists (select 1 from public.payments p
                where p.payment_method_id = new.payment_method_id and p.reference is not null
                  and upper(trim(p.reference)) = v_ref and p.voucher_type = 'receipt' and p.status = 'posted')) then
    raise exception 'Transaction number % was already used for %', trim(new.reference), v_method.name_ar using errcode = '23505';
  end if;
  return new;
end;
$$;

create trigger folio_transactions_check_reference before insert on public.folio_transactions
  for each row execute function app.check_payment_reference();
create trigger payments_check_reference before insert on public.payments
  for each row execute function app.check_payment_reference();

-- -----------------------------------------------------------------------------
-- 4) الوردية بعدة عملات
-- -----------------------------------------------------------------------------
create table public.cashier_shift_floats (
  shift_id           uuid not null references public.cashier_shifts(id) on delete cascade,
  hotel_id           uuid not null,
  payment_method_id  uuid not null,
  amount             numeric(19, 4) not null check (amount > 0),
  primary key (shift_id, payment_method_id),
  foreign key (hotel_id, payment_method_id) references public.payment_methods (hotel_id, id)
);
alter table public.cashier_shift_floats enable row level security;
create policy cashier_shift_floats_read on public.cashier_shift_floats for select to authenticated
  using (hotel_id in (select app.permitted_hotels('cashier.shifts.manage'))
         or exists (select 1 from public.cashier_shifts s where s.id = shift_id and s.user_id = (select auth.uid())));

alter table public.payments add column cashier_shift_id uuid;
alter table public.payments
  add constraint payments_shift_fk foreign key (hotel_id, cashier_shift_id) references public.cashier_shifts (hotel_id, id);
create index payments_shift on public.payments (cashier_shift_id) where cashier_shift_id is not null;
alter table public.fund_transfers add column cashier_shift_id uuid;
alter table public.fund_transfers
  add constraint fund_transfers_shift_fk foreign key (hotel_id, cashier_shift_id) references public.cashier_shifts (hotel_id, id);
create index fund_transfers_shift on public.fund_transfers (cashier_shift_id) where cashier_shift_id is not null;

-- السند أو التحويل يُنسب لوردية منشئه المفتوحة (إن وُجدت)
create or replace function app.attach_cashier_shift()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.cashier_shift_id is null and auth.uid() is not null then
    select id into new.cashier_shift_id from public.cashier_shifts
     where hotel_id = new.hotel_id and user_id = auth.uid() and status = 'open';
  end if;
  return new;
end;
$$;
create trigger payments_attach_shift before insert on public.payments
  for each row execute function app.attach_cashier_shift();
create trigger fund_transfers_attach_shift before insert on public.fund_transfers
  for each row execute function app.attach_cashier_shift();

drop function public.open_cashier_shift(uuid, numeric);
-- p_floats: [{payment_method_id, amount}] عهدة الصناديق الأخرى (الدولار، السعودي...) كلٌّ بعملته
create or replace function public.open_cashier_shift(p_hotel_id uuid, p_opening_float numeric default 0, p_floats jsonb default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id     uuid;
  v_float  uuid;
  v_line   jsonb;
  v_method public.payment_methods%rowtype;
  v_amount numeric;
  v_dec    smallint;
  v_seen   uuid[] := '{}';
begin
  perform app.require_permission(p_hotel_id, 'cashier.shifts');
  if exists (select 1 from public.cashier_shifts where hotel_id = p_hotel_id and user_id = auth.uid() and status = 'open') then
    raise exception 'You already have an open cashier shift' using errcode = '23505';
  end if;
  if coalesce(p_opening_float, 0) < 0 then
    raise exception 'Opening float cannot be negative' using errcode = '22023';
  end if;
  select id into v_float from public.payment_methods
   where hotel_id = p_hotel_id and kind = 'cash' and currency_code is null and is_active
   order by (code = 'CASH') desc, code limit 1;
  insert into public.cashier_shifts (hotel_id, shift_number, user_id, business_date, opening_float, float_method_id)
  values (p_hotel_id, app.next_document_number(p_hotel_id, 'cashier_shift', 'SHF', app.today_for_hotel(p_hotel_id)), auth.uid(),
          app.today_for_hotel(p_hotel_id), coalesce(p_opening_float, 0), v_float)
  returning id into v_id;

  if p_floats is not null and jsonb_typeof(p_floats) = 'array' then
    for v_line in select * from jsonb_array_elements(p_floats) loop
      v_amount := nullif(v_line ->> 'amount', '')::numeric;
      continue when v_amount is null or v_amount = 0;
      select * into v_method from public.payment_methods
       where id = (v_line ->> 'payment_method_id')::uuid and hotel_id = p_hotel_id and is_active and kind = 'cash';
      if v_method.id is null then
        raise exception 'Payment method not found or inactive' using errcode = '23503';
      end if;
      if v_method.id = v_float or v_method.id = any (v_seen) then
        raise exception 'Each cash box has one opening float' using errcode = '22023';
      end if;
      v_seen := v_seen || v_method.id;
      select decimals into v_dec from public.currencies
       where code = coalesce(v_method.currency_code, (select base_currency from public.hotels where id = p_hotel_id));
      if v_amount < 0 then
        raise exception 'Opening float cannot be negative' using errcode = '22023';
      end if;
      if round(v_amount, v_dec) <> v_amount then
        raise exception 'Amount must be positive with at most % decimals', v_dec using errcode = '22023';
      end if;
      insert into public.cashier_shift_floats (shift_id, hotel_id, payment_method_id, amount)
      values (v_id, p_hotel_id, v_method.id, v_amount);
    end loop;
  end if;
  return v_id;
end;
$$;
revoke all on function public.open_cashier_shift(uuid, numeric, jsonb) from public, anon;
grant execute on function public.open_cashier_shift(uuid, numeric, jsonb) to authenticated;

-- ملخص الوردية لكل صندوق بعملته: العهدة + المقبوض − المدفوع = المتوقع
-- المصادر: حركات الفوليو، وسندات القبض والصرف، وسندات التحويل التي أُنشئت أثناء الوردية
create or replace function public.cashier_shift_report(p_shift_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_s public.cashier_shifts%rowtype;
begin
  select * into v_s from public.cashier_shifts where id = p_shift_id;
  if v_s.id is null or not app.can_see_shift(v_s) then
    raise exception 'Cashier shift not found' using errcode = '23503';
  end if;
  return jsonb_build_object(
    'shift', jsonb_build_object(
      'id', v_s.id, 'shift_number', v_s.shift_number, 'status', v_s.status, 'business_date', v_s.business_date,
      'opened_at', v_s.opened_at, 'closed_at', v_s.closed_at, 'opening_float', v_s.opening_float, 'closing_note', v_s.closing_note,
      'user_id', v_s.user_id, 'is_mine', v_s.user_id = auth.uid(),
      'user_name', coalesce((select full_name from public.users_profiles where id = v_s.user_id), ''),
      'over_short_entry_id', v_s.over_short_entry_id),
    'methods', coalesce((
      with mv as (
        select ft.payment_method_id as method_id,
               case when ft.txn_type in ('payment', 'deposit') then coalesce(ft.foreign_amount, ft.total_amount) * ft.direction else 0 end as rin,
               case when ft.txn_type in ('refund', 'deposit_refund') then coalesce(ft.foreign_amount, ft.total_amount) * ft.direction else 0 end as rout,
               ft.total_amount * ft.direction * case when ft.txn_type in ('payment', 'deposit') then 1 else -1 end as base
        from public.folio_transactions ft
        where ft.cashier_shift_id = v_s.id and ft.payment_method_id is not null
        union all
        select p.payment_method_id,
               case when p.voucher_type = 'receipt' then p.amount else 0 end,
               case when p.voucher_type = 'disbursement' then p.amount else 0 end,
               case when p.voucher_type = 'receipt' then p.amount else -p.amount end
        from public.payments p where p.cashier_shift_id = v_s.id and p.status = 'posted'
        union all
        select f.from_method_id, 0, f.from_amount, -f.base_from
        from public.fund_transfers f where f.cashier_shift_id = v_s.id and f.status = 'posted'
        union all
        select f.to_method_id, f.to_amount, 0, f.base_to
        from public.fund_transfers f where f.cashier_shift_id = v_s.id and f.status = 'posted'
      ),
      t as (
        select method_id, sum(rin) as receipts, sum(rout) as payouts, sum(base) as base_net, count(*) as n from mv group by method_id
      )
      select jsonb_agg(x order by (x ->> 'foreign')::boolean, x ->> 'code') from (
        select jsonb_build_object(
          'payment_method_id', m.id, 'code', m.code, 'name', m.name_ar, 'kind', m.kind,
          'currency_code', coalesce(m.currency_code, h.base_currency), 'foreign', m.currency_code is not null,
          'float', fl.amount,
          'receipts', coalesce(t.receipts, 0), 'payouts', coalesce(t.payouts, 0),
          'expected', coalesce(c.expected, fl.amount + coalesce(t.receipts, 0) - coalesce(t.payouts, 0)),
          'base_total', coalesce(t.base_net, 0), 'count', coalesce(t.n, 0),
          'counted', c.counted, 'difference', c.difference, 'difference_base', c.difference_base) as x
        from public.payment_methods m
        join public.hotels h on h.id = m.hotel_id
        cross join lateral (
          select case when m.id = v_s.float_method_id then v_s.opening_float
                      else coalesce((select f.amount from public.cashier_shift_floats f where f.shift_id = v_s.id and f.payment_method_id = m.id), 0) end as amount
        ) fl
        left join t on t.method_id = m.id
        left join public.cashier_shift_counts c on c.shift_id = v_s.id and c.payment_method_id = m.id
        where m.hotel_id = v_s.hotel_id
          and (t.method_id is not null or c.shift_id is not null or m.id = v_s.float_method_id or fl.amount <> 0)
      ) q), '[]'::jsonb),
    'transactions', coalesce((
      select jsonb_agg(z order by z ->> 'created_at') from (
        select jsonb_build_object(
          'id', ft.id, 'source', 'folio', 'created_at', ft.created_at, 'txn_type', ft.txn_type, 'direction', ft.direction,
          'method', m.name_ar, 'amount', ft.total_amount, 'foreign_amount', ft.foreign_amount, 'currency_code', ft.currency_code,
          'folio_id', f.id, 'folio_number', f.folio_number, 'guest_name', f.guest_name, 'room_number', f.room_number,
          'reference', ft.reference) as z
        from public.folio_transactions ft
        join public.guest_folios f on f.id = ft.folio_id
        join public.payment_methods m on m.id = ft.payment_method_id
        where ft.cashier_shift_id = v_s.id
        union all
        select jsonb_build_object(
          'id', p.id, 'source', 'voucher', 'created_at', p.created_at, 'txn_type', p.voucher_type::text, 'direction', 1,
          'method', m.name_ar, 'amount', p.amount,
          'foreign_amount', null, 'currency_code', null,
          'folio_id', null, 'folio_number', p.voucher_number, 'guest_name', coalesce(nullif(p.party_name, ''), p.description), 'room_number', null,
          'reference', p.reference)
        from public.payments p
        join public.payment_methods m on m.id = p.payment_method_id
        where p.cashier_shift_id = v_s.id and p.status = 'posted'
        union all
        select jsonb_build_object(
          'id', f.id::text || s.side, 'source', 'transfer', 'created_at', f.created_at, 'txn_type', 'transfer_' || s.side, 'direction', 1,
          'method', m.name_ar,
          'amount', case when s.side = 'out' then f.base_from else f.base_to end,
          'foreign_amount', case when s.side = 'out' and f.from_currency <> h.base_currency then f.from_amount
                                 when s.side = 'in' and f.to_currency <> h.base_currency then f.to_amount end,
          'currency_code', case when s.side = 'out' and f.from_currency <> h.base_currency then f.from_currency
                                when s.side = 'in' and f.to_currency <> h.base_currency then f.to_currency end,
          'folio_id', null, 'folio_number', f.transfer_number, 'guest_name', coalesce(f.description, ''), 'room_number', null,
          'reference', null)
        from public.fund_transfers f
        join public.hotels h on h.id = f.hotel_id
        cross join (values ('out'), ('in')) s(side)
        join public.payment_methods m on m.id = case when s.side = 'out' then f.from_method_id else f.to_method_id end
        where f.cashier_shift_id = v_s.id and f.status = 'posted'
      ) q), '[]'::jsonb)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 5) تقرير النقدية بالعملات
--   الصناديق والمحافظ والبنوك بالعملة الأساسية: من الأستاذ العام لحساب الطريقة، بعد استبعاد ما دخله
--   بعملات أجنبية. وبالعملات الأجنبية: بوحدات العملة نفسها من حركات الفوليو والتحويلات وفروقات العدّ
--   والقيود اليدوية بتلك العملة، ومعادلها بسعر آخر يوم في الفترة.
-- -----------------------------------------------------------------------------
create or replace function public.cash_by_currency(p_hotel_id uuid, p_from date, p_to date)
returns table (account_id uuid, account_code text, account_name text, currency_code text, is_base boolean, methods text,
               opening numeric, receipts numeric, payments numeric, closing numeric, rate numeric, closing_base numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_base char(3);
  v_dec  smallint;
begin
  perform app.require_permission(p_hotel_id, 'reports.cash.view');
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'Invalid date range' using errcode = '22023';
  end if;
  select base_currency into v_base from public.hotels where id = p_hotel_id;
  v_dec := app.currency_decimals(p_hotel_id);

  return query
  with m as (
    select pm.id, pm.account_id, pm.currency_code::text as cur, pm.name_ar, pm.is_active
    from public.payment_methods pm
    join public.chart_of_accounts ca on ca.id = pm.account_id
    -- حساب تحصيل البطاقات ليس نقدية (المحفظة العامة الافتراضية مربوطة به)
    where pm.hotel_id = p_hotel_id and pm.kind in ('cash', 'e_wallet', 'bank_transfer') and ca.system_key is distinct from 'card_clearing'
  ),
  accts as (select distinct m.account_id from m),
  -- حركات العملات الأجنبية: الوحدات (u) وقيمتها التاريخية بالعملة الأساسية (b)
  fx as (
    select pm.account_id, pm.cur, ft.business_date as d,
           coalesce(ft.foreign_amount, ft.total_amount) * ft.direction * case when ft.txn_type in ('payment', 'deposit') then 1 else -1 end as u,
           ft.total_amount * ft.direction * case when ft.txn_type in ('payment', 'deposit') then 1 else -1 end as b
    from public.folio_transactions ft join m pm on pm.id = ft.payment_method_id and pm.cur is not null
    where ft.hotel_id = p_hotel_id and ft.txn_type in ('payment', 'deposit', 'refund', 'deposit_refund')
    union all
    select pm.account_id, pm.cur, f.transfer_date, -f.from_amount, -f.base_from
    from public.fund_transfers f join m pm on pm.id = f.from_method_id and pm.cur is not null where f.hotel_id = p_hotel_id
    union all
    select pm.account_id, pm.cur, rj.entry_date, f.from_amount, f.base_from
    from public.fund_transfers f join m pm on pm.id = f.from_method_id and pm.cur is not null
    join public.journal_entries rj on rj.id = f.reversal_entry_id
    where f.hotel_id = p_hotel_id and f.status = 'voided'
    union all
    select pm.account_id, pm.cur, f.transfer_date, f.to_amount, f.base_to
    from public.fund_transfers f join m pm on pm.id = f.to_method_id and pm.cur is not null where f.hotel_id = p_hotel_id
    union all
    select pm.account_id, pm.cur, rj.entry_date, -f.to_amount, -f.base_to
    from public.fund_transfers f join m pm on pm.id = f.to_method_id and pm.cur is not null
    join public.journal_entries rj on rj.id = f.reversal_entry_id
    where f.hotel_id = p_hotel_id and f.status = 'voided'
    union all
    select pm.account_id, pm.cur, coalesce(j.entry_date, s.business_date), c.difference, c.difference_base
    from public.cashier_shift_counts c
    join public.cashier_shifts s on s.id = c.shift_id
    join m pm on pm.id = c.payment_method_id and pm.cur is not null
    left join public.journal_entries j on j.id = s.over_short_entry_id
    where c.hotel_id = p_hotel_id and c.difference <> 0
    union all
    select l.account_id, j.currency_code::text, j.entry_date, l.debit - l.credit, l.base_debit - l.base_credit
    from public.journal_entry_lines l
    join public.journal_entries j on j.id = l.journal_entry_id and j.status = 'posted'
    where l.hotel_id = p_hotel_id and j.currency_code <> v_base and l.account_id in (select a.account_id from accts a)
  ),
  -- الحسابات التي عليها طريقة بالعملة الأساسية: رصيد الأستاذ ناقص ما دخلها بعملات أجنبية
  base_accts as (select distinct m.account_id from m where m.cur is null),
  bm as (
    select l.account_id, j.entry_date as d, l.base_debit as dr, l.base_credit as cr
    from public.journal_entry_lines l
    join public.journal_entries j on j.id = l.journal_entry_id and j.status = 'posted'
    where l.hotel_id = p_hotel_id and l.account_id in (select a.account_id from base_accts a)
    union all
    select fx.account_id, fx.d, -greatest(fx.b, 0), -greatest(-fx.b, 0)
    from fx where fx.account_id in (select a.account_id from base_accts a)
  ),
  rows_ as (
    select bm.account_id, v_base::text as cur, true as is_base,
           coalesce(sum(bm.dr - bm.cr) filter (where bm.d < p_from), 0) as op,
           coalesce(sum(bm.dr) filter (where bm.d between p_from and p_to), 0) as rin,
           coalesce(sum(bm.cr) filter (where bm.d between p_from and p_to), 0) as rout
    from bm group by bm.account_id
    union all
    select a.account_id, v_base::text, true, 0, 0, 0
    from base_accts a where not exists (select 1 from bm where bm.account_id = a.account_id)
    union all
    select fx.account_id, fx.cur, false,
           coalesce(sum(fx.u) filter (where fx.d < p_from), 0),
           coalesce(sum(greatest(fx.u, 0)) filter (where fx.d between p_from and p_to), 0),
           coalesce(sum(greatest(-fx.u, 0)) filter (where fx.d between p_from and p_to), 0)
    from fx group by fx.account_id, fx.cur
    union all
    select m.account_id, m.cur, false, 0, 0, 0
    from m where m.cur is not null and not exists (select 1 from fx where fx.account_id = m.account_id and fx.cur = m.cur)
    group by m.account_id, m.cur
  )
  select r.account_id, a.code::text, a.name_ar::text, r.cur, r.is_base,
         (select string_agg(m.name_ar, '، ' order by m.name_ar) from m
           where m.account_id = r.account_id and coalesce(m.cur, v_base::text) = r.cur),
         round(r.op, 4), round(r.rin, 4), round(r.rout, 4), round(r.op + r.rin - r.rout, 4),
         case when r.is_base then 1::numeric
              else (select x.rate from public.exchange_rates x where x.hotel_id = p_hotel_id and x.currency_code = r.cur
                     and x.rate_date <= p_to order by x.rate_date desc limit 1) end,
         case when r.is_base then round(r.op + r.rin - r.rout, v_dec)
              else round((r.op + r.rin - r.rout) * (select x.rate from public.exchange_rates x where x.hotel_id = p_hotel_id
                     and x.currency_code = r.cur and x.rate_date <= p_to order by x.rate_date desc limit 1), v_dec) end
  from rows_ r
  join public.chart_of_accounts a on a.id = r.account_id
  where r.op <> 0 or r.rin <> 0 or r.rout <> 0
     or exists (select 1 from m where m.account_id = r.account_id and coalesce(m.cur, v_base::text) = r.cur and m.is_active)
  order by r.is_base desc, r.cur, a.code;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.create_payment_box(uuid, text, text, text, text, text, boolean)',
    'public.cash_by_currency(uuid, date, date)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function app.add_sibling_account(uuid, text, text, text) from public, anon, authenticated;
