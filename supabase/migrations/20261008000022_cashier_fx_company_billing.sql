-- =============================================================================
-- المرحلة الثالثة: الصندوق والدفع
--   1) الدفع بالعملات الأجنبية: طريقة دفع بعملة (دولار، ريال سعودي...) وسعر صرف يومي؛
--      المبلغ الأجنبي يُحفظ مع الحركة ويُقيَّد بما يعادله بالعملة الأساسية.
--   2) ورديات الكاشير: فتح بعهدة، كل حركة نقدية على الفوليو تُنسب لوردية موظفها،
--      والإغلاق بعدّ الصناديق وقيد العجز/الزيادة آليًا.
--   3) فوترة الشركات: الحجز يُفوتر للنزيل، أو الإقامة فقط على الشركة، أو كل الفاتورة
--      على الشركة (آجل City Ledger) — تُسوّى تلقائيًا عند المغادرة وتصدر الفاتورة باسم الشركة.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) العملات الأجنبية
-- -----------------------------------------------------------------------------
alter table public.payment_methods add column currency_code char(3) references public.currencies(code);

alter table public.folio_transactions
  add column currency_code    char(3) references public.currencies(code),
  add column foreign_amount   numeric(19, 4) check (foreign_amount > 0),
  add column exchange_rate    numeric(20, 10) check (exchange_rate > 0),
  add column cashier_shift_id uuid;

create or replace function app.payment_methods_currency_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.currency_code is not null then
    if new.currency_code = (select base_currency from public.hotels where id = new.hotel_id) then
      new.currency_code := null;
    elsif new.kind = 'city_ledger' then
      raise exception 'Credit (city ledger) is always in the base currency' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'UPDATE' and new.currency_code is distinct from old.currency_code
     and (exists (select 1 from public.folio_transactions where payment_method_id = old.id)
          or exists (select 1 from public.payments where payment_method_id = old.id)) then
    raise exception 'Payment method is already used; its currency cannot change (create a new method instead)'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger payment_methods_currency_check before insert or update of currency_code, kind on public.payment_methods
  for each row execute function app.payment_methods_currency_check();

-- سعر الصرف الساري: آخر سعر مسجّل في التاريخ أو قبله
create or replace function app.fx_rate(p_hotel_id uuid, p_currency char(3), p_date date)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v numeric;
begin
  select rate into v from public.exchange_rates
   where hotel_id = p_hotel_id and currency_code = p_currency and rate_date <= p_date
   order by rate_date desc limit 1;
  if v is null then
    raise exception 'No exchange rate for % on or before %', p_currency, p_date using errcode = '23514';
  end if;
  return v;
end;
$$;

create or replace function public.set_exchange_rate(p_hotel_id uuid, p_currency_code text, p_rate numeric, p_rate_date date default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_permission(p_hotel_id, 'settings.currencies.manage');
  if p_rate is null or p_rate <= 0 then
    raise exception 'Exchange rate must be positive' using errcode = '22023';
  end if;
  if upper(p_currency_code) = (select base_currency from public.hotels where id = p_hotel_id) then
    raise exception 'The base currency has no exchange rate' using errcode = '22023';
  end if;
  insert into public.exchange_rates (hotel_id, currency_code, rate_date, rate)
  values (p_hotel_id, upper(p_currency_code), coalesce(p_rate_date, app.today_for_hotel(p_hotel_id)), p_rate)
  on conflict (hotel_id, currency_code, rate_date) do update set rate = excluded.rate;
end;
$$;

-- طرق الدفع بعملة أجنبية تُستخدم عبر دالة المبلغ الأجنبي فقط (لا تختلط المبالغ)
create or replace function app.active_payment_method(p_hotel_id uuid, p_method_id uuid)
returns public.payment_methods
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.payment_methods%rowtype;
begin
  select * into v from public.payment_methods where id = p_method_id and hotel_id = p_hotel_id and is_active;
  if not found then
    raise exception 'Payment method not found or inactive' using errcode = '23503';
  end if;
  if v.currency_code is not null and coalesce(current_setting('app.fx_amount', true), '') = '' then
    raise exception 'Enter the amount in % for this payment method', v.currency_code using errcode = '23514';
  end if;
  return v;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2) ورديات الكاشير
