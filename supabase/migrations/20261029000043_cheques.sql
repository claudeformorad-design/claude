-- =============================================================================
-- الشيكات المؤجلة:
--   طريقتا دفع جديدتان: «شيك وارد مؤجل» على حساب «شيكات تحت التحصيل» (أصل)، و«شيك صادر مؤجل» على حساب
--   «شيكات صادرة مستحقة الصرف» (خصم). السند (قبض أو صرف) بإحدى الطريقتين يُسجَّل له شيك برقمه وبنكه
--   وتاريخ استحقاقه، ثم:
--     الوارد: «تحصيل» يقيّد مدين البنك ودائن شيكات تحت التحصيل؛ «ارتداد» يلغي السند (فتعود الذمة على العميل)
--             ويعكس قيد التحصيل إن كان قد حُصّل.
--     الصادر: «صرف» يقيّد مدين شيكات صادرة ودائن البنك؛ «إلغاء» قبل الصرف يلغي السند.
--   طريقة «شيك» القديمة على البنك مباشرة تبقى لمن لا يتابع الشيكات.
-- =============================================================================

alter type public.journal_source add value if not exists 'cheque';

-- الشيك الصادر المؤجل التزام على الفندق حتى يُصرف، فتُقبل طريقة دفع الشيك على حساب خصوم أيضًا
create or replace function app.payment_methods_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform app.assert_account(new.hotel_id, new.account_id,
    case when new.kind = 'cheque' then array['asset', 'liability'] else array['asset'] end::public.account_type[]);
  return new;
end;
$$;

