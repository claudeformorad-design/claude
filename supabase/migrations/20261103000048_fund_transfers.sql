-- =============================================================================
-- سند التحويل وتبديل العملة: نقل مبلغ من صندوق أو بنك إلى آخر.
--   بنفس العملة: إيداع النقدية في البنك، أو تغذية صندوق الاستقبال من الخزينة (المبلغان متساويان).
--   بعملتين: صرف دولارات الصندوق بريالات مثلًا. كل طرف يُقيَّم بسعر الصرف المسجّل في النظام لذلك اليوم،
--   والفرق بين القيمتين بالعملة الأساسية يُقيَّد أرباحًا أو خسائر فروقات عملة.
--   الإلغاء بسبب يعكس القيد.
-- =============================================================================

alter type public.journal_source add value if not exists 'fund_transfer';

create table public.fund_transfers (
  id                 uuid primary key default gen_random_uuid(),
  hotel_id           uuid not null references public.hotels(id),
  transfer_number    text not null,
  transfer_date      date not null,
  from_method_id     uuid not null,
  from_currency      char(3) not null references public.currencies(code),
  from_amount        numeric(19, 4) not null check (from_amount > 0),
  from_rate          numeric(19, 8) not null check (from_rate > 0),
  to_method_id       uuid not null,
  to_currency        char(3) not null references public.currencies(code),
  to_amount          numeric(19, 4) not null check (to_amount > 0),
  to_rate            numeric(19, 8) not null check (to_rate > 0),
  base_from          numeric(19, 4) not null,
  base_to            numeric(19, 4) not null,
  difference         numeric(19, 4) not null,
  description        text,
  status             text not null default 'posted' check (status in ('posted', 'voided')),
  void_reason        text,
  journal_entry_id   uuid references public.journal_entries(id),
  reversal_entry_id  uuid references public.journal_entries(id),
  created_at         timestamptz not null default now(),
  created_by         uuid references auth.users(id),
  unique (hotel_id, transfer_number),
  unique (hotel_id, id),
  foreign key (hotel_id, from_method_id) references public.payment_methods (hotel_id, id),
  foreign key (hotel_id, to_method_id) references public.payment_methods (hotel_id, id),
  constraint fund_transfers_two_sides check (from_method_id <> to_method_id),
  constraint fund_transfers_difference check (difference = base_to - base_from)
);
create index fund_transfers_hotel_idx on public.fund_transfers (hotel_id, transfer_date desc);
create trigger fund_transfers_system_only before insert or update or delete on public.fund_transfers
  for each row execute function app.system_write_only();
alter table public.fund_transfers enable row level security;
create policy fund_transfers_read on public.fund_transfers for select to authenticated
  using (hotel_id in (select app.permitted_hotels('payments.view')));
create trigger audit_fund_transfers after insert or update or delete on public.fund_transfers
  for each row execute function app.audit_trigger();