-- -----------------------------------------------------------------------------
alter type public.journal_source add value if not exists 'cashier_shift';

alter table public.hotels add column require_cashier_shift boolean not null default false;

create table public.cashier_shifts (
  id                   uuid primary key default gen_random_uuid(),
  hotel_id             uuid not null references public.hotels(id) on delete cascade,
  shift_number         text not null,
  user_id              uuid not null references auth.users(id),
  business_date        date not null,
  opened_at            timestamptz not null default now(),
  opening_float        numeric(19, 4) not null default 0 check (opening_float >= 0),
  -- صندوق العهدة (طريقة الدفع النقدية الأساسية)
  float_method_id      uuid,
  status               text not null default 'open' check (status in ('open', 'closed')),
  closed_at            timestamptz,
  closed_by            uuid references auth.users(id),
  closing_note         text,
  over_short_entry_id  uuid references public.journal_entries(id),
  unique (hotel_id, shift_number),
  unique (hotel_id, id),
  foreign key (hotel_id, float_method_id) references public.payment_methods (hotel_id, id)
);
create unique index cashier_shifts_one_open on public.cashier_shifts (hotel_id, user_id) where status = 'open';
create index cashier_shifts_hotel_opened on public.cashier_shifts (hotel_id, opened_at desc);

create table public.cashier_shift_counts (
  shift_id           uuid not null references public.cashier_shifts(id) on delete cascade,
  hotel_id           uuid not null,
  payment_method_id  uuid not null,
  currency_code      char(3) references public.currencies(code),
  expected           numeric(19, 4) not null,
  counted            numeric(19, 4) not null check (counted >= 0),
  difference         numeric(19, 4) generated always as (counted - expected) stored,
  -- الفرق بالعملة الأساسية (للعملات الأجنبية بسعر يوم الإغلاق)
  difference_base    numeric(19, 4) not null default 0,
  primary key (shift_id, payment_method_id),
  foreign key (hotel_id, payment_method_id) references public.payment_methods (hotel_id, id)
);

alter table public.folio_transactions
  add constraint folio_transactions_shift_fk foreign key (hotel_id, cashier_shift_id) references public.cashier_shifts (hotel_id, id);
create index folio_transactions_shift on public.folio_transactions (cashier_shift_id) where cashier_shift_id is not null;

insert into public.permissions (code, module, action, name_ar, name_en, sort_order, product) values
  ('cashier.shifts',        'cashier', 'manage', 'فتح وإغلاق وردية الكاشير',             'Open / close own cashier shift', 700, 'core'),
  ('cashier.shifts.manage', 'cashier', 'approve', 'عرض كل الورديات وإغلاقها ومراجعتها',  'Review & close all shifts',      710, 'core');

insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r cross join public.permissions p
where r.is_system and p.module = 'cashier' and (
  r.code in ('general_manager', 'accountant')
  or (r.code in ('cashier', 'receptionist') and p.code = 'cashier.shifts')
  or (r.code = 'auditor' and p.code = 'cashier.shifts.manage')
)
on conflict do nothing;

-- كل حركة مالية على الفوليو: تُنسب لوردية الموظف المفتوحة، وتحمل بيانات العملة الأجنبية
create or replace function app.folio_transactions_money_meta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_method public.payment_methods%rowtype;
  v_orig   public.folio_transactions%rowtype;
