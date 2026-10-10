-- =============================================================================
-- الترحيل 16: تقييم مخزون دقيق بلا انجراف تقريب + مطابقة الأستاذ العام مع الدفاتر الفرعية
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) قيمة المخزون الجارية (stock_value)
--  المشكلة: الصرف بـ round(الكمية × متوسط التكلفة) مع متوسط مقرّب لـ 6 منازل قد يترك
--  هللات في حساب المخزون بعد نفاد الكمية (انجراف تقريب)، فلا يطابق الأستاذ قيمة المخزون.
--  الحل: نحتفظ بالقيمة الدقيقة لكل صنف (بالعملة الأساسية) ونصرف بنسبة الكمية من القيمة،
--  وعند نفاد الصنف تُصرف القيمة المتبقية كاملة ⇒ حساب المخزون = Σ قيمة الأصناف دائمًا.
-- -----------------------------------------------------------------------------
alter table public.inventory_items add column stock_value numeric(19, 4) not null default 0;

update public.inventory_items i
   set stock_value = coalesce((
     select sum(case when t.quantity > 0 then t.total_cost else -t.total_cost end)
     from public.inventory_transactions t where t.item_id = i.id), 0);

alter table public.inventory_items add constraint inv_value_non_negative check (stock_value >= 0);

create or replace function app.inventory_items_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  perform app.assert_account(new.hotel_id, new.inventory_account_id, array['asset']::public.account_type[]);
  perform app.assert_account(new.hotel_id, new.expense_account_id, array['expense']::public.account_type[]);
  if not app.is_system_posting() then
    if tg_op = 'INSERT' then
      new.quantity_on_hand := 0; new.average_cost := 0; new.stock_value := 0;
    elsif new.quantity_on_hand <> old.quantity_on_hand or new.average_cost <> old.average_cost
       or new.stock_value <> old.stock_value then
      raise exception 'Stock quantity and cost change only through inventory movements' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- حركة مخزون موحّدة (نفس التوقيع والقيود المحاسبية السابقة؛ تغيّر حساب القيمة فقط):