create or replace function public.create_fund_transfer(
  p_hotel_id uuid, p_from_method_id uuid, p_from_amount numeric, p_to_method_id uuid, p_to_amount numeric,
  p_description text default null, p_date date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_base    char(3);
  v_dec     smallint;
  v_from    public.payment_methods%rowtype;
  v_to      public.payment_methods%rowtype;
  v_fcur    char(3);
  v_tcur    char(3);
  v_frate   numeric;
  v_trate   numeric;
  v_bfrom   numeric;
  v_bto     numeric;
  v_diff    numeric;
  v_date    date;
  v_id      uuid;
  v_no      text;
  v_lines   jsonb;
begin
  perform app.require_permission(p_hotel_id, 'payments.disbursement');
  select base_currency into v_base from public.hotels where id = p_hotel_id;
  v_dec := app.currency_decimals(p_hotel_id);
  v_date := coalesce(p_date, app.today_for_hotel(p_hotel_id));
  select * into v_from from public.payment_methods where id = p_from_method_id and hotel_id = p_hotel_id;
  select * into v_to from public.payment_methods where id = p_to_method_id and hotel_id = p_hotel_id;
  if v_from.id is null or v_to.id is null or not v_from.is_active or not v_to.is_active
     or v_from.kind not in ('cash', 'bank_transfer', 'e_wallet') or v_to.kind not in ('cash', 'bank_transfer', 'e_wallet') then
    raise exception 'Choose an active cash, bank or wallet method on each side' using errcode = '23514';
  end if;
  if v_from.id = v_to.id then
    raise exception 'Choose two different methods' using errcode = '23514';
  end if;
  v_fcur := coalesce(v_from.currency_code, v_base);
  v_tcur := coalesce(v_to.currency_code, v_base);
  if p_from_amount is null or p_from_amount <= 0 or p_to_amount is null or p_to_amount <= 0
     or p_from_amount <> round(p_from_amount, (select decimals from public.currencies where code = v_fcur))
     or p_to_amount <> round(p_to_amount, (select decimals from public.currencies where code = v_tcur)) then
    raise exception 'Enter valid amounts for both sides' using errcode = '23514';
  end if;
  if v_fcur = v_tcur and p_from_amount <> p_to_amount then
    raise exception 'Both amounts must be equal when the currency is the same' using errcode = '23514';
  end if;
  v_frate := case when v_fcur = v_base then 1 else app.fx_rate(p_hotel_id, v_fcur, v_date) end;
  v_trate := case when v_tcur = v_base then 1 else app.fx_rate(p_hotel_id, v_tcur, v_date) end;
  v_bfrom := round(p_from_amount * v_frate, v_dec);
  v_bto := case when v_fcur = v_tcur then v_bfrom else round(p_to_amount * v_trate, v_dec) end;
  v_diff := v_bto - v_bfrom;
  if v_from.account_id = v_to.account_id and v_diff = 0 then
    raise exception 'Both methods post to the same account; there is nothing to record' using errcode = '23514';
  end if;

  v_no := app.next_document_number(p_hotel_id, 'fund_transfer', 'TR', v_date);
  perform set_config('app.system_posting', 'on', true);
  insert into public.fund_transfers
    (hotel_id, transfer_number, transfer_date, from_method_id, from_currency, from_amount, from_rate,
     to_method_id, to_currency, to_amount, to_rate, base_from, base_to, difference, description, created_by)
  values (p_hotel_id, v_no, v_date, v_from.id, v_fcur, p_from_amount, v_frate, v_to.id, v_tcur, p_to_amount, v_trate,
          v_bfrom, v_bto, v_diff, nullif(trim(coalesce(p_description, '')), ''), auth.uid())
  returning id into v_id;

  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', v_to.account_id, 'debit', v_bto,
      'description', case when v_tcur <> v_base then v_tcur || ' ' || trim(to_char(p_to_amount, 'FM999999999990.0999')) end),
    jsonb_build_object('account_id', v_from.account_id, 'credit', v_bfrom,
      'description', case when v_fcur <> v_base then v_fcur || ' ' || trim(to_char(p_from_amount, 'FM999999999990.0999')) end));
  if v_diff > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', app.account_by_key(p_hotel_id, 'fx_gain'), 'credit', v_diff));
  elsif v_diff < 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', app.account_by_key(p_hotel_id, 'fx_loss'), 'debit', -v_diff));
  end if;
  update public.fund_transfers
     set journal_entry_id = app.post_system_entry(p_hotel_id, v_date,
           case when v_fcur = v_tcur then 'تحويل أموال / Fund transfer' else 'تبديل عملة / Currency exchange' end || ' — ' || v_no,
           'fund_transfer', v_id, v_no, v_lines)
   where id = v_id;
  perform set_config('app.system_posting', 'off', true);
  return v_id;
end;
$$;

create or replace function public.void_fund_transfer(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_t public.fund_transfers%rowtype;
begin
  select * into v_t from public.fund_transfers where id = p_id for update;
  if not found then
    raise exception 'Transfer not found' using errcode = 'P0002';
  end if;
  perform app.require_permission(v_t.hotel_id, 'payments.void');
  if v_t.status <> 'posted' then
    raise exception 'This transfer is already cancelled' using errcode = '23514';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  perform set_config('app.system_posting', 'on', true);
  update public.fund_transfers
     set status = 'voided', void_reason = trim(p_reason),
         reversal_entry_id = app.reverse_system_entry(v_t.journal_entry_id, app.today_for_hotel(v_t.hotel_id),
           'إلغاء تحويل / Transfer cancelled — ' || v_t.transfer_number)
   where id = p_id;
  perform set_config('app.system_posting', 'off', true);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.create_fund_transfer(uuid, uuid, numeric, uuid, numeric, text, date)',
    'public.void_fund_transfer(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
