-- =============================================================================
-- المرحلة 1 / الترحيل 2: دليل الحسابات الهرمي (Chart of Accounts)
-- =============================================================================

create type public.account_type as enum ('asset', 'liability', 'equity', 'revenue', 'expense');

create type public.account_subtype as enum (
  -- أصول
  'current_asset', 'fixed_asset', 'other_asset',
  -- خصوم
  'current_liability', 'long_term_liability',
  -- حقوق ملكية
  'equity',
  -- إيرادات
  'operating_revenue', 'other_revenue',
  -- مصروفات
  'cost_of_sales', 'operating_expense', 'administrative_expense', 'other_expense'
);

create type public.balance_side as enum ('debit', 'credit');

-- الطبيعة الافتراضية للحساب: الأصول والمصروفات مدينة، والباقي دائن
create or replace function app.normal_balance_of(p_type public.account_type)
returns public.balance_side
language sql
immutable
set search_path = ''
as $$
  select case when p_type in ('asset', 'expense')
              then 'debit'::public.balance_side
              else 'credit'::public.balance_side end;
$$;

-- هل التصنيف الفرعي متوافق مع نوع الحساب؟
create or replace function app.subtype_matches_type(p_type public.account_type, p_subtype public.account_subtype)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select case p_type
    when 'asset'     then p_subtype in ('current_asset', 'fixed_asset', 'other_asset')
    when 'liability' then p_subtype in ('current_liability', 'long_term_liability')
    when 'equity'    then p_subtype = 'equity'
    when 'revenue'   then p_subtype in ('operating_revenue', 'other_revenue')
    when 'expense'   then p_subtype in ('cost_of_sales', 'operating_expense', 'administrative_expense', 'other_expense')
  end;
$$;

create table public.chart_of_accounts (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null references public.hotels(id) on delete cascade,
  code            text not null check (code ~ '^[0-9]{1,12}$'),
  name_ar         text not null check (length(trim(name_ar)) > 0),
  name_en         text,
  account_type    public.account_type not null,
  account_subtype public.account_subtype not null,
  normal_balance  public.balance_side generated always as (app.normal_balance_of(account_type)) stored,
  parent_id       uuid,
  level           smallint not null default 1,
  -- حساب تجميعي (رئيسي) لا يقبل القيود، أو حساب فرعي (تفصيلي) يقبل القيود
  is_postable     boolean not null default true,
  -- مركز التكلفة الافتراضي (اختياري) — يُقترح تلقائيًا في سطور القيد
  department_id   uuid,
  -- عملة الحساب (للحسابات البنكية بعملة أجنبية) — null ⇒ أي عملة
  currency_code   char(3) references public.currencies(code),
  -- مفتاح نظامي لربط الحسابات بالترحيل الآلي لاحقًا (cash, ar_control, retained_earnings ...)
  system_key      text check (system_key is null or system_key ~ '^[a-z_]+$'),
  description     text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id),
  unique (hotel_id, code),
  unique (hotel_id, id),
  foreign key (hotel_id, parent_id) references public.chart_of_accounts (hotel_id, id),
  foreign key (hotel_id, department_id) references public.departments (hotel_id, id),
  constraint coa_subtype_matches_type check (app.subtype_matches_type(account_type, account_subtype)),
  constraint coa_not_own_parent check (parent_id is null or parent_id <> id)
);

create unique index coa_system_key_uq on public.chart_of_accounts (hotel_id, system_key) where system_key is not null;
create index coa_parent_idx on public.chart_of_accounts (parent_id);

create trigger coa_set_created before insert on public.chart_of_accounts
  for each row execute function app.set_created_by();
create trigger coa_set_updated before update on public.chart_of_accounts
  for each row execute function app.set_updated_at();

-- -----------------------------------------------------------------------------
-- قواعد سلامة الشجرة:
--  1) الحساب الفرعي يرث نوع الحساب الأب (لا يجوز وضع حساب مصروف تحت الأصول).
--  2) الأب يجب أن يكون حسابًا تجميعيًا (is_postable = false).
--  3) منع الحلقات (A ← B ← A).
--  4) المستوى = مستوى الأب + 1.
-- -----------------------------------------------------------------------------
create or replace function app.coa_validate_tree()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_parent public.chart_of_accounts%rowtype;
  v_cursor uuid;
  v_depth  integer := 0;