begin
  if new.payment_method_id is null then
    return new;
  end if;
  select * into v_method from public.payment_methods where id = new.payment_method_id;

  if new.direction = -1 and new.related_transaction_id is not null then
    -- إلغاء حركة: نفس عملتها ومبلغها الأجنبي
    select * into v_orig from public.folio_transactions where id = new.related_transaction_id;
    new.currency_code := v_orig.currency_code;
    new.foreign_amount := v_orig.foreign_amount;
    new.exchange_rate := v_orig.exchange_rate;
  elsif v_method.currency_code is not null then
    new.currency_code := v_method.currency_code;
    new.foreign_amount := nullif(current_setting('app.fx_amount', true), '')::numeric;
    new.exchange_rate := nullif(current_setting('app.fx_rate', true), '')::numeric;
    if new.foreign_amount is null or new.exchange_rate is null then
      raise exception 'Enter the amount in % for this payment method', v_method.currency_code using errcode = '23514';
    end if;
  end if;

  -- الإلغاء يعود لوردية الحركة الأصلية ما دامت مفتوحة، وإلا لوردية من يلغيها
  if v_orig.cashier_shift_id is not null
     and exists (select 1 from public.cashier_shifts where id = v_orig.cashier_shift_id and status = 'open') then
    new.cashier_shift_id := v_orig.cashier_shift_id;
  else
    select id into new.cashier_shift_id from public.cashier_shifts
     where hotel_id = new.hotel_id and user_id = auth.uid() and status = 'open';
  end if;
  if new.cashier_shift_id is null and v_method.kind = 'cash'
     and (select require_cashier_shift from public.hotels where id = new.hotel_id) then
    raise exception 'Open a cashier shift before receiving or paying cash' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger folio_transactions_money_meta before insert on public.folio_transactions
  for each row execute function app.folio_transactions_money_meta();