--  receipt / adjustment(+) : القيمة = round(الكمية × تكلفة الوحدة)
--  issue / adjustment(−)   : القيمة = round(الكمية × القيمة الجارية ÷ الكمية المتاحة)،
--                            وعند نفاد الكمية = القيمة المتبقية بالكامل
--  وارد مرتبط بفاتورة مورد: لا يُسمح أن يتجاوز مجموع الوارد المرتبط بها قيمة بنودها على حساب المخزون
create or replace function public.post_inventory_movement(
  p_item_id uuid, p_type public.inventory_txn_type, p_quantity numeric, p_date date default null,
  p_unit_cost numeric default null, p_department_id uuid default null, p_vendor_bill_id uuid default null,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  it        public.inventory_items%rowtype;
  v_date    date;
  v_qty     numeric;
  v_cost    numeric;
  v_total   numeric;
  v_new_q   numeric;
  v_new_val numeric;
  v_id      uuid;
  v_je      uuid;
  v_dec     smallint;
  v_desc    text;
  v_billed  numeric;
  v_recv    numeric;
begin
  select * into it from public.inventory_items where id = p_item_id for update;
  if not found then raise exception 'Item not found' using errcode = 'P0002'; end if;
  perform app.require_permission(it.hotel_id, 'inventory.manage');
  if p_quantity is null or p_quantity = 0 then raise exception 'Quantity must not be zero' using errcode = '22023'; end if;
  if p_vendor_bill_id is not null and p_type <> 'receipt' then
    raise exception 'Only receipts can reference a vendor bill' using errcode = '22023';
  end if;
  v_date := coalesce(p_date, app.today_for_hotel(it.hotel_id));
  v_dec := app.currency_decimals(it.hotel_id);

  if p_type = 'receipt' then
    if p_quantity <= 0 or p_unit_cost is null or p_unit_cost < 0 then
      raise exception 'Receipts need a positive quantity and a unit cost' using errcode = '22023';
    end if;
    v_qty := p_quantity;
  elsif p_type = 'issue' then
    if p_quantity <= 0 then raise exception 'Issue quantity must be positive' using errcode = '22023'; end if;
    if p_department_id is null then raise exception 'Department is required for issues' using errcode = '22023'; end if;
    v_qty := -p_quantity;
  else
    v_qty := p_quantity;
  end if;

  v_new_q := it.quantity_on_hand + v_qty;
  if v_new_q < 0 then
    raise exception 'Insufficient stock for % (on hand %)', it.sku, it.quantity_on_hand using errcode = '23514';
  end if;

  if v_qty > 0 then
    v_cost := coalesce(p_unit_cost,
                       case when it.quantity_on_hand > 0 then it.stock_value / it.quantity_on_hand else it.average_cost end);
    if v_cost < 0 then raise exception 'Unit cost cannot be negative' using errcode = '22023'; end if;
    v_total := round(v_qty * v_cost, v_dec);
    v_new_val := it.stock_value + v_total;
  else
    v_total := case when v_new_q = 0 then it.stock_value
                    else round(abs(v_qty) * it.stock_value / it.quantity_on_hand, v_dec) end;
    v_cost := v_total / abs(v_qty);
    v_new_val := it.stock_value - v_total;
  end if;

  if p_type = 'receipt' and p_vendor_bill_id is not null then
    -- نفس مبلغ القيد في فاتورة المورد: الصافي + الضريبة غير القابلة للاسترداد (غير VAT)
    select coalesce(sum(l.net_amount + case when t.kind = 'vat' then 0 else l.tax_amount end), 0) into v_billed
      from public.vendor_bill_lines l
      join public.vendor_bills b on b.id = l.bill_id and b.hotel_id = it.hotel_id
      left join public.tax_rates t on t.id = l.tax_rate_id
     where l.bill_id = p_vendor_bill_id and l.account_id = it.inventory_account_id;
    if v_billed = 0 then
      raise exception 'The vendor bill has no line on this item''s inventory account' using errcode = '23514';
    end if;
    select coalesce(sum(t.total_cost), 0) into v_recv
      from public.inventory_transactions t
      join public.inventory_items i on i.id = t.item_id and i.inventory_account_id = it.inventory_account_id
     where t.vendor_bill_id = p_vendor_bill_id and t.txn_type = 'receipt';
    if v_recv + v_total > v_billed then
      raise exception 'Receipts exceed the vendor bill amount for this inventory account (billed %, already received %)',
        v_billed, v_recv using errcode = '23514';
    end if;
  end if;

  v_desc := coalesce(nullif(trim(p_description), ''), it.name_ar);

  perform set_config('app.system_posting', 'on', true);
  insert into public.inventory_transactions (hotel_id, item_id, txn_type, txn_date, quantity, unit_cost, total_cost,
    department_id, vendor_bill_id, description, created_by)
  values (it.hotel_id, it.id, p_type, v_date, v_qty, round(v_cost, 6), v_total, p_department_id, p_vendor_bill_id, v_desc, auth.uid())
  returning id into v_id;

  update public.inventory_items
     set quantity_on_hand = v_new_q,
         stock_value = v_new_val,
         -- متوسط التكلفة المعروض = القيمة ÷ الكمية (يبقى آخر متوسط عند نفاد الصنف)
         average_cost = case when v_new_q > 0 then round(v_new_val / v_new_q, 6) else average_cost end
   where id = it.id;

  if v_total > 0 and not (p_type = 'receipt' and p_vendor_bill_id is not null) then
    v_je := app.post_system_entry(it.hotel_id, v_date, 'مخزون / Inventory — ' || v_desc, 'inventory', v_id, it.sku,
      case
        when p_type = 'issue' then jsonb_build_array(
          jsonb_build_object('account_id', it.expense_account_id, 'department_id', p_department_id, 'debit', v_total),
          jsonb_build_object('account_id', it.inventory_account_id, 'credit', v_total))
        when v_qty > 0 then jsonb_build_array(
          jsonb_build_object('account_id', it.inventory_account_id, 'debit', v_total),
          jsonb_build_object('account_id', app.account_by_key(it.hotel_id, 'inventory_adjustment'), 'department_id', p_department_id, 'credit', v_total))
        else jsonb_build_array(
          jsonb_build_object('account_id', app.account_by_key(it.hotel_id, 'inventory_adjustment'), 'department_id', p_department_id, 'debit', v_total),
          jsonb_build_object('account_id', it.inventory_account_id, 'credit', v_total))
      end);
    perform set_config('app.system_posting', 'on', true);
    update public.inventory_transactions set journal_entry_id = v_je where id = v_id;
  end if;
  perform set_config('app.system_posting', 'off', true);
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- 2) مطابقة حسابات المراقبة في الأستاذ العام مع دفاترها الفرعية (للوحة التحكم والتدقيق)
--   الفرق = رصيد الأستاذ − رصيد الدفتر الفرعي − البنود المطابِقة المعروفة؛ يجب أن يكون صفرًا.
--   guest_ledger        : مدين ذمم النزلاء        = Σ أرصدة الفوليوهات
--   guest_deposits      : دائن ودائع النزلاء       = Σ ودائع الفوليوهات غير المطبّقة
--   accounts_receivable : مدين الذمم المدينة       = Σ المتبقي على الفواتير − Σ الأرصدة الدائنة غير المخصصة للعملاء
--   accounts_payable    : دائن الذمم الدائنة       = Σ المتبقي على فواتير الموردين
--   inventory           : مدين حسابات المخزون      = Σ قيمة الأصناف
--                          + بند مطابقة: مشتريات مفوترة على حساب المخزون لم تُسجَّل كوارد بعد
--   trial_balance       : Σ المدين = Σ الدائن لكل القيود المرحّلة
-- -----------------------------------------------------------------------------
create or replace function public.ledger_reconciliation(p_hotel_id uuid)
returns table (control text, gl_balance numeric, subledger_balance numeric, reconciling_items numeric, difference numeric)
language plpgsql
stable
set search_path = ''
as $$
declare
  v_gl_guest numeric; v_gl_dep numeric; v_gl_ar numeric; v_gl_ap numeric; v_gl_inv numeric;
  v_sub_guest numeric; v_sub_dep numeric; v_sub_ar numeric; v_sub_ap numeric; v_sub_inv numeric;
  v_pending numeric; v_dr numeric; v_cr numeric;
