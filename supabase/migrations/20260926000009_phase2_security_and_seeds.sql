-- =============================================================================
-- المرحلة 2 / الترحيل 9: RLS، صلاحيات التنفيذ، سجل التدقيق، والبيانات الافتراضية
-- =============================================================================

-- -----------------------------------------------------------------------------
-- RLS
-- -----------------------------------------------------------------------------
alter table public.tax_rates               enable row level security;
alter table public.charge_codes            enable row level security;
alter table public.charge_code_taxes       enable row level security;
alter table public.payment_methods         enable row level security;
alter table public.customers               enable row level security;
alter table public.guest_folios            enable row level security;
alter table public.folio_transactions      enable row level security;
alter table public.folio_transaction_taxes enable row level security;
alter table public.invoices                enable row level security;
alter table public.invoice_items           enable row level security;
alter table public.invoice_taxes           enable row level security;
alter table public.payments                enable row level security;
alter table public.payment_allocations     enable row level security;

-- إعدادات الإيراد: يقرؤها كل أعضاء الفندق (يحتاجها الكاشير)، ويديرها من يملك الصلاحية
create policy tax_rates_read on public.tax_rates for select to authenticated using (app.is_hotel_member(hotel_id));
create policy tax_rates_write on public.tax_rates for all to authenticated
  using (app.has_permission(hotel_id, 'settings.revenue.manage'))
  with check (app.has_permission(hotel_id, 'settings.revenue.manage'));

create policy charge_codes_read on public.charge_codes for select to authenticated using (app.is_hotel_member(hotel_id));
create policy charge_codes_write on public.charge_codes for all to authenticated
  using (app.has_permission(hotel_id, 'settings.revenue.manage'))
  with check (app.has_permission(hotel_id, 'settings.revenue.manage'));

create policy charge_code_taxes_read on public.charge_code_taxes for select to authenticated using (app.is_hotel_member(hotel_id));
create policy charge_code_taxes_write on public.charge_code_taxes for all to authenticated
  using (app.has_permission(hotel_id, 'settings.revenue.manage'))
  with check (app.has_permission(hotel_id, 'settings.revenue.manage'));

create policy payment_methods_read on public.payment_methods for select to authenticated using (app.is_hotel_member(hotel_id));
create policy payment_methods_write on public.payment_methods for all to authenticated
  using (app.has_permission(hotel_id, 'settings.revenue.manage'))
  with check (app.has_permission(hotel_id, 'settings.revenue.manage'));

create policy customers_read on public.customers for select to authenticated
  using (app.has_permission(hotel_id, 'customers.view'));
create policy customers_insert on public.customers for insert to authenticated
  with check (app.has_permission(hotel_id, 'customers.manage'));
create policy customers_update on public.customers for update to authenticated
  using (app.has_permission(hotel_id, 'customers.manage'))
  with check (app.has_permission(hotel_id, 'customers.manage'));

-- الفوليو: القراءة بصلاحية العرض؛ تعديل بيانات الرأس (الاسم، الغرفة، التواريخ) بصلاحية الإدارة.
-- الإنشاء والحركات عبر دوال RPC فقط (لا سياسات إدراج).
create policy guest_folios_read on public.guest_folios for select to authenticated
  using (app.has_permission(hotel_id, 'folio.view'));
create policy guest_folios_update on public.guest_folios for update to authenticated
  using (app.has_permission(hotel_id, 'folio.manage'))
  with check (app.has_permission(hotel_id, 'folio.manage'));

create policy folio_transactions_read on public.folio_transactions for select to authenticated
  using (app.has_permission(hotel_id, 'folio.view'));
create policy folio_transaction_taxes_read on public.folio_transaction_taxes for select to authenticated
  using (app.has_permission(hotel_id, 'folio.view'));

create policy invoices_read on public.invoices for select to authenticated
  using (app.has_permission(hotel_id, 'invoices.view'));
create policy invoice_items_read on public.invoice_items for select to authenticated
  using (app.has_permission(hotel_id, 'invoices.view'));
create policy invoice_taxes_read on public.invoice_taxes for select to authenticated
  using (app.has_permission(hotel_id, 'invoices.view'));

create policy payments_read on public.payments for select to authenticated
  using (app.has_permission(hotel_id, 'payments.view'));
create policy payment_allocations_read on public.payment_allocations for select to authenticated
  using (app.has_permission(hotel_id, 'payments.view') or app.has_permission(hotel_id, 'invoices.view'));

