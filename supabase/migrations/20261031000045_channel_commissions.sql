-- =============================================================================
-- عمولات وكلاء الحجز (Booking.com، Expedia، الوكلاء...):
--   لكل مصدر حجز نسبة عمولة. بعد مغادرة النزيل تُحسب العمولة على صافي إيراد الليالي المرحّلة
--   (بلا ضريبة، وبعد الخصومات والإلغاءات)، ثم تُرحَّل: مدين «عمولات وكلاء الحجز» ودائن «عمولات وكلاء
--   الحجز المستحقة». سداد الوكيل يكون بسند صرف على حساب العمولات المستحقة.
--   العمولة المرحّلة يمكن عكسها بسبب، فيعود الحجز إلى قائمة العمولات المستحقة.
-- =============================================================================

alter type public.journal_source add value if not exists 'commission';

insert into public.permissions (code, module, action, name_ar, name_en, sort_order, product) values
  ('commissions.manage', 'payables', 'manage', 'عمولات وكلاء الحجز', 'Booking channel commissions', 737, 'core');
insert into public.role_permissions (role_id, permission_code)
select r.id, 'commissions.manage' from public.roles r
where r.is_system and r.code in ('general_manager', 'accountant')
on conflict do nothing;

create table public.channel_commission_rates (
  hotel_id    uuid not null references public.hotels(id) on delete cascade,
  source      public.reservation_source not null,
  rate        numeric(5, 2) not null check (rate > 0 and rate <= 100),
  updated_at  timestamptz not null default now(),
  primary key (hotel_id, source)
);
-- الحذف (نسبة صفر) يمر عبر الدالة فقط؛ لا سياسة كتابة على الجدول فيُرفض الحذف المباشر
create trigger channel_commission_rates_system_only before insert or update on public.channel_commission_rates
  for each row execute function app.system_write_only();
alter table public.channel_commission_rates enable row level security;
create policy channel_commission_rates_read on public.channel_commission_rates for select to authenticated
  using (hotel_id in (select app.permitted_hotels('commissions.manage')));
create trigger audit_channel_commission_rates after insert or update or delete on public.channel_commission_rates
  for each row execute function app.audit_trigger();

create table public.reservation_commissions (
  id                   uuid primary key default gen_random_uuid(),
  hotel_id             uuid not null references public.hotels(id),
  reservation_id       uuid not null references public.reservations(id),
  confirmation_number  text not null,
  guest_name           text,
  source               public.reservation_source not null,
  base_amount          numeric(19, 4) not null check (base_amount > 0),
  rate                 numeric(5, 2) not null,
  amount               numeric(19, 4) not null check (amount > 0),
  posting_date         date not null,
  status               text not null default 'posted' check (status in ('posted', 'reversed')),
  reversal_reason      text,
  journal_entry_id     uuid references public.journal_entries(id),
  reversal_entry_id    uuid references public.journal_entries(id),
  created_at           timestamptz not null default now(),
  created_by           uuid references auth.users(id),
  unique (hotel_id, id)
);
create unique index reservation_commissions_once on public.reservation_commissions (reservation_id) where status = 'posted';
create index reservation_commissions_hotel_idx on public.reservation_commissions (hotel_id, posting_date desc);
create trigger reservation_commissions_system_only before insert or update or delete on public.reservation_commissions
  for each row execute function app.system_write_only();
alter table public.reservation_commissions enable row level security;
create policy reservation_commissions_read on public.reservation_commissions for select to authenticated
  using (hotel_id in (select app.permitted_hotels('commissions.manage')));
create trigger audit_reservation_commissions after insert or update or delete on public.reservation_commissions
  for each row execute function app.audit_trigger();