-- الحسابان يُنشآن عند أول حاجة تحت المجموعة نفسها لحسابات التحصيل والذمم الدائنة
create or replace function app.cheque_account(p_hotel_id uuid, p_dir text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_key    text := case when p_dir = 'in' then 'cheques_receivable' else 'cheques_payable' end;
  v_near   text := case when p_dir = 'in' then 'card_clearing' else 'ap_control' end;
  v_id     uuid;
  v_prev   text := coalesce(current_setting('app.system_posting', true), 'off');
begin
  select id into v_id from public.chart_of_accounts where hotel_id = p_hotel_id and system_key = v_key;
  if v_id is null then
    perform set_config('app.system_posting', 'on', true);
    insert into public.chart_of_accounts
      (hotel_id, code, name_ar, name_en, account_type, account_subtype, is_postable, system_key, parent_id, level)
    select p_hotel_id,
           coalesce((select max(code::bigint) + 1 from public.chart_of_accounts
                      where hotel_id = p_hotel_id and parent_id = p.id and code ~ '^[0-9]+$')::text, p.code || '01'),
           case when p_dir = 'in' then 'شيكات تحت التحصيل' else 'شيكات صادرة مستحقة الصرف' end,
           case when p_dir = 'in' then 'Cheques under collection' else 'Issued cheques payable' end,
           case when p_dir = 'in' then 'asset' else 'liability' end::public.account_type,
           case when p_dir = 'in' then 'current_asset' else 'current_liability' end::public.account_subtype,
           true, v_key, p.id, p.level + 1
    from public.chart_of_accounts p
    where p.hotel_id = p_hotel_id and p.id = (select parent_id from public.chart_of_accounts where hotel_id = p_hotel_id and system_key = v_near)
    returning id into v_id;
    perform set_config('app.system_posting', v_prev, true);
  end if;
  if v_id is null then
    raise exception 'System account "%" is not configured in the chart of accounts', v_key using errcode = '23514';
  end if;
  return v_id;
end;
$$;

create or replace function app.ensure_cheque_methods(p_hotel_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.payment_methods (hotel_id, code, name_ar, name_en, kind, account_id)
  values (p_hotel_id, 'CHQ_IN', 'شيك وارد مؤجل', 'Post-dated cheque received', 'cheque', app.cheque_account(p_hotel_id, 'in')),
         (p_hotel_id, 'CHQ_OUT', 'شيك صادر مؤجل', 'Post-dated cheque issued', 'cheque', app.cheque_account(p_hotel_id, 'out'))
  on conflict (hotel_id, code) do nothing;
end;
$$;

-- للفنادق الحالية، وللفنادق الجديدة عند إنشاء طرق الدفع الافتراضية
do $$
declare h uuid;
begin
  for h in select distinct hotel_id from public.payment_methods where code = 'CASH' loop
    perform app.ensure_cheque_methods(h);
  end loop;
end $$;

create or replace function app.seed_cheque_methods()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.code = 'CASH' then
    perform app.ensure_cheque_methods(new.hotel_id);
  end if;
  return null;
end;
$$;
create trigger payment_methods_seed_cheques after insert on public.payment_methods
  for each row execute function app.seed_cheque_methods();

create table public.cheques (
  id               uuid primary key default gen_random_uuid(),
  hotel_id         uuid not null references public.hotels(id) on delete cascade,
  direction        text not null check (direction in ('in', 'out')),
  payment_id       uuid not null unique,
  cheque_number    text not null check (length(trim(cheque_number)) between 1 and 40),
  bank_name        text,
  due_date         date not null,
  amount           numeric(19, 4) not null check (amount > 0),
  party_name       text,
  status           text not null default 'pending' check (status in ('pending', 'cleared', 'bounced')),
  settled_on       date,
  settle_method_id uuid,
  settle_entry_id  uuid references public.journal_entries(id),
  status_note      text,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id),
  updated_at       timestamptz not null default now(),
  unique (hotel_id, id),
  foreign key (hotel_id, payment_id) references public.payments (hotel_id, id),
  foreign key (hotel_id, settle_method_id) references public.payment_methods (hotel_id, id)
);
create index cheques_hotel_idx on public.cheques (hotel_id, status, due_date);

alter table public.cheques enable row level security;
create policy cheques_read on public.cheques for select to authenticated
  using (hotel_id in (select app.permitted_hotels('payments.view')));
create trigger cheques_system_only before insert or update or delete on public.cheques
  for each row execute function app.system_write_only();
create trigger audit_cheques after insert or update or delete on public.cheques for each row execute function app.audit_trigger();

-- بيانات الشيك لسند قبض أو صرف بطريقة الشيك المؤجل
create or replace function public.register_cheque(p_payment_id uuid, p_number text, p_bank text, p_due_date date)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_p     public.payments%rowtype;
  v_code  text;
  v_dir   text;
  v_id    uuid;
begin
  select * into v_p from public.payments where id = p_payment_id;
  if v_p.id is null then
    raise exception 'Voucher not found' using errcode = 'P0002';
  end if;
  select code into v_code from public.payment_methods where id = v_p.payment_method_id;
  v_dir := case when v_code = 'CHQ_IN' and v_p.voucher_type = 'receipt' then 'in'
                when v_code = 'CHQ_OUT' and v_p.voucher_type = 'disbursement' then 'out' end;
  if v_dir is null then
    raise exception 'This voucher is not paid by a post-dated cheque' using errcode = '22023';
  end if;
  perform app.require_permission(v_p.hotel_id, case when v_dir = 'in' then 'payments.receipt' else 'payments.disbursement' end);
  if v_p.status <> 'posted' then
    raise exception 'Voucher is already voided' using errcode = '23514';
  end if;
  if length(trim(coalesce(p_number, ''))) = 0 or p_due_date is null then
    raise exception 'Cheque number and due date are required' using errcode = '22023';
  end if;
  if exists (select 1 from public.cheques where payment_id = p_payment_id) then
    raise exception 'This voucher already has a cheque' using errcode = '23505';
  end if;
  perform set_config('app.system_posting', 'on', true);
  insert into public.cheques (hotel_id, direction, payment_id, cheque_number, bank_name, due_date, amount, party_name, created_by)
  values (v_p.hotel_id, v_dir, v_p.id, trim(p_number), nullif(trim(p_bank), ''), p_due_date, v_p.amount,
          coalesce(v_p.party_name, (select c.name_ar from public.customers c where c.id = v_p.customer_id), v_p.description), auth.uid())
  returning id into v_id;
  perform set_config('app.system_posting', 'off', true);
  return v_id;
end;
$$;

-- تحصيل شيك وارد أو صرف شيك صادر عبر حساب بنكي
create or replace function public.clear_cheque(p_cheque_id uuid, p_bank_method_id uuid, p_date date default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c     public.cheques%rowtype;
  v_bank  public.payment_methods%rowtype;
  v_hold  uuid;
  v_date  date;
  v_je    uuid;
begin
  select * into v_c from public.cheques where id = p_cheque_id for update;
  if v_c.id is null then
    raise exception 'Cheque not found' using errcode = 'P0002';
  end if;
  perform app.require_permission(v_c.hotel_id, case when v_c.direction = 'in' then 'payments.receipt' else 'payments.disbursement' end);
  if v_c.status <> 'pending' then
    raise exception 'Only a pending cheque can be cleared' using errcode = '23514';
  end if;
  select * into v_bank from public.payment_methods where id = p_bank_method_id and hotel_id = v_c.hotel_id and is_active;
  if v_bank.id is null or v_bank.kind not in ('bank_transfer') then
    raise exception 'Choose an active bank account to clear the cheque' using errcode = '22023';
  end if;
  v_date := coalesce(p_date, app.today_for_hotel(v_c.hotel_id));
  v_hold := app.cheque_account(v_c.hotel_id, v_c.direction);
  v_je := app.post_system_entry(v_c.hotel_id, v_date,
            case when v_c.direction = 'in' then 'تحصيل شيك وارد / Cheque collected ' else 'صرف شيك صادر / Cheque cleared ' end || v_c.cheque_number,
            'cheque', v_c.id, v_c.cheque_number,
            case when v_c.direction = 'in'
              then jsonb_build_array(jsonb_build_object('account_id', v_bank.account_id, 'debit', v_c.amount),
                                     jsonb_build_object('account_id', v_hold, 'credit', v_c.amount))
              else jsonb_build_array(jsonb_build_object('account_id', v_hold, 'debit', v_c.amount),
                                     jsonb_build_object('account_id', v_bank.account_id, 'credit', v_c.amount)) end);
  perform set_config('app.system_posting', 'on', true);
  update public.cheques set status = 'cleared', settled_on = v_date, settle_method_id = v_bank.id, settle_entry_id = v_je, updated_at = now()
   where id = v_c.id;
  perform set_config('app.system_posting', 'off', true);
  return v_je;
end;
$$;

-- ارتداد شيك وارد (ولو بعد تحصيله) أو إلغاء شيك صادر قبل صرفه: يُلغى السند بسببه
create or replace function public.bounce_cheque(p_cheque_id uuid, p_reason text, p_date date default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_c    public.cheques%rowtype;
  v_date date;
begin
  select * into v_c from public.cheques where id = p_cheque_id for update;
  if v_c.id is null then
    raise exception 'Cheque not found' using errcode = 'P0002';
  end if;
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  if v_c.status = 'bounced' or (v_c.direction = 'out' and v_c.status = 'cleared') then
    raise exception 'This cheque can no longer be bounced or cancelled' using errcode = '23514';
  end if;
  v_date := coalesce(p_date, app.today_for_hotel(v_c.hotel_id));
  -- إلغاء السند يتحقق من صلاحية الإلغاء ويعيد الفواتير المخصصة غير مسددة
  if v_c.status = 'cleared' then
    perform app.require_permission(v_c.hotel_id, 'payments.void');
    perform app.reverse_system_entry(v_c.settle_entry_id, v_date, 'ارتداد شيك / Cheque returned ' || v_c.cheque_number);
  end if;
  perform public.void_payment_voucher(v_c.payment_id,
    case when v_c.direction = 'in' then 'ارتداد شيك ' else 'إلغاء شيك ' end || v_c.cheque_number || ': ' || trim(p_reason), v_date);
  perform set_config('app.system_posting', 'on', true);
  update public.cheques set status = 'bounced', status_note = trim(p_reason), settled_on = v_date, updated_at = now() where id = v_c.id;
  perform set_config('app.system_posting', 'off', true);
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.register_cheque(uuid, text, text, date)',
    'public.clear_cheque(uuid, uuid, date)',
    'public.bounce_cheque(uuid, text, date)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function app.cheque_account(uuid, text) from public, anon, authenticated;
revoke all on function app.ensure_cheque_methods(uuid) from public, anon, authenticated;
