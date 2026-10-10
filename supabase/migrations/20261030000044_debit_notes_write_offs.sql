-- =============================================================================
-- 1) مرتجع مشتريات (إشعار مدين على فاتورة مورد): يخفّض المستحق للمورد، ويعكس المصروف وضريبة المدخلات
--    بنسبة بنود الفاتورة. فواتير فيها بنود على حسابات المخزون تُستثنى (مرتجع المخزون يحتاج حركة مخزون).
-- 2) إعدام دين معدوم على فاتورة عميل آجلة: مدين مصروف الديون المعدومة ودائن ذمم الشركات والعملاء،
--    ويقل المستحق على الفاتورة بالمبلغ نفسه.
-- =============================================================================

insert into public.permissions (code, module, action, name_ar, name_en, sort_order, product) values
  ('invoices.write_off', 'invoices', 'approve', 'إعدام الديون المعدومة', 'Write off bad debts', 725, 'core'),
  ('bills.debit_note',   'payables', 'approve', 'مرتجعات المشتريات (إشعار مدين)', 'Purchase returns (debit notes)', 735, 'core');
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r cross join public.permissions p
where r.is_system and r.code in ('general_manager', 'accountant') and p.code in ('invoices.write_off', 'bills.debit_note')
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- 1) مرتجعات المشتريات
-- -----------------------------------------------------------------------------
create table public.vendor_debit_notes (
  id                uuid primary key default gen_random_uuid(),
  hotel_id          uuid not null references public.hotels(id),
  debit_note_number text not null,
  bill_id           uuid not null,
  issue_date        date not null,
  net_amount        numeric(19, 4) not null,
  tax_amount        numeric(19, 4) not null,
  total             numeric(19, 4) not null check (total > 0),
  reason            text not null,
  journal_entry_id  uuid references public.journal_entries(id),
  created_at        timestamptz not null default now(),
  created_by        uuid references auth.users(id),
  unique (hotel_id, debit_note_number),
  unique (hotel_id, id),
  foreign key (hotel_id, bill_id) references public.vendor_bills (hotel_id, id),
  constraint dn_totals check (net_amount + tax_amount = total)
);
create trigger vendor_debit_notes_system_only before insert or update or delete on public.vendor_debit_notes
  for each row execute function app.system_write_only();
alter table public.vendor_debit_notes enable row level security;
create policy vendor_debit_notes_read on public.vendor_debit_notes for select to authenticated
  using (hotel_id in (select app.permitted_hotels('bills.view')));
create trigger audit_vendor_debit_notes after insert or update or delete on public.vendor_debit_notes for each row execute function app.audit_trigger();

-- المسدد على الفاتورة = تخصيصات السندات السارية + المرتجعات؛ فيبقى «الإجمالي − المسدد» هو المستحق للمورد
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
    into v_paid;
  update public.vendor_bills
     set amount_paid = v_paid,
         status = case when v_paid >= total then 'paid' when v_paid = 0 then 'open' else 'partially_paid' end::public.bill_status
   where id = p_bill_id;
end;
$$;