create or replace function public.save_channel_commission_rate(p_hotel_id uuid, p_source public.reservation_source, p_rate numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_permission(p_hotel_id, 'commissions.manage');
  if p_rate is not null and (p_rate < 0 or p_rate > 100) then
    raise exception 'Commission rate must be between 0 and 100' using errcode = '23514';
  end if;
  perform set_config('app.system_posting', 'on', true);
  if coalesce(p_rate, 0) = 0 then
    delete from public.channel_commission_rates where hotel_id = p_hotel_id and source = p_source;
  else
    insert into public.channel_commission_rates (hotel_id, source, rate) values (p_hotel_id, p_source, p_rate)
    on conflict (hotel_id, source) do update set rate = excluded.rate, updated_at = now();
  end if;
  perform set_config('app.system_posting', 'off', true);
end;
$$;

-- الحجوزات المغادرة من مصدر له نسبة عمولة ولم تُرحَّل عمولتها، مع صافي إيراد لياليها
create or replace function public.pending_channel_commissions(p_hotel_id uuid)
returns table (
  reservation_id uuid, confirmation_number text, guest_name text, source public.reservation_source,
  arrival_date date, departure_date date, base_amount numeric, rate numeric, amount numeric
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_dec smallint;
begin
  perform app.require_permission(p_hotel_id, 'commissions.manage');
  v_dec := app.currency_decimals(p_hotel_id);
  return query
  select r.id, r.confirmation_number, g.full_name, r.source, r.arrival_date, r.departure_date,
         b.base, c.rate, round(b.base * c.rate / 100, v_dec)
  from public.reservations r
  join public.channel_commission_rates c on c.hotel_id = r.hotel_id and c.source = r.source
  left join public.guests g on g.id = r.guest_id
  cross join lateral (
    select coalesce(sum(ft.net_amount - coalesce((
             select sum(a.net_amount) from public.folio_transactions a
             where a.related_transaction_id = ft.id and a.txn_type = 'allowance' and a.direction = 1 and a.voided_by_id is null), 0)), 0) as base
    from public.reservation_nights n
    join public.folio_transactions ft on ft.id = n.folio_transaction_id and ft.voided_by_id is null and ft.direction = 1
    where n.reservation_id = r.id
  ) b
  where r.hotel_id = p_hotel_id and r.status = 'checked_out' and b.base > 0
    and not exists (select 1 from public.reservation_commissions x where x.reservation_id = r.id and x.status = 'posted')
  order by r.departure_date, r.confirmation_number;
end;
$$;

-- ترحيل العمولات المستحقة (كلها، أو حجوزات محددة) بقيد واحد لكل حجز
create or replace function public.post_channel_commissions(p_hotel_id uuid, p_reservation_ids uuid[] default null, p_date date default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_date  date;
  v_exp   uuid;
  v_pay   uuid;
  v_id    uuid;
  v_count integer := 0;
  r       record;
begin
  perform app.require_permission(p_hotel_id, 'commissions.manage');
  v_date := coalesce(p_date, app.today_for_hotel(p_hotel_id));
  v_exp := app.account_by_key(p_hotel_id, 'commission_expense');
  v_pay := app.account_by_key(p_hotel_id, 'commissions_payable');
  for r in select * from public.pending_channel_commissions(p_hotel_id) p
           where p_reservation_ids is null or p.reservation_id = any (p_reservation_ids) loop
    if r.amount <= 0 then
      continue;
    end if;
    perform set_config('app.system_posting', 'on', true);
    insert into public.reservation_commissions
      (hotel_id, reservation_id, confirmation_number, guest_name, source, base_amount, rate, amount, posting_date, created_by)
    values (p_hotel_id, r.reservation_id, r.confirmation_number, r.guest_name, r.source, r.base_amount, r.rate, r.amount, v_date, auth.uid())
    returning id into v_id;
    update public.reservation_commissions
       set journal_entry_id = app.post_system_entry(p_hotel_id, v_date,
             'عمولة وكيل حجز / Booking commission — ' || r.confirmation_number, 'commission', v_id, r.confirmation_number,
             jsonb_build_array(jsonb_build_object('account_id', v_exp, 'debit', r.amount),
                               jsonb_build_object('account_id', v_pay, 'credit', r.amount)))
     where id = v_id;
    perform set_config('app.system_posting', 'off', true);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

create or replace function public.reverse_channel_commission(p_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c public.reservation_commissions%rowtype;
begin
  select * into v_c from public.reservation_commissions where id = p_id for update;
  if not found then
    raise exception 'Commission not found' using errcode = 'P0002';
  end if;
  perform app.require_permission(v_c.hotel_id, 'commissions.manage');
  if v_c.status <> 'posted' then
    raise exception 'This commission is already reversed' using errcode = '23514';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  perform set_config('app.system_posting', 'on', true);
  update public.reservation_commissions
     set status = 'reversed', reversal_reason = trim(p_reason),
         reversal_entry_id = app.reverse_system_entry(v_c.journal_entry_id, app.today_for_hotel(v_c.hotel_id),
           'عكس عمولة وكيل حجز / Booking commission reversal — ' || v_c.confirmation_number)
   where id = p_id;
  perform set_config('app.system_posting', 'off', true);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.save_channel_commission_rate(uuid, public.reservation_source, numeric)',
    'public.pending_channel_commissions(uuid)',
    'public.post_channel_commissions(uuid, uuid[], date)',
    'public.reverse_channel_commission(uuid, text)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