-- -----------------------------------------------------------------------------
-- سجل التدقيق للجداول الجديدة
-- -----------------------------------------------------------------------------
create trigger audit_tax_rates after insert or update or delete on public.tax_rates
  for each row execute function app.audit_trigger();
create trigger audit_charge_codes after insert or update or delete on public.charge_codes
  for each row execute function app.audit_trigger();
create trigger audit_payment_methods after insert or update or delete on public.payment_methods
  for each row execute function app.audit_trigger();
create trigger audit_customers after insert or update or delete on public.customers
  for each row execute function app.audit_trigger();
create trigger audit_guest_folios after insert or update or delete on public.guest_folios
  for each row execute function app.audit_trigger();
create trigger audit_folio_transactions after insert or update on public.folio_transactions
  for each row execute function app.audit_trigger();
create trigger audit_invoices after insert or update on public.invoices
  for each row execute function app.audit_trigger();
create trigger audit_payments after insert or update on public.payments
  for each row execute function app.audit_trigger();
create trigger audit_payment_allocations after insert on public.payment_allocations
  for each row execute function app.audit_trigger();

-- -----------------------------------------------------------------------------
-- البيانات الافتراضية: طرق الدفع ورموز الإيراد (الضرائب لا تُفترض — تُضاف من الإعدادات)
-- -----------------------------------------------------------------------------
create or replace function app.seed_revenue_defaults(p_hotel_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.payment_methods (hotel_id, code, name_ar, name_en, kind, account_id)
  select p_hotel_id, m.code, m.name_ar, m.name_en, m.kind::public.payment_method_kind, app.account_by_key(p_hotel_id, m.account_key)
  from (values
    ('CASH',   'نقدًا',                 'Cash',                   'cash',          'cash'),
    ('CARD',   'بطاقة ائتمان / مدى',    'Credit / debit card',    'card',          'card_clearing'),
    ('BANK',   'تحويل بنكي',            'Bank transfer',          'bank_transfer', 'bank'),
    ('CHEQUE', 'شيك',                   'Cheque',                 'cheque',        'bank'),
    ('WALLET', 'محفظة إلكترونية',       'E-wallet',               'e_wallet',      'card_clearing'),
    ('CREDIT', 'آجل (حساب شركة)',       'City ledger (credit)',   'city_ledger',   'ar_control')
  ) as m(code, name_ar, name_en, kind, account_key)
  on conflict (hotel_id, code) do nothing;

  insert into public.charge_codes (hotel_id, code, name_ar, name_en, category, department_id, revenue_account_id)
  select p_hotel_id, c.code, c.name_ar, c.name_en, c.category::public.charge_category,
         (select id from public.departments where hotel_id = p_hotel_id and code = c.dept),
         app.account_by_key(p_hotel_id, c.account_key)
  from (values
    ('ROOM',      'إقامة / ليلة',          'Room night',          'room',      'ROOMS',     'revenue_rooms'),
    ('FOOD',      'مطعم - أطعمة',          'Restaurant - food',   'food',      'FNB',       'revenue_restaurant'),
    ('BEV',       'مشروبات',               'Beverages',           'beverage',  'FNB',       'revenue_beverage'),
    ('MINIBAR',   'ميني بار',              'Minibar',             'minibar',   'SHOP',      'revenue_shop'),
    ('SPA',       'خدمات السبا',           'Spa services',        'spa',       'SPA',       'revenue_spa'),
    ('EVENTS',    'قاعات ومؤتمرات',        'Banquets & events',   'events',    'EVENTS',    'revenue_events'),
    ('SHOP',      'المتجر',                'Shop',                'shop',      'SHOP',      'revenue_shop'),
    ('TRANSPORT', 'نقل',                   'Transport',           'transport', 'TRANSPORT', 'revenue_transport'),
    ('TOUR',      'جولات سياحية',          'Tours',               'tours',     'TRANSPORT', 'revenue_transport'),
    ('LAUNDRY',   'غسيل ملابس',            'Laundry',             'laundry',   'LAUNDRY',   'revenue_laundry'),
    ('PARKING',   'مواقف',                 'Parking',             'parking',   'ROOMS',     'revenue_parking'),
    ('MISC',      'إيرادات متنوعة',        'Miscellaneous',       'other',     'ADMIN',     'revenue_misc')
  ) as c(code, name_ar, name_en, category, dept, account_key)
  on conflict (hotel_id, code) do nothing;
end;
$$;

-- الفنادق الموجودة مسبقًا (إن وُجدت) ذات الدليل الافتراضي
do $$
declare
  h uuid;
begin
  for h in
    select distinct hotel_id from public.chart_of_accounts where system_key = 'guest_ledger'
  loop
    perform app.seed_revenue_defaults(h);
  end loop;
end $$;

-- إنشاء فندق: نفس المرحلة 1 + بيانات الإيرادات الافتراضية
create or replace function public.create_hotel(
  p_name_ar                 text,
  p_country_code            char(2),
  p_base_currency           char(3),
  p_name_en                 text default null,
  p_fiscal_year_start_month smallint default 1,
  p_timezone                text default 'Asia/Riyadh',
  p_seed_defaults           boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hotel_id  uuid;
  v_gm_role   uuid;
  v_fy_start  date;
  v_today     date;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  insert into public.hotels (name_ar, name_en, country_code, base_currency, fiscal_year_start_month, timezone)
  values (p_name_ar, p_name_en, upper(p_country_code), upper(p_base_currency), p_fiscal_year_start_month, p_timezone)
  returning id into v_hotel_id;

  select id into v_gm_role from public.roles where is_system and code = 'general_manager';
  insert into public.hotel_members (hotel_id, user_id) values (v_hotel_id, auth.uid());
  insert into public.user_hotel_roles (hotel_id, user_id, role_id) values (v_hotel_id, auth.uid(), v_gm_role);

  update public.users_profiles set default_hotel_id = v_hotel_id
   where id = auth.uid() and default_hotel_id is null;

  if p_seed_defaults then
    perform app.seed_default_departments(v_hotel_id);
    perform app.seed_default_chart_of_accounts(v_hotel_id);
    perform app.seed_revenue_defaults(v_hotel_id);

    v_today := (now() at time zone p_timezone)::date;
    v_fy_start := make_date(extract(year from v_today)::integer, p_fiscal_year_start_month, 1);
    if v_fy_start > v_today then
      v_fy_start := (v_fy_start - interval '1 year')::date;
    end if;
    perform public.create_fiscal_year(v_hotel_id, v_fy_start);
  end if;

  return v_hotel_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- صلاحيات التنفيذ
-- الدوال الجديدة في app تُمنح لـ PUBLIC افتراضيًا عند الإنشاء؛ نسحبها ثم نمنح الضروري فقط.
-- -----------------------------------------------------------------------------
revoke execute on all functions in schema app from public;
grant execute on function app.is_hotel_member(uuid) to authenticated;
grant execute on function app.has_permission(uuid, text) to authenticated;
grant execute on function app.require_permission(uuid, text) to authenticated;
grant execute on function app.normal_balance_of(public.account_type) to authenticated, service_role;
grant execute on function app.subtype_matches_type(public.account_type, public.account_subtype) to authenticated, service_role;
-- تستدعيها تريغرات تعمل بصلاحيات المستخدم
grant execute on function app.is_system_posting() to authenticated, service_role;
grant execute on function app.assert_account(uuid, uuid, public.account_type[]) to authenticated, service_role;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.open_folio(uuid, text, public.folio_type, uuid, text, text, date, date, smallint, uuid, text)',
    'public.post_folio_charge(uuid, uuid, numeric, numeric, date, text, text)',
    'public.post_folio_allowance(uuid, uuid, numeric, text, date)',
    'public.post_folio_payment(uuid, uuid, numeric, date, text, text, uuid)',
    'public.post_folio_refund(uuid, uuid, numeric, date, text, text)',
    'public.post_folio_deposit(uuid, uuid, numeric, date, text, text)',
    'public.refund_folio_deposit(uuid, uuid, numeric, date, text, text)',
    'public.apply_folio_deposit(uuid, numeric, date)',
    'public.transfer_folio_balance(uuid, uuid, numeric, text, date)',
    'public.void_folio_transaction(uuid, text, date)',
    'public.cancel_folio(uuid)',
    'public.checkout_folio(uuid, date)',
    'public.create_direct_invoice(uuid, uuid, jsonb, date, text)',
    'public.create_payment_voucher(uuid, public.voucher_type, public.voucher_party, uuid, numeric, text, date, uuid, uuid, uuid, text, text, jsonb)',
    'public.allocate_payment(uuid, jsonb)',
    'public.void_payment_voucher(uuid, text, date)',
    'public.create_hotel(text, char, char, text, smallint, text, boolean)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