create or replace function public.create_vendor_debit_note(p_bill_id uuid, p_amount numeric, p_reason text, p_date date default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bill  public.vendor_bills%rowtype;
  v_dec   smallint;
  v_tax   numeric;
  v_vat   numeric;
  v_net   numeric;
  v_date  date;
  v_id    uuid;
  v_lines jsonb;
  v_left  numeric;
  v_base  numeric;
  v_part  numeric;
  r       record;
  i       integer := 0;
  n       integer;
begin
  select * into v_bill from public.vendor_bills where id = p_bill_id for update;
  if not found then
    raise exception 'Vendor bill not found' using errcode = 'P0002';
  end if;
  perform app.require_permission(v_bill.hotel_id, 'bills.debit_note');
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > v_bill.total - v_bill.amount_paid then
    raise exception 'Debit note must be between 0 and the outstanding amount (%)', v_bill.total - v_bill.amount_paid using errcode = '23514';
  end if;
  if exists (select 1 from public.vendor_bill_lines l join public.inventory_items it on it.inventory_account_id = l.account_id and it.hotel_id = l.hotel_id
             where l.bill_id = p_bill_id) then
    raise exception 'This bill has inventory lines; return stock items with an inventory movement' using errcode = '23514';
  end if;
  v_dec := app.currency_decimals(v_bill.hotel_id);
  v_date := coalesce(p_date, app.today_for_hotel(v_bill.hotel_id));
  -- الضريبة المستردة بالنسبة، وضريبة القيمة المضافة وحدها تعود لحساب المدخلات
  v_tax := case when v_bill.total = 0 then 0 else round(p_amount * v_bill.tax_total / v_bill.total, v_dec) end;
  v_net := p_amount - v_tax;
  select coalesce(sum(l.tax_amount), 0) into v_vat from public.vendor_bill_lines l join public.tax_rates t on t.id = l.tax_rate_id and t.kind = 'vat' where l.bill_id = p_bill_id;
  v_vat := case when v_bill.tax_total = 0 then 0 else round(v_tax * v_vat / v_bill.tax_total, v_dec) end;

  perform set_config('app.system_posting', 'on', true);
  insert into public.vendor_debit_notes (hotel_id, debit_note_number, bill_id, issue_date, net_amount, tax_amount, total, reason, created_by)
  values (v_bill.hotel_id, app.next_document_number(v_bill.hotel_id, 'vendor_debit_note', 'DN', v_date), v_bill.id, v_date,
          v_net, v_tax, p_amount, trim(p_reason), auth.uid())
  returning id into v_id;
  perform app.refresh_bill_paid(v_bill.id);

  -- مدين ذمم الموردين، ودائن حسابات البنود بنسبة (صافيها + ضرائبها غير القابلة للاسترداد)، ودائن ضريبة المدخلات
  v_lines := jsonb_build_array(jsonb_build_object('account_id', app.account_by_key(v_bill.hotel_id, 'ap_control'), 'debit', p_amount));
  if v_vat > 0 then
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', app.account_by_key(v_bill.hotel_id, 'vat_input'), 'credit', v_vat));
  end if;
  v_left := p_amount - v_vat;
  select coalesce(sum(l.net_amount + case when t.kind = 'vat' then 0 else l.tax_amount end), 0) into v_base
  from public.vendor_bill_lines l left join public.tax_rates t on t.id = l.tax_rate_id where l.bill_id = p_bill_id;
  select count(*) into n from (select 1 from public.vendor_bill_lines where bill_id = p_bill_id group by account_id, department_id) g;
  for r in select l.account_id, l.department_id, sum(l.net_amount + case when t.kind = 'vat' then 0 else l.tax_amount end) as amt
           from public.vendor_bill_lines l left join public.tax_rates t on t.id = l.tax_rate_id
           where l.bill_id = p_bill_id group by l.account_id, l.department_id order by l.account_id, l.department_id nulls last loop
    i := i + 1;
    v_part := case when i = n then v_left else round((p_amount - v_vat) * r.amt / nullif(v_base, 0), v_dec) end;
    v_left := v_left - v_part;
    if v_part <> 0 then
      v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', r.account_id, 'department_id', r.department_id, 'credit', v_part));
    end if;
  end loop;

  update public.vendor_debit_notes
     set journal_entry_id = app.post_system_entry(v_bill.hotel_id, v_date, 'مرتجع مشتريات / Purchase return — ' || v_bill.bill_number,
                                                  'vendor_bill', v_id, v_bill.bill_number, v_lines)
   where id = v_id;
  perform set_config('app.system_posting', 'off', true);
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2) إعدام الديون المعدومة
-- -----------------------------------------------------------------------------
create table public.invoice_write_offs (
  id               uuid primary key default gen_random_uuid(),
  hotel_id         uuid not null references public.hotels(id),
  invoice_id       uuid not null,
  write_off_date   date not null,
  amount           numeric(19, 4) not null check (amount > 0),
  reason           text not null,
  journal_entry_id uuid references public.journal_entries(id),
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id),
  unique (hotel_id, id),
  foreign key (hotel_id, invoice_id) references public.invoices (hotel_id, id)
);
create trigger invoice_write_offs_system_only before insert or update or delete on public.invoice_write_offs
  for each row execute function app.system_write_only();
alter table public.invoice_write_offs enable row level security;
create policy invoice_write_offs_read on public.invoice_write_offs for select to authenticated
  using (hotel_id in (select app.permitted_hotels('invoices.view')) or hotel_id in (select app.permitted_hotels('customers.view')));
create trigger audit_invoice_write_offs after insert or update or delete on public.invoice_write_offs for each row execute function app.audit_trigger();

create or replace function public.write_off_invoice(p_invoice_id uuid, p_amount numeric, p_reason text, p_date date default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv  public.invoices%rowtype;
  v_date date;
  v_id   uuid;
begin
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  perform app.require_permission(v_inv.hotel_id, 'invoices.write_off');
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  if v_inv.customer_id is null or p_amount is null or p_amount <= 0 or p_amount > v_inv.amount_due - v_inv.amount_paid then
    raise exception 'Write-off must be between 0 and the outstanding amount (%)', v_inv.amount_due - v_inv.amount_paid using errcode = '23514';
  end if;
  v_date := coalesce(p_date, app.today_for_hotel(v_inv.hotel_id));
  perform set_config('app.system_posting', 'on', true);
  insert into public.invoice_write_offs (hotel_id, invoice_id, write_off_date, amount, reason, created_by)
  values (v_inv.hotel_id, v_inv.id, v_date, p_amount, trim(p_reason), auth.uid())
  returning id into v_id;
  update public.invoices set amount_due = amount_due - p_amount where id = v_inv.id;
  perform app.refresh_invoice_paid(v_inv.id);
  update public.invoice_write_offs
     set journal_entry_id = app.post_system_entry(v_inv.hotel_id, v_date, 'إعدام دين معدوم / Bad debt write-off — ' || v_inv.invoice_number,
       'invoice', v_id, v_inv.invoice_number,
       jsonb_build_array(jsonb_build_object('account_id', app.account_by_key(v_inv.hotel_id, 'bad_debt_expense'), 'debit', p_amount),
                         jsonb_build_object('account_id', app.account_by_key(v_inv.hotel_id, 'ar_control'), 'credit', p_amount)))
   where id = v_id;
  perform set_config('app.system_posting', 'off', true);
  return v_id;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.create_vendor_debit_note(uuid, numeric, text, date)',
    'public.write_off_invoice(uuid, numeric, text, date)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