begin
  if new.parent_id is null then
    new.level := 1;
  else
    select * into v_parent from public.chart_of_accounts where id = new.parent_id;
    if not found then
      raise exception 'Parent account not found' using errcode = '23503';
    end if;
    if v_parent.account_type <> new.account_type then
      raise exception 'Child account type (%) must match parent type (%)', new.account_type, v_parent.account_type
        using errcode = '23514';
    end if;
    if v_parent.is_postable then
      raise exception 'Parent account % is postable; convert it to a header account first', v_parent.code
        using errcode = '23514';
    end if;

    -- منع الحلقات بتتبع السلسلة للأعلى
    v_cursor := new.parent_id;
    while v_cursor is not null loop
      if v_cursor = new.id then
        raise exception 'Circular account hierarchy' using errcode = '23514';
      end if;
      v_depth := v_depth + 1;
      if v_depth > 20 then
        raise exception 'Account hierarchy too deep' using errcode = '23514';
      end if;
      select parent_id into v_cursor from public.chart_of_accounts where id = v_cursor;
    end loop;

    new.level := v_parent.level + 1;
  end if;

  -- حساب له أبناء لا يمكن أن يصبح قابلًا للترحيل
  if tg_op = 'UPDATE' and new.is_postable and not old.is_postable and exists (
    select 1 from public.chart_of_accounts c where c.parent_id = new.id
  ) then
    raise exception 'Account with children cannot be postable' using errcode = '23514';
  end if;

  -- تغيير نوع حساب له أبناء غير مسموح (يكسر اتساق الشجرة)
  if tg_op = 'UPDATE' and new.account_type <> old.account_type and exists (
    select 1 from public.chart_of_accounts c where c.parent_id = new.id
  ) then
    raise exception 'Cannot change type of an account that has children' using errcode = '23514';
  end if;

  return new;
end;
$$;

create trigger coa_validate_tree before insert or update of parent_id, account_type, is_postable
  on public.chart_of_accounts
  for each row execute function app.coa_validate_tree();

-- تحديث مستوى الأبناء عند نقل حساب داخل الشجرة
create or replace function app.coa_cascade_level()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.level is distinct from old.level then
    update public.chart_of_accounts c set level = new.level + 1 where c.parent_id = new.id;
  end if;
  return null;
end;
$$;

create trigger coa_cascade_level after update of level on public.chart_of_accounts
  for each row execute function app.coa_cascade_level();