-- حركة بمبلغ أجنبي: يُحوَّل بسعر اليوم ويُقيَّد المعادل بالعملة الأساسية
create or replace function public.post_folio_foreign_money(
  p_folio_id uuid, p_txn_type text, p_payment_method_id uuid, p_foreign_amount numeric, p_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_folio  public.guest_folios%rowtype;
  v_method public.payment_methods%rowtype;
  v_date   date;
  v_rate   numeric;
  v_base   numeric;
  v_fdec   smallint;
  v_id     uuid;
begin
  select * into v_folio from public.guest_folios where id = p_folio_id;
  if v_folio.id is null then
    raise exception 'Folio not found' using errcode = '23503';
  end if;
  if p_txn_type not in ('payment', 'deposit', 'refund', 'deposit_refund') then
    raise exception 'Unsupported money transaction type %', p_txn_type using errcode = '22023';
  end if;
  select * into v_method from public.payment_methods where id = p_payment_method_id and hotel_id = v_folio.hotel_id and is_active;
  if v_method.id is null then
    raise exception 'Payment method not found or inactive' using errcode = '23503';
  end if;
  if v_method.currency_code is null then
    raise exception 'Payment method % is in the base currency', v_method.code using errcode = '22023';
  end if;
  select decimals into v_fdec from public.currencies where code = v_method.currency_code;
  if p_foreign_amount is null or p_foreign_amount <= 0 or round(p_foreign_amount, v_fdec) <> p_foreign_amount then
    raise exception 'Amount must be positive with at most % decimals', v_fdec using errcode = '22023';
  end if;
  v_date := app.today_for_hotel(v_folio.hotel_id);
  v_rate := app.fx_rate(v_folio.hotel_id, v_method.currency_code, v_date);
  v_base := round(p_foreign_amount * v_rate, app.currency_decimals(v_folio.hotel_id));

  perform set_config('app.fx_amount', p_foreign_amount::text, true);
  perform set_config('app.fx_rate', v_rate::text, true);
  v_id := app.post_folio_money(p_folio_id, p_txn_type::public.folio_txn_type, p_payment_method_id, v_base, v_date, p_reference,
    v_method.name_ar || ' ' || trim(to_char(p_foreign_amount, 'FM999999999990.00')) || ' ' || v_method.currency_code
      || ' × ' || trim(to_char(v_rate, 'FM999999990.0999')), null);
  perform set_config('app.fx_amount', '', true);
  perform set_config('app.fx_rate', '', true);
  return v_id;
end;
$$;

-- عربون الحجز بعملة أجنبية (يفتح فوليو الحجز عند الحاجة)
create or replace function public.record_reservation_deposit_fx(
  p_reservation_id uuid, p_payment_method_id uuid, p_foreign_amount numeric, p_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.reservations%rowtype;
begin
  select * into v_r from public.reservations where id = p_reservation_id for update;
  if v_r.id is null then
    raise exception 'Reservation not found' using errcode = '23503';
  end if;
  perform app.require_permission(v_r.hotel_id, 'pms.reservations.manage');
  if v_r.status not in ('tentative', 'confirmed', 'checked_in') then
    raise exception 'Deposits are recorded on active reservations only' using errcode = '23514';
  end if;
  return public.post_folio_foreign_money(app.pms_ensure_folio(v_r.id), 'deposit', p_payment_method_id, p_foreign_amount, p_reference);
end;
$$;

-- فتح الوردية بعهدة نقدية
create or replace function public.open_cashier_shift(p_hotel_id uuid, p_opening_float numeric default 0)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform app.require_permission(p_hotel_id, 'cashier.shifts');
  if exists (select 1 from public.cashier_shifts where hotel_id = p_hotel_id and user_id = auth.uid() and status = 'open') then
    raise exception 'You already have an open cashier shift' using errcode = '23505';
  end if;
  if coalesce(p_opening_float, 0) < 0 then
    raise exception 'Opening float cannot be negative' using errcode = '22023';
  end if;
  insert into public.cashier_shifts (hotel_id, shift_number, user_id, business_date, opening_float, float_method_id)
  values (p_hotel_id, app.next_document_number(p_hotel_id, 'cashier_shift', 'SHF', app.today_for_hotel(p_hotel_id)), auth.uid(),
          app.today_for_hotel(p_hotel_id), coalesce(p_opening_float, 0),
          (select id from public.payment_methods where hotel_id = p_hotel_id and kind = 'cash' and currency_code is null and is_active
            order by (code = 'CASH') desc, code limit 1))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function app.can_see_shift(p_shift public.cashier_shifts)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (p_shift.user_id = auth.uid() and app.has_permission(p_shift.hotel_id, 'cashier.shifts'))
      or app.has_permission(p_shift.hotel_id, 'cashier.shifts.manage');
$$;

-- ملخص الوردية لكل طريقة دفع: العهدة + المقبوض − المدفوع = المتوقع في الصندوق
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
      select jsonb_agg(x order by x ->> 'code') from (
        select jsonb_build_object(
          'payment_method_id', m.id, 'code', m.code, 'name', m.name_ar, 'kind', m.kind,
          'currency_code', coalesce(m.currency_code, h.base_currency), 'foreign', m.currency_code is not null,
          'float', case when m.id = v_s.float_method_id then v_s.opening_float else 0 end,
          'receipts', coalesce(t.receipts, 0), 'payouts', coalesce(t.payouts, 0),
          'expected', case when m.id = v_s.float_method_id then v_s.opening_float else 0 end + coalesce(t.receipts, 0) - coalesce(t.payouts, 0),
          'base_total', coalesce(t.base_net, 0), 'count', coalesce(t.n, 0),
          'counted', c.counted, 'difference', c.difference, 'difference_base', c.difference_base) as x
        from public.payment_methods m
        join public.hotels h on h.id = m.hotel_id
        left join (
          select ft.payment_method_id,
                 sum(case when ft.txn_type in ('payment', 'deposit') then coalesce(ft.foreign_amount, ft.total_amount) * ft.direction else 0 end) as receipts,
                 sum(case when ft.txn_type in ('refund', 'deposit_refund') then coalesce(ft.foreign_amount, ft.total_amount) * ft.direction else 0 end) as payouts,
                 sum(ft.total_amount * ft.direction * case when ft.txn_type in ('payment', 'deposit') then 1 else -1 end) as base_net,
                 count(*) as n
          from public.folio_transactions ft
          where ft.cashier_shift_id = v_s.id
          group by ft.payment_method_id
        ) t on t.payment_method_id = m.id
        left join public.cashier_shift_counts c on c.shift_id = v_s.id and c.payment_method_id = m.id
        where m.hotel_id = v_s.hotel_id
          and (t.payment_method_id is not null or c.shift_id is not null or m.id = v_s.float_method_id)
      ) q), '[]'::jsonb),
    'transactions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ft.id, 'created_at', ft.created_at, 'txn_type', ft.txn_type, 'direction', ft.direction,
        'method', m.name_ar, 'amount', ft.total_amount, 'foreign_amount', ft.foreign_amount, 'currency_code', ft.currency_code,
        'folio_id', f.id, 'folio_number', f.folio_number, 'guest_name', f.guest_name, 'room_number', f.room_number,
        'reference', ft.reference) order by ft.created_at)
      from public.folio_transactions ft
      join public.guest_folios f on f.id = ft.folio_id
      join public.payment_methods m on m.id = ft.payment_method_id
      where ft.cashier_shift_id = v_s.id), '[]'::jsonb)
  );