begin
  perform app.require_permission(p_hotel_id, 'reports.financial.view');

  with gl as (
    select a.id, a.system_key, sum(l.base_debit - l.base_credit) as bal
    from public.journal_entry_lines l
    join public.journal_entries j on j.id = l.journal_entry_id and j.status = 'posted'
    join public.chart_of_accounts a on a.id = l.account_id
    where l.hotel_id = p_hotel_id
    group by a.id, a.system_key
  )
  select coalesce(sum(bal) filter (where system_key = 'guest_ledger'), 0),
         coalesce(-sum(bal) filter (where system_key = 'guest_deposits'), 0),
         coalesce(sum(bal) filter (where system_key = 'ar_control'), 0),
         coalesce(-sum(bal) filter (where system_key = 'ap_control'), 0),
         coalesce(sum(bal) filter (where id in (select inventory_account_id from public.inventory_items where hotel_id = p_hotel_id)), 0)
    into v_gl_guest, v_gl_dep, v_gl_ar, v_gl_ap, v_gl_inv
  from gl;

  select coalesce(sum(balance), 0), coalesce(sum(deposit_balance), 0) into v_sub_guest, v_sub_dep
    from public.folio_balances where hotel_id = p_hotel_id;

  select coalesce((select sum(amount_due - amount_paid) from public.invoices where hotel_id = p_hotel_id), 0)
       - coalesce((select sum(unapplied_credit) from public.customer_balances where hotel_id = p_hotel_id), 0)
    into v_sub_ar;

  select coalesce(sum(total - amount_paid), 0) into v_sub_ap from public.vendor_bills where hotel_id = p_hotel_id;

  select coalesce(sum(stock_value), 0) into v_sub_inv from public.inventory_items where hotel_id = p_hotel_id;

  select coalesce((select sum(l.net_amount + case when t.kind = 'vat' then 0 else l.tax_amount end)
                    from public.vendor_bill_lines l
                    join public.vendor_bills b on b.id = l.bill_id
                    left join public.tax_rates t on t.id = l.tax_rate_id
                   where b.hotel_id = p_hotel_id
                     and l.account_id in (select inventory_account_id from public.inventory_items where hotel_id = p_hotel_id)), 0)
       - coalesce((select sum(t.total_cost) from public.inventory_transactions t
                   where t.hotel_id = p_hotel_id and t.txn_type = 'receipt' and t.vendor_bill_id is not null), 0)
    into v_pending;

  select coalesce(sum(l.base_debit), 0), coalesce(sum(l.base_credit), 0) into v_dr, v_cr
    from public.journal_entry_lines l
    join public.journal_entries j on j.id = l.journal_entry_id and j.status = 'posted'
   where l.hotel_id = p_hotel_id;

  return query values
    ('guest_ledger',        v_gl_guest, v_sub_guest, 0::numeric, v_gl_guest - v_sub_guest),
    ('guest_deposits',      v_gl_dep,   v_sub_dep,   0::numeric, v_gl_dep - v_sub_dep),
    ('accounts_receivable', v_gl_ar,    v_sub_ar,    0::numeric, v_gl_ar - v_sub_ar),
    ('accounts_payable',    v_gl_ap,    v_sub_ap,    0::numeric, v_gl_ap - v_sub_ap),
    ('inventory',           v_gl_inv,   v_sub_inv,   v_pending,  v_gl_inv - v_sub_inv - v_pending),
    ('trial_balance',       v_dr,       v_cr,        0::numeric, v_dr - v_cr);
end;
$$;