-- -----------------------------------------------------------------------------
-- دليل حسابات افتراضي مخصص للفنادق (يُنشأ مع كل فندق جديد، قابل للتخصيص بالكامل)
-- -----------------------------------------------------------------------------
create or replace function app.seed_default_chart_of_accounts(p_hotel_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
begin
  -- (الرمز، رمز الأب، الاسم عربي، الاسم إنجليزي، النوع، التصنيف، تجميعي؟، مفتاح نظامي)
  for r in
    select * from (values
      ('1',    null,  'الأصول',                          'Assets',                         'asset',     'current_asset',        false, null),
      ('11',   '1',   'الأصول المتداولة',                'Current Assets',                 'asset',     'current_asset',        false, null),
      ('1101', '11',  'الصندوق الرئيسي',                 'Main Cash',                      'asset',     'current_asset',        true,  'cash'),
      ('1102', '11',  'صندوق المصروفات النثرية',         'Petty Cash',                     'asset',     'current_asset',        true,  'petty_cash'),
      ('1103', '11',  'البنوك',                          'Banks',                          'asset',     'current_asset',        true,  'bank'),
      ('1104', '11',  'مدفوعات البطاقات قيد التحصيل',    'Card Payments Clearing',         'asset',     'current_asset',        true,  'card_clearing'),
      ('1110', '11',  'ذمم النزلاء (Folio)',             'Guest Ledger',                   'asset',     'current_asset',        true,  'guest_ledger'),
      ('1111', '11',  'ذمم مدينة - شركات وعملاء',        'Accounts Receivable - City Ledger','asset',   'current_asset',        true,  'ar_control'),
      ('1112', '11',  'مخصص الديون المشكوك فيها',        'Allowance for Doubtful Accounts','asset',     'current_asset',        true,  'ar_allowance'),
      ('1120', '11',  'مخزون الأغذية',                   'Food Inventory',                 'asset',     'current_asset',        true,  'inventory_food'),
      ('1121', '11',  'مخزون المشروبات',                 'Beverage Inventory',             'asset',     'current_asset',        true,  'inventory_beverage'),
      ('1122', '11',  'مخزون المستلزمات العامة',         'General Supplies Inventory',     'asset',     'current_asset',        true,  'inventory_supplies'),
      ('1130', '11',  'مصروفات مدفوعة مقدمًا',           'Prepaid Expenses',               'asset',     'current_asset',        true,  'prepaid'),
      ('1140', '11',  'ضريبة القيمة المضافة - مدخلات',   'VAT Input',                      'asset',     'current_asset',        true,  'vat_input'),
      ('12',   '1',   'الأصول الثابتة',                  'Fixed Assets',                   'asset',     'fixed_asset',          false, null),
      ('1201', '12',  'المباني',                         'Buildings',                      'asset',     'fixed_asset',          true,  null),
      ('1202', '12',  'الأثاث والمفروشات',               'Furniture & Fixtures',           'asset',     'fixed_asset',          true,  null),
      ('1203', '12',  'المعدات والأجهزة',                'Equipment',                      'asset',     'fixed_asset',          true,  null),
      ('1204', '12',  'السيارات',                        'Vehicles',                       'asset',     'fixed_asset',          true,  null),
      ('1209', '12',  'مجمع الإهلاك',                    'Accumulated Depreciation',       'asset',     'fixed_asset',          true,  'accumulated_depreciation'),
      ('2',    null,  'الخصوم',                          'Liabilities',                    'liability', 'current_liability',    false, null),
      ('21',   '2',   'الخصوم المتداولة',                'Current Liabilities',            'liability', 'current_liability',    false, null),
      ('2101', '21',  'ذمم دائنة - موردون',              'Accounts Payable',               'liability', 'current_liability',    true,  'ap_control'),
      ('2102', '21',  'ودائع وعربون النزلاء',            'Guest Deposits',                 'liability', 'current_liability',    true,  'guest_deposits'),
      ('2103', '21',  'رواتب مستحقة',                    'Accrued Salaries',               'liability', 'current_liability',    true,  'accrued_salaries'),
      ('2104', '21',  'مصروفات مستحقة',                  'Accrued Expenses',               'liability', 'current_liability',    true,  'accrued_expenses'),
      ('2110', '21',  'ضريبة القيمة المضافة - مخرجات',   'VAT Output',                     'liability', 'current_liability',    true,  'vat_output'),
      ('2111', '21',  'رسوم البلدية / السياحة المستحقة', 'Municipality / Tourism Fee Payable','liability','current_liability',   true,  'tourism_tax_payable'),
      ('2112', '21',  'عمولات وكلاء الحجز المستحقة',     'OTA Commissions Payable',        'liability', 'current_liability',    true,  'commissions_payable'),
      ('22',   '2',   'الخصوم طويلة الأجل',              'Long-term Liabilities',          'liability', 'long_term_liability',  false, null),
      ('2201', '22',  'قروض طويلة الأجل',                'Long-term Loans',                'liability', 'long_term_liability',  true,  null),
      ('2202', '22',  'مخصص مكافأة نهاية الخدمة',        'End of Service Provision',       'liability', 'long_term_liability',  true,  'eos_provision'),
      ('3',    null,  'حقوق الملكية',                    'Equity',                         'equity',    'equity',               false, null),
      ('3101', '3',   'رأس المال',                       'Capital',                        'equity',    'equity',               true,  'capital'),
      ('3102', '3',   'الأرباح المبقاة',                 'Retained Earnings',              'equity',    'equity',               true,  'retained_earnings'),
      ('3103', '3',   'جاري الشركاء',                    'Owners Current Account',         'equity',    'equity',               true,  null),
      ('4',    null,  'الإيرادات',                       'Revenue',                        'revenue',   'operating_revenue',    false, null),
      ('41',   '4',   'الإيرادات التشغيلية',             'Operating Revenue',              'revenue',   'operating_revenue',    false, null),
      ('4101', '41',  'إيرادات الغرف',                   'Rooms Revenue',                  'revenue',   'operating_revenue',    true,  'revenue_rooms'),
      ('4102', '41',  'إيرادات المطعم',                  'Restaurant Revenue',             'revenue',   'operating_revenue',    true,  'revenue_restaurant'),
      ('4103', '41',  'إيرادات المشروبات',               'Beverage Revenue',               'revenue',   'operating_revenue',    true,  'revenue_beverage'),
      ('4104', '41',  'إيرادات السبا والمنتجع الصحي',    'Spa Revenue',                    'revenue',   'operating_revenue',    true,  'revenue_spa'),
      ('4105', '41',  'إيرادات القاعات والمؤتمرات',      'Banquets & Events Revenue',      'revenue',   'operating_revenue',    true,  'revenue_events'),
      ('4106', '41',  'إيرادات المتجر والميني بار',      'Shop & Minibar Revenue',         'revenue',   'operating_revenue',    true,  'revenue_shop'),
      ('4107', '41',  'إيرادات النقل والجولات',          'Transport & Tours Revenue',      'revenue',   'operating_revenue',    true,  'revenue_transport'),
      ('4108', '41',  'إيرادات الغسيل',                  'Laundry Revenue',                'revenue',   'operating_revenue',    true,  'revenue_laundry'),
      ('4109', '41',  'إيرادات المواقف',                 'Parking Revenue',                'revenue',   'operating_revenue',    true,  'revenue_parking'),
      ('4190', '41',  'خصومات مسموح بها',                'Allowances & Discounts',         'revenue',   'operating_revenue',    true,  'revenue_discounts'),
      ('42',   '4',   'إيرادات أخرى',                    'Other Revenue',                  'revenue',   'other_revenue',        false, null),
      ('4201', '42',  'إيرادات متنوعة',                  'Miscellaneous Income',           'revenue',   'other_revenue',        true,  'revenue_misc'),
      ('4202', '42',  'أرباح فروقات العملة',             'FX Gains',                       'revenue',   'other_revenue',        true,  'fx_gain'),
      ('5',    null,  'المصروفات',                       'Expenses',                       'expense',   'operating_expense',    false, null),
      ('51',   '5',   'تكلفة المبيعات',                  'Cost of Sales',                  'expense',   'cost_of_sales',        false, null),
      ('5101', '51',  'تكلفة الأغذية',                   'Cost of Food',                   'expense',   'cost_of_sales',        true,  'cogs_food'),
      ('5102', '51',  'تكلفة المشروبات',                 'Cost of Beverage',               'expense',   'cost_of_sales',        true,  'cogs_beverage'),
      ('5103', '51',  'تكلفة بضاعة المتجر',              'Cost of Shop Goods',             'expense',   'cost_of_sales',        true,  'cogs_shop'),
      ('52',   '5',   'مصروفات تشغيلية',                 'Operating Expenses',             'expense',   'operating_expense',    false, null),
      ('5201', '52',  'الرواتب والأجور',                 'Salaries & Wages',               'expense',   'operating_expense',    true,  'salaries'),
      ('5202', '52',  'البدلات والمزايا',                'Allowances & Benefits',          'expense',   'operating_expense',    true,  'benefits'),
      ('5203', '52',  'التأمينات الاجتماعية',            'Social Insurance',               'expense',   'operating_expense',    true,  'social_insurance'),
      ('5204', '52',  'الكهرباء',                        'Electricity',                    'expense',   'operating_expense',    true,  null),
      ('5205', '52',  'المياه',                          'Water',                          'expense',   'operating_expense',    true,  null),
      ('5206', '52',  'الإنترنت والاتصالات',             'Internet & Telecom',             'expense',   'operating_expense',    true,  null),
      ('5207', '52',  'مستلزمات النظافة',                'Cleaning Supplies',              'expense',   'operating_expense',    true,  null),
      ('5208', '52',  'الصيانة والإصلاحات',              'Repairs & Maintenance',          'expense',   'operating_expense',    true,  null),
      ('5209', '52',  'عمولات وكلاء الحجز (OTA)',        'OTA Commissions',                'expense',   'operating_expense',    true,  'commission_expense'),
      ('5210', '52',  'مصروفات نثرية',                   'Petty Cash Expenses',            'expense',   'operating_expense',    true,  'petty_cash_expense'),
      ('53',   '5',   'مصروفات إدارية وعمومية',          'Administrative & General',       'expense',   'administrative_expense', false, null),
      ('5301', '53',  'الإيجارات',                       'Rent',                           'expense',   'administrative_expense', true, null),
      ('5302', '53',  'التأمين',                         'Insurance',                      'expense',   'administrative_expense', true, null),
      ('5303', '53',  'مصروف الإهلاك',                   'Depreciation Expense',           'expense',   'administrative_expense', true, 'depreciation_expense'),
      ('5304', '53',  'رسوم بنكية',                      'Bank Charges',                   'expense',   'administrative_expense', true, 'bank_charges'),
      ('5305', '53',  'مصروف الديون المعدومة',           'Bad Debt Expense',               'expense',   'administrative_expense', true, 'bad_debt_expense'),
      ('54',   '5',   'مصروفات أخرى',                    'Other Expenses',                 'expense',   'other_expense',        false, null),
      ('5401', '54',  'خسائر فروقات العملة',             'FX Losses',                      'expense',   'other_expense',        true,  'fx_loss')
    ) as t(code, parent_code, name_ar, name_en, account_type, account_subtype, is_postable, system_key)
  loop
    insert into public.chart_of_accounts
      (hotel_id, code, name_ar, name_en, account_type, account_subtype, is_postable, system_key, parent_id)
    values (
      p_hotel_id, r.code, r.name_ar, r.name_en,
      r.account_type::public.account_type, r.account_subtype::public.account_subtype,
      r.is_postable, r.system_key,
      (select c.id from public.chart_of_accounts c where c.hotel_id = p_hotel_id and c.code = r.parent_code)
    );
  end loop;
end;
$$;

-- أقسام افتراضية (مراكز الإيراد والتكلفة)
create or replace function app.seed_default_departments(p_hotel_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.departments (hotel_id, code, name_ar, name_en, kind) values
    (p_hotel_id, 'ROOMS',     'الغرف',                  'Rooms',                 'revenue_center'),
    (p_hotel_id, 'FNB',       'المطعم والمشروبات',      'Food & Beverage',       'revenue_center'),
    (p_hotel_id, 'SPA',       'السبا',                  'Spa',                   'revenue_center'),
    (p_hotel_id, 'EVENTS',    'القاعات والمؤتمرات',     'Banquets & Events',     'revenue_center'),
    (p_hotel_id, 'SHOP',      'المتجر والميني بار',     'Shop & Minibar',        'revenue_center'),
    (p_hotel_id, 'TRANSPORT', 'النقل والجولات',         'Transport & Tours',     'revenue_center'),
    (p_hotel_id, 'LAUNDRY',   'المغسلة',                'Laundry',               'revenue_center'),
    (p_hotel_id, 'ADMIN',     'الإدارة العامة',         'Administration & General','cost_center'),
    (p_hotel_id, 'SALES',     'المبيعات والتسويق',      'Sales & Marketing',     'cost_center'),
    (p_hotel_id, 'MAINT',     'الصيانة',                'Maintenance',           'service_center'),
    (p_hotel_id, 'HK',        'الإشراف الداخلي',        'Housekeeping',          'service_center');
$$;