end;
$$;

-- حساب عجز وزيادة الصندوق (يُنشأ عند أول حاجة)
create or replace function app.cash_over_short_account(p_hotel_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.chart_of_accounts where hotel_id = p_hotel_id and system_key = 'cash_over_short';
  if v_id is null then
    perform set_config('app.system_posting', 'on', true);
    insert into public.chart_of_accounts
      (hotel_id, code, name_ar, name_en, account_type, account_subtype, is_postable, system_key, parent_id)
    select p_hotel_id,
           coalesce((select max(code::bigint) + 1 from public.chart_of_accounts
                      where hotel_id = p_hotel_id and parent_id = p.id and code ~ '^[0-9]+$')::text, p.code || '01'),
           'عجز وزيادة الصندوق', 'Cash Over / Short', 'expense', 'other_expense', true, 'cash_over_short', p.id
    from public.chart_of_accounts p
    where p.hotel_id = p_hotel_id and p.id = (select parent_id from public.chart_of_accounts where hotel_id = p_hotel_id and system_key = 'fx_loss')
    returning id into v_id;
    perform set_config('app.system_posting', 'off', true);
  end if;
  return v_id;
end;
$$;

-- إغلاق الوردية: عدّ كل صندوق، الفرق يُقيَّد (عجز: مدين عجز وزيادة / دائن الصندوق، والعكس للزيادة)
create or replace function public.close_cashier_shift(p_shift_id uuid, p_counts jsonb, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_s      public.cashier_shifts%rowtype;
  v_rep    jsonb;
  v_m      jsonb;
  v_count  numeric;
  v_diff   numeric;
  v_base   numeric;
  v_dec    smallint;
  v_today  date;
  v_lines  jsonb := '[]'::jsonb;
  v_total  numeric := 0;
  v_acct   uuid;
  v_je     uuid;
begin
  select * into v_s from public.cashier_shifts where id = p_shift_id for update;
  if v_s.id is null or not app.can_see_shift(v_s) then
    raise exception 'Cashier shift not found' using errcode = '23503';
  end if;
  if v_s.status <> 'open' then
    raise exception 'Cashier shift is already closed' using errcode = '23514';
  end if;
  if v_s.user_id <> auth.uid() and not app.has_permission(v_s.hotel_id, 'cashier.shifts.manage') then
    raise exception 'Only the shift owner or a supervisor can close this shift' using errcode = '42501';
  end if;
  v_rep := public.cashier_shift_report(p_shift_id);
  v_dec := app.currency_decimals(v_s.hotel_id);
  v_today := app.today_for_hotel(v_s.hotel_id);

  for v_m in select * from jsonb_array_elements(v_rep -> 'methods') loop
    -- الصناديق النقدية تُعدّ إلزاميًا؛ غيرها (بطاقات وتحويلات) تُطابق مع كشف الجهاز/البنك
    select nullif(e ->> 'counted', '')::numeric into v_count
    from jsonb_array_elements(coalesce(p_counts, '[]'::jsonb)) e
    where (e ->> 'payment_method_id')::uuid = (v_m ->> 'payment_method_id')::uuid;
    if v_count is null then
      if v_m ->> 'kind' = 'cash' then
        raise exception 'Count the cash in % before closing', v_m ->> 'name' using errcode = '23514';
      end if;
      v_count := (v_m ->> 'expected')::numeric;
    end if;
    if v_count < 0 then
      raise exception 'Counted amount cannot be negative' using errcode = '22023';
    end if;
    v_diff := v_count - (v_m ->> 'expected')::numeric;
    v_base := case when (v_m ->> 'foreign')::boolean
                   then round(v_diff * app.fx_rate(v_s.hotel_id, v_m ->> 'currency_code', v_today), v_dec)
                   else round(v_diff, v_dec) end;
    insert into public.cashier_shift_counts (shift_id, hotel_id, payment_method_id, currency_code, expected, counted, difference_base)
    values (v_s.id, v_s.hotel_id, (v_m ->> 'payment_method_id')::uuid,
            case when (v_m ->> 'foreign')::boolean then v_m ->> 'currency_code' end,
            (v_m ->> 'expected')::numeric, v_count, v_base);
    if v_base <> 0 then
      v_acct := (select account_id from public.payment_methods where id = (v_m ->> 'payment_method_id')::uuid);
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', v_acct,
        case when v_base > 0 then 'debit' else 'credit' end, abs(v_base),
        'description', (case when v_base > 0 then 'زيادة ' else 'عجز ' end) || (v_m ->> 'name')));
      v_total := v_total + v_base;
    end if;
  end loop;

  if jsonb_array_length(v_lines) > 0 then
    if v_total <> 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', app.cash_over_short_account(v_s.hotel_id),
        case when v_total > 0 then 'credit' else 'debit' end, abs(v_total)));
    end if;
    v_je := app.post_system_entry(v_s.hotel_id, v_today,
      'فروقات إغلاق وردية الكاشير ' || v_s.shift_number, 'cashier_shift', v_s.id, v_s.shift_number, v_lines);
  end if;

  update public.cashier_shifts
     set status = 'closed', closed_at = now(), closed_by = auth.uid(), closing_note = nullif(trim(p_note), ''),
         over_short_entry_id = v_je
   where id = v_s.id;
  return public.cashier_shift_report(p_shift_id);
