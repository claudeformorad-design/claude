-- =============================================================================
-- المرحلة 3: الموردون، أوامر الشراء، فواتير الموردين (ذمم دائنة)، سداد الموردين،
-- الرواتب، العهدة النثرية، الإشعار الدائن، المطابقة البنكية، أعمار الذمم
-- =============================================================================

insert into public.permissions (code, module, action, name_ar, name_en, sort_order) values
  ('vendors.view',        'vendors',  'view',    'عرض الموردين',             'View vendors',            900),
  ('vendors.manage',      'vendors',  'manage',  'إدارة الموردين',           'Manage vendors',          910),
  ('purchases.manage',    'purchases','create',  'أوامر الشراء',             'Purchase orders',         920),
  ('bills.view',          'bills',    'view',    'عرض فواتير الموردين',      'View vendor bills',       930),
  ('bills.create',        'bills',    'create',  'تسجيل فواتير الموردين',    'Record vendor bills',     940),
  ('payroll.manage',      'payroll',  'approve', 'ترحيل الرواتب',            'Post payroll',            950),
  ('bank.reconcile',      'bank',     'approve', 'المطابقة البنكية',         'Bank reconciliation',     960),
  ('invoices.credit_note','invoices', 'approve', 'إصدار إشعار دائن',         'Issue credit notes',      720),
  ('reports.aging.view',  'reports',  'view',    'تقارير أعمار الذمم',       'Aging reports',           310);

insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r cross join public.permissions p
where r.is_system and r.code in ('general_manager', 'accountant')
  and p.code in ('vendors.view','vendors.manage','purchases.manage','bills.view','bills.create','payroll.manage',
                 'bank.reconcile','invoices.credit_note','reports.aging.view')
on conflict do nothing;
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r cross join public.permissions p
where r.is_system and r.code = 'auditor' and p.code in ('vendors.view','bills.view','reports.aging.view')
on conflict do nothing;
insert into public.role_permissions (role_id, permission_code)
select r.id, 'reports.aging.view' from public.roles r where r.is_system and r.code = 'department_manager'
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- الموردون
-- -----------------------------------------------------------------------------
create table public.vendors (
  id                  uuid primary key default gen_random_uuid(),
  hotel_id            uuid not null references public.hotels(id) on delete cascade,
  code                text not null check (code ~ '^[A-Z0-9_-]{1,20}$'),
  name_ar             text not null check (length(trim(name_ar)) > 0),
  name_en             text,
  tax_number          text,
  phone               text,
  email               text,
  address             text,
  payment_terms_days  integer not null default 30 check (payment_terms_days between 0 and 365),
  -- حساب المصروف الافتراضي لفواتيره (اختياري)
  default_account_id  uuid,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users(id),
  unique (hotel_id, code),
  unique (hotel_id, id),
  foreign key (hotel_id, default_account_id) references public.chart_of_accounts (hotel_id, id)
);
create trigger vendors_set_created before insert on public.vendors for each row execute function app.set_created_by();
create trigger vendors_set_updated before update on public.vendors for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- أوامر الشراء (مستند غير محاسبي — القيد يُنشأ عند فاتورة المورد)
-- -----------------------------------------------------------------------------
create type public.po_status as enum ('open', 'billed', 'cancelled');

create table public.purchase_orders (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references public.hotels(id),
  po_number   text not null,
  vendor_id   uuid not null,
  order_date  date not null,
  status      public.po_status not null default 'open',
  notes       text,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id),
  unique (hotel_id, po_number),
  unique (hotel_id, id),
  foreign key (hotel_id, vendor_id) references public.vendors (hotel_id, id)
);

create table public.purchase_order_items (
  id             uuid primary key default gen_random_uuid(),
  po_id          uuid not null,
  hotel_id       uuid not null,
  line_no        integer not null,
  description    text not null,
  account_id     uuid not null,
  department_id  uuid,
  quantity       numeric(12, 3) not null check (quantity > 0),
  unit_price     numeric(19, 4) not null check (unit_price >= 0),
  tax_rate_id    uuid,
  unique (po_id, line_no),
  foreign key (hotel_id, po_id) references public.purchase_orders (hotel_id, id),
  foreign key (hotel_id, account_id) references public.chart_of_accounts (hotel_id, id),
  foreign key (hotel_id, department_id) references public.departments (hotel_id, id),
  foreign key (hotel_id, tax_rate_id) references public.tax_rates (hotel_id, id)
);

-- -----------------------------------------------------------------------------
-- فواتير الموردين
-- الضريبة: نوع vat ⇒ ضريبة مدخلات قابلة للاسترداد (vat_input)؛ غيرها يُحمّل على المصروف
-- -----------------------------------------------------------------------------
create type public.bill_status as enum ('open', 'partially_paid', 'paid');

create table public.vendor_bills (
  id                 uuid primary key default gen_random_uuid(),
  hotel_id           uuid not null references public.hotels(id),
  bill_number        text not null,
  vendor_id          uuid not null,
  vendor_invoice_no  text,
  po_id              uuid unique,
  bill_date          date not null,
  due_date           date not null,
  subtotal           numeric(19, 4) not null,
  tax_total          numeric(19, 4) not null,
  total              numeric(19, 4) not null check (total >= 0),
  amount_paid        numeric(19, 4) not null default 0 check (amount_paid >= 0),
  status             public.bill_status not null default 'open',
  journal_entry_id   uuid references public.journal_entries(id),
  notes              text,
  created_at         timestamptz not null default now(),
  created_by         uuid references auth.users(id),
  unique (hotel_id, bill_number),
  unique (hotel_id, id),
  foreign key (hotel_id, vendor_id) references public.vendors (hotel_id, id),
  foreign key (hotel_id, po_id) references public.purchase_orders (hotel_id, id),
  constraint bill_totals check (subtotal + tax_total = total),
  constraint bill_paid_le_total check (amount_paid <= total)
);
create unique index vendor_bills_vendor_invoice_uq on public.vendor_bills (hotel_id, vendor_id, vendor_invoice_no)
  where vendor_invoice_no is not null;

create table public.vendor_bill_lines (
  id             uuid primary key default gen_random_uuid(),
  bill_id        uuid not null,
  hotel_id       uuid not null,
  line_no        integer not null,
  description    text not null,
  account_id     uuid not null,
  department_id  uuid,
  quantity       numeric(12, 3) not null,
  unit_price     numeric(19, 4) not null,
  net_amount     numeric(19, 4) not null,
  tax_rate_id    uuid,
  tax_amount     numeric(19, 4) not null default 0,
  unique (bill_id, line_no),
  foreign key (hotel_id, bill_id) references public.vendor_bills (hotel_id, id),
  foreign key (hotel_id, account_id) references public.chart_of_accounts (hotel_id, id),
  foreign key (hotel_id, department_id) references public.departments (hotel_id, id),
  foreign key (hotel_id, tax_rate_id) references public.tax_rates (hotel_id, id)
);

-- سداد الموردين: السند بطرف "مورد" وتخصيصه على فواتير المورد
alter type public.voucher_party add value if not exists 'vendor';