revoke execute on function public.ledger_reconciliation(uuid) from public, anon;
grant execute on function public.ledger_reconciliation(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 3) الإشعار الدائن يحمل قسم بنود الفاتورة: كان خصم الإيراد يُقيد بلا قسم، فيظهر إيراد
--    القسم في تقرير الربحية ولوحة التحكم أعلى من صافي الإيراد في الأستاذ بمقدار الإشعار.
-- -----------------------------------------------------------------------------
create or replace function public.create_credit_note(p_invoice_id uuid, p_amount numeric, p_reason text, p_date date default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inv   public.invoices%rowtype;
  v_dec   smallint;
  v_tax   numeric;
  v_net   numeric;
  v_date  date;
  v_id    uuid;
  v_lines jsonb;
  v_left  numeric;
  r       record;
  v_part  numeric;
  i       integer := 0;
  n       integer;
  v_items numeric;
  v_nleft numeric;
begin
  select * into v_inv from public.invoices where id = p_invoice_id for update;
  if not found then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;
  perform app.require_permission(v_inv.hotel_id, 'invoices.credit_note');
  if length(trim(coalesce(p_reason, ''))) = 0 then
    raise exception 'A reason is required' using errcode = '22023';
  end if;
  if p_amount is null or p_amount <= 0 or p_amount > v_inv.amount_due - v_inv.amount_paid then
    raise exception 'Credit note must be between 0 and the outstanding amount (%)', v_inv.amount_due - v_inv.amount_paid
      using errcode = '23514';
  end if;
  v_dec := app.currency_decimals(v_inv.hotel_id);
  v_date := coalesce(p_date, app.today_for_hotel(v_inv.hotel_id));
  v_tax := case when v_inv.total = 0 then 0 else round(p_amount * v_inv.tax_total / v_inv.total, v_dec) end;
  v_net := p_amount - v_tax;

  perform set_config('app.system_posting', 'on', true);
  insert into public.credit_notes (hotel_id, credit_note_number, invoice_id, issue_date, net_amount, tax_amount, total, reason, created_by)
  values (v_inv.hotel_id, app.next_document_number(v_inv.hotel_id, 'credit_note', 'CN', v_date), v_inv.id, v_date,
          v_net, v_tax, p_amount, trim(p_reason), auth.uid())
  returning id into v_id;
  -- المستحق يقل بقيمة الإشعار
  update public.invoices set amount_due = amount_due - p_amount where id = v_inv.id;
  perform app.refresh_invoice_paid(v_inv.id);

  -- توزيع ضريبة الإشعار على ضرائب الفاتورة بالنسبة (الأخير يأخذ فرق التقريب)
  -- خصم الإيراد يُوزَّع على أقسام بنود الفاتورة بنسبة صافي كل قسم (الأخير يأخذ فرق التقريب)،
  -- حتى تبقى ربحية الأقسام مطابقة لإجمالي الإيراد في الأستاذ
  v_lines := jsonb_build_array(
    jsonb_build_object('account_id', app.account_by_key(v_inv.hotel_id, 'ar_control'), 'credit', p_amount));
  select coalesce(sum(net_amount), 0) into v_items from public.invoice_items where invoice_id = v_inv.id;
  select count(*) into n from (select department_id from public.invoice_items where invoice_id = v_inv.id
                               group by department_id having sum(net_amount) <> 0) d;
  if v_items = 0 or n = 0 then
    v_lines := v_lines || jsonb_build_array(
      jsonb_build_object('account_id', app.account_by_key(v_inv.hotel_id, 'revenue_discounts'), 'debit', v_net));
  else
    v_nleft := v_net;
    for r in select department_id, sum(net_amount) as net from public.invoice_items where invoice_id = v_inv.id
             group by department_id having sum(net_amount) <> 0 order by department_id nulls last loop
      i := i + 1;
      v_part := case when i = n then v_nleft else round(v_net * r.net / v_items, v_dec) end;
      v_nleft := v_nleft - v_part;
      if v_part <> 0 then
        v_lines := v_lines || jsonb_build_array(jsonb_build_object(
          'account_id', app.account_by_key(v_inv.hotel_id, 'revenue_discounts'), 'department_id', r.department_id, 'debit', v_part));
      end if;
    end loop;
    i := 0;
  end if;
  v_left := v_tax;
  select count(*) into n from public.invoice_taxes where invoice_id = v_inv.id and amount <> 0;
  for r in select it.amount, t.account_id from public.invoice_taxes it join public.tax_rates t on t.id = it.tax_rate_id
           where it.invoice_id = v_inv.id and it.amount <> 0 order by t.code loop
    i := i + 1;
    v_part := case when i = n then v_left else round(v_tax * r.amount / v_inv.tax_total, v_dec) end;
    v_left := v_left - v_part;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object('account_id', r.account_id, 'debit', v_part));
  end loop;

  update public.credit_notes
     set journal_entry_id = app.post_system_entry(v_inv.hotel_id, v_date, 'إشعار دائن / Credit note — ' || v_inv.invoice_number,
                                                  'invoice', v_id, v_inv.invoice_number, v_lines)
   where id = v_id;
  perform set_config('app.system_posting', 'off', true);
  return v_id;
end;
$$;