end;
$$;

alter table public.cashier_shifts enable row level security;
alter table public.cashier_shift_counts enable row level security;

create policy cashier_shifts_read on public.cashier_shifts for select to authenticated
  using ((user_id = (select auth.uid()) and hotel_id in (select app.permitted_hotels('cashier.shifts')))
         or hotel_id in (select app.permitted_hotels('cashier.shifts.manage')));
create policy cashier_shift_counts_read on public.cashier_shift_counts for select to authenticated
  using (hotel_id in (select app.permitted_hotels('cashier.shifts.manage'))
         or exists (select 1 from public.cashier_shifts s where s.id = shift_id and s.user_id = (select auth.uid())));

create trigger audit_cashier_shifts after insert or update or delete on public.cashier_shifts
  for each row execute function app.audit_trigger();

-- -----------------------------------------------------------------------------
-- 3) فوترة الشركات
-- -----------------------------------------------------------------------------
alter table public.reservations
  add column bill_to text not null default 'guest' check (bill_to in ('guest', 'company_room', 'company_all'));
alter table public.reservations
  add constraint reservations_bill_to_customer check (bill_to = 'guest' or customer_id is not null);

create or replace function public.set_reservation_billing(p_reservation_id uuid, p_bill_to text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.reservations%rowtype;
begin
  select * into v_r from public.reservations where id = p_reservation_id for update;
  if v_r.id is null then
    raise exception 'Reservation not found' using errcode = '23503';
  end if;
  perform app.require_permission(v_r.hotel_id, 'pms.reservations.manage');
  if v_r.status not in ('tentative', 'confirmed', 'checked_in') then
    raise exception 'Only active reservations can be changed' using errcode = '23514';
  end if;
  if p_bill_to not in ('guest', 'company_room', 'company_all') then
    raise exception 'Invalid billing option' using errcode = '22023';
  end if;
  if p_bill_to <> 'guest' and v_r.customer_id is null then
    raise exception 'Link the reservation to a company before billing it' using errcode = '23514';
  end if;
  update public.reservations set bill_to = p_bill_to where id = v_r.id;
  if v_r.folio_id is not null then
    perform set_config('app.system_posting', 'on', true);
    update public.guest_folios set customer_id = case when p_bill_to = 'guest' then null else v_r.customer_id end
     where id = v_r.folio_id and status = 'open';
    perform set_config('app.system_posting', 'off', true);
  end if;
end;
$$;

-- حصة الشركة من المستحق: كل الرصيد، أو رسوم الإقامة (الليالي بعد الخصومات والإلغاءات) فقط
create or replace function app.pms_company_due(p_reservation_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_r    public.reservations%rowtype;
  v_bal  record;
  v_open numeric;
  v_room numeric;
begin
  select * into v_r from public.reservations where id = p_reservation_id;
  if v_r.bill_to = 'guest' or v_r.folio_id is null then
    return 0;
  end if;
  v_bal := app.folio_current_balances(v_r.folio_id);
  v_open := greatest(v_bal.balance - v_bal.deposits, 0);
  if v_r.bill_to = 'company_all' then
    return v_open;
  end if;
  select coalesce(sum(t.ledger_effect), 0) into v_room
  from public.folio_transactions t
  where t.folio_id = v_r.folio_id
    and (t.id in (select folio_transaction_id from public.reservation_nights where reservation_id = v_r.id and folio_transaction_id is not null)
         or t.related_transaction_id in (select folio_transaction_id from public.reservation_nights where reservation_id = v_r.id and folio_transaction_id is not null));
  -- ما سبق تسويته آجلًا على الشركة
  v_room := v_room - coalesce((select sum(t.total_amount * t.direction) from public.folio_transactions t
                                 join public.payment_methods m on m.id = t.payment_method_id and m.kind = 'city_ledger'
                                where t.folio_id = v_r.folio_id and t.txn_type = 'payment'), 0);
  return least(greatest(v_room, 0), v_open);
end;
$$;

-- فتح فوليو الحجز: جهة الفوترة على الفوليو فقط عند فوترة الشركة
create or replace function app.pms_ensure_folio(p_reservation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r      public.reservations%rowtype;
  v_guest  text;
  v_room   text;
  v_folio  uuid;
begin
  select * into v_r from public.reservations where id = p_reservation_id;
  if v_r.folio_id is not null and exists (select 1 from public.guest_folios where id = v_r.folio_id and status = 'open') then
    return v_r.folio_id;
  end if;
  if v_r.folio_id is not null then
    raise exception 'The reservation folio is already closed' using errcode = '23514';
  end if;
  select full_name into v_guest from public.guests where id = v_r.guest_id;
  select room_number into v_room from public.rooms where id = v_r.room_id;
  v_folio := public.open_folio(
    p_hotel_id => v_r.hotel_id, p_guest_name => v_guest, p_folio_type => 'guest',
    p_customer_id => case when v_r.bill_to = 'guest' then null else v_r.customer_id end,
    p_room_number => v_room, p_reservation_ref => v_r.confirmation_number, p_arrival_date => v_r.arrival_date,
    p_departure_date => v_r.departure_date, p_adults => v_r.adults);
  update public.reservations set folio_id = v_folio where id = v_r.id;
  return v_folio;
end;
$$;

create or replace function public.prepare_check_out(p_reservation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r       public.reservations%rowtype;
  v_today   date;
  v_bal     record;
  v_company numeric;
begin
  select * into v_r from public.reservations where id = p_reservation_id for update;
  if v_r.id is null then
    raise exception 'Reservation not found' using errcode = '23503';
  end if;
  perform app.require_permission(v_r.hotel_id, 'pms.reservations.manage');
  if v_r.status <> 'checked_in' then
    raise exception 'Only in-house reservations can be checked out' using errcode = '23514';
  end if;
  v_today := app.today_for_hotel(v_r.hotel_id);

  if v_r.booking_mode = 'nightly' and v_r.departure_date > v_today then
    update public.reservations set departure_date = greatest(v_today, v_r.arrival_date + 1) where id = v_r.id;
    perform app.pms_write_nights(v_r.id, true);
    perform set_config('app.system_posting', 'on', true);
    update public.guest_folios set departure_date = greatest(v_today, v_r.arrival_date + 1) where id = v_r.folio_id;
    perform set_config('app.system_posting', 'off', true);
  end if;

  perform public.post_reservation_charges(v_r.id, (select max(stay_date) from public.reservation_nights where reservation_id = v_r.id));
  v_bal := app.folio_current_balances(v_r.folio_id);
  v_company := app.pms_company_due(v_r.id);
  return jsonb_build_object('folio_id', v_r.folio_id, 'balance', v_bal.balance, 'deposits', v_bal.deposits,
                            'company_due', v_company, 'bill_to', v_r.bill_to,
                            'due', greatest(v_bal.balance - v_bal.deposits - v_company, 0));
end;
$$;

create or replace function public.check_out_reservation(p_reservation_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r        public.reservations%rowtype;
  v_invoice  uuid;
  v_company  numeric;
  v_method   uuid;
begin
  perform public.prepare_check_out(p_reservation_id);
  select * into v_r from public.reservations where id = p_reservation_id;

  -- حصة الشركة تُحوَّل آجلًا (ذمم مدينة) فتصدر الفاتورة باسمها
  v_company := app.pms_company_due(v_r.id);
  if v_company > 0 then
    select id into v_method from public.payment_methods
     where hotel_id = v_r.hotel_id and kind = 'city_ledger' and is_active order by (code = 'CREDIT') desc, code limit 1;
    if v_method is null then
      raise exception 'No active credit (city ledger) payment method' using errcode = '23514';
    end if;
    perform public.post_folio_payment(v_r.folio_id, v_method, v_company, app.today_for_hotel(v_r.hotel_id),
      v_r.confirmation_number, null, v_r.customer_id);
  end if;

  if exists (select 1 from public.folio_transactions where folio_id = v_r.folio_id) then
    v_invoice := public.checkout_folio(v_r.folio_id, app.today_for_hotel(v_r.hotel_id));
  else
    perform public.cancel_folio(v_r.folio_id);
  end if;
  update public.reservations set status = 'checked_out', checked_out_at = now() where id = v_r.id;
  if v_r.booking_mode = 'nightly' then
    update public.rooms set housekeeping_status = 'dirty' where id = v_r.room_id;
  end if;
  return v_invoice;
end;
$$;

-- -----------------------------------------------------------------------------
-- صلاحيات التنفيذ
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema app from public, anon;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.set_exchange_rate(uuid, text, numeric, date)',
    'public.post_folio_foreign_money(uuid, text, uuid, numeric, text)',
    'public.record_reservation_deposit_fx(uuid, uuid, numeric, text)',
    'public.open_cashier_shift(uuid, numeric)',
    'public.cashier_shift_report(uuid)',
    'public.close_cashier_shift(uuid, jsonb, text)',
    'public.set_reservation_billing(uuid, text)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
