-- =============================================================================
-- المرحلة 2 / الترحيل 6: إعدادات الإيرادات + محرك الترحيل الآلي
--  * الضرائب (قابلة للتهيئة بالكامل: بسيطة/مركّبة، شامل/غير شامل)
--  * رموز الإيراد (Charge Codes) لكل أقسام الفندق
--  * طرق الدفع وربطها بالحسابات
--  * العملاء (للفواتير الآجلة)
--  * محرك الترحيل الآلي: المستندات (فوليو، فواتير، سندات) تنشئ قيودها بنفسها
-- =============================================================================

-- -----------------------------------------------------------------------------
-- صلاحيات جديدة
-- -----------------------------------------------------------------------------
insert into public.permissions (code, module, action, name_ar, name_en, sort_order) values
  ('settings.revenue.manage', 'settings', 'manage',  'إدارة الضرائب ورموز الإيراد وطرق الدفع', 'Manage taxes, charge codes & payment methods', 50),
  ('customers.view',          'customers','view',    'عرض العملاء',                    'View customers',                 500),
  ('customers.manage',        'customers','manage',  'إدارة العملاء',                  'Manage customers',               510),
  ('folio.view',              'folio',    'view',    'عرض الفوليو',                    'View folios',                    600),
  ('folio.manage',            'folio',    'create',  'فتح الفوليو وتسجيل الرسوم والمدفوعات', 'Open folios, post charges & payments', 610),
  ('folio.allowance',         'folio',    'approve', 'منح الخصومات والتسويات',         'Grant allowances / discounts',   620),
  ('folio.void',              'folio',    'approve', 'إلغاء حركات الفوليو',            'Void folio transactions',        630),
  ('folio.checkout',          'folio',    'approve', 'إغلاق الفوليو وإصدار الفاتورة',  'Check out & issue invoice',      640),
  ('invoices.view',           'invoices', 'view',    'عرض الفواتير',                   'View invoices',                  700),
  ('invoices.create',         'invoices', 'create',  'إصدار الفواتير المباشرة',        'Issue direct invoices',          710),
  ('payments.view',           'payments', 'view',    'عرض السندات',                    'View vouchers',                  800),
  ('payments.receipt',        'payments', 'create',  'إصدار سندات القبض',              'Issue receipt vouchers',         810),
  ('payments.disbursement',   'payments', 'create',  'إصدار سندات الصرف',              'Issue payment vouchers',         820),
  ('payments.void',           'payments', 'approve', 'إلغاء السندات',                  'Void vouchers',                  830);

-- المدير العام: كل الصلاحيات الجديدة
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r cross join public.permissions p
where r.is_system and r.code = 'general_manager'
  and p.code not in (select permission_code from public.role_permissions where role_id = r.id);

-- المحاسب: كل الصلاحيات الجديدة
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r cross join public.permissions p
where r.is_system and r.code = 'accountant'
  and (p.module in ('customers', 'folio', 'invoices', 'payments') or p.code = 'settings.revenue.manage');

-- المدقق: العرض فقط
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r cross join public.permissions p
where r.is_system and r.code = 'auditor' and p.action = 'view'
  and p.code not in (select permission_code from public.role_permissions where role_id = r.id);

-- الكاشير: عمليات الفوليو اليومية وسندات القبض (بدون خصومات أو إلغاء)
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r cross join public.permissions p
where r.is_system and r.code = 'cashier'
  and p.code in ('customers.view', 'folio.view', 'folio.manage', 'folio.checkout',
                 'invoices.view', 'payments.view', 'payments.receipt');

-- مدير القسم: العرض
insert into public.role_permissions (role_id, permission_code)
select r.id, p.code from public.roles r cross join public.permissions p
where r.is_system and r.code = 'department_manager'
  and p.code in ('folio.view', 'invoices.view', 'customers.view');

-- -----------------------------------------------------------------------------
-- تحقق مشترك: الحساب من نفس الفندق، تفصيلي، فعّال، ومن الأنواع المسموحة
-- -----------------------------------------------------------------------------
create or replace function app.assert_account(p_hotel_id uuid, p_account_id uuid, p_types public.account_type[])
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v public.chart_of_accounts%rowtype;
begin
  select * into v from public.chart_of_accounts where id = p_account_id;
  if not found or v.hotel_id <> p_hotel_id then
    raise exception 'Account does not belong to this hotel' using errcode = '23503';
  end if;
  if not v.is_postable or not v.is_active then
    raise exception 'Account % is inactive or is a header account', v.code using errcode = '23514';
  end if;
  if not (v.account_type = any (p_types)) then
    raise exception 'Account % has type % but % is required', v.code, v.account_type, p_types using errcode = '23514';
  end if;
end;
$$;

create or replace function app.account_by_key(p_hotel_id uuid, p_key text)
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  select id into v_id from public.chart_of_accounts where hotel_id = p_hotel_id and system_key = p_key;
  if v_id is null then
    raise exception 'System account "%" is not configured in the chart of accounts', p_key using errcode = '23514';
  end if;
  return v_id;
end;
$$;

create or replace function app.currency_decimals(p_hotel_id uuid)
returns smallint
language sql
stable
security definer
set search_path = ''
as $$
  select c.decimals from public.hotels h join public.currencies c on c.code = h.base_currency where h.id = p_hotel_id;
$$;

-- -----------------------------------------------------------------------------
-- الضرائب
-- -----------------------------------------------------------------------------
create type public.tax_kind as enum ('vat', 'tourism_fee', 'municipality_fee', 'service_charge', 'other');

create table public.tax_rates (
  id           uuid primary key default gen_random_uuid(),
  hotel_id     uuid not null references public.hotels(id) on delete cascade,
  code         text not null check (code ~ '^[A-Z0-9_-]{1,20}$'),
  name_ar      text not null,
  name_en      text,
  kind         public.tax_kind not null,
  -- النسبة المئوية: 15 تعني 15%
  rate         numeric(7, 4) not null check (rate >= 0 and rate <= 100),
  -- مركّبة: تُحسب على (الصافي + الضرائب البسيطة)
  is_compound  boolean not null default false,
  -- حساب الالتزام الضريبي (دائن عند البيع)
  account_id   uuid not null,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id),
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id),
  unique (hotel_id, code),
  unique (hotel_id, id),
  foreign key (hotel_id, account_id) references public.chart_of_accounts (hotel_id, id)
);

create trigger tax_rates_set_created before insert on public.tax_rates
  for each row execute function app.set_created_by();
create trigger tax_rates_set_updated before update on public.tax_rates
  for each row execute function app.set_updated_at();

create or replace function app.tax_rates_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform app.assert_account(new.hotel_id, new.account_id, array['liability']::public.account_type[]);
  return new;
end;
$$;

create trigger tax_rates_validate before insert or update of account_id on public.tax_rates
  for each row execute function app.tax_rates_validate();

-- -----------------------------------------------------------------------------
-- حساب الضرائب — مطابق حرفيًا لـ src/lib/accounting/tax.ts (انظر الشرح هناك)
-- يعيد: { net, tax_total, total, taxes: [{tax_rate_id, taxable_base, amount}] }
-- الترتيب: الضرائب البسيطة أولًا ثم المركّبة، وداخل كل مجموعة حسب الرمز.
-- -----------------------------------------------------------------------------
create or replace function app.compute_taxes(
  p_amount     numeric,
  p_inclusive  boolean,
  p_tax_ids    uuid[],
  p_decimals   integer
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_entered       numeric := round(p_amount, p_decimals);
  v_simple_rate   numeric;
  v_compound_rate numeric;
  v_net0          numeric;  -- الصافي المبدئي (أساس حساب مبالغ الضرائب)
  v_net           numeric;  -- الصافي النهائي بعد ضبط التقريب
  v_simple_sum    numeric;
  v_tax_total     numeric;
  v_taxes         jsonb;
begin
  if v_entered < 0 then
    raise exception 'Amount must not be negative' using errcode = '22023';
  end if;

  select coalesce(sum(rate) filter (where not is_compound), 0) / 100,
         coalesce(sum(rate) filter (where is_compound), 0) / 100
    into v_simple_rate, v_compound_rate
  from public.tax_rates where id = any (coalesce(p_tax_ids, '{}'));

  -- 1) الصافي المبدئي: في السعر الشامل الإجمالي = الصافي × (1 + Σبسيطة) × (1 + Σمركّبة)
  v_net0 := case when p_inclusive
                 then round(v_entered / ((1 + v_simple_rate) * (1 + v_compound_rate)), p_decimals)
                 else v_entered end;

  -- 2) الضرائب البسيطة على الصافي، والمركّبة على (الصافي + البسيطة)، كلٌّ مقرّبة
  select coalesce(sum(round(v_net0 * rate / 100, p_decimals)), 0) into v_simple_sum
  from public.tax_rates where id = any (coalesce(p_tax_ids, '{}')) and not is_compound;

  with lines as (
    select t.id, t.code, t.is_compound,
           case when t.is_compound then round((v_net0 + v_simple_sum) * t.rate / 100, p_decimals)
                else round(v_net0 * t.rate / 100, p_decimals) end as amount
    from public.tax_rates t
    where t.id = any (coalesce(p_tax_ids, '{}'))
  )
  select coalesce(sum(amount), 0),
         coalesce(jsonb_agg(jsonb_build_object('tax_rate_id', id, 'is_compound', is_compound, 'amount', amount)
                            order by is_compound, code), '[]'::jsonb)
    into v_tax_total, v_taxes
  from lines;

  -- 3) السعر الشامل: الصافي = المبلغ المدخل − مجموع الضرائب المقرّبة (يطابق المدخل حرفيًا)
  v_net := case when p_inclusive then v_entered - v_tax_total else v_net0 end;

  -- الوعاء الضريبي يتبع الصافي النهائي
  select coalesce(jsonb_agg(jsonb_build_object(
           'tax_rate_id', e ->> 'tax_rate_id',
           'taxable_base', case when (e ->> 'is_compound')::boolean then v_net + v_simple_sum else v_net end,
           'amount', (e ->> 'amount')::numeric
         ) order by ord), '[]'::jsonb)
    into v_taxes
  from jsonb_array_elements(v_taxes) with ordinality as x(e, ord);

  return jsonb_build_object('net', v_net, 'tax_total', v_tax_total, 'total', v_net + v_tax_total, 'taxes', v_taxes);
end;
$$;

-- -----------------------------------------------------------------------------
-- رموز الإيراد (Charge Codes): كل ما يُباع في الفندق — غرف، مطعم، سبا، قاعات، متجر...
-- -----------------------------------------------------------------------------
create type public.charge_category as enum (
  'room', 'food', 'beverage', 'minibar', 'spa', 'events', 'shop',
  'transport', 'tours', 'laundry', 'parking', 'telephone', 'other'
);

create table public.charge_codes (
  id                  uuid primary key default gen_random_uuid(),
  hotel_id            uuid not null references public.hotels(id) on delete cascade,
  code                text not null check (code ~ '^[A-Z0-9_-]{1,20}$'),
  name_ar             text not null,
  name_en             text,
  category            public.charge_category not null,
  department_id       uuid not null,
  revenue_account_id  uuid not null,
  default_price       numeric(19, 4) check (default_price is null or default_price >= 0),
  price_includes_tax  boolean not null default false,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users(id),
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users(id),
  unique (hotel_id, code),
  unique (hotel_id, id),
  foreign key (hotel_id, department_id) references public.departments (hotel_id, id),
  foreign key (hotel_id, revenue_account_id) references public.chart_of_accounts (hotel_id, id)
);

create trigger charge_codes_set_created before insert on public.charge_codes
  for each row execute function app.set_created_by();
create trigger charge_codes_set_updated before update on public.charge_codes
  for each row execute function app.set_updated_at();

create or replace function app.charge_codes_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform app.assert_account(new.hotel_id, new.revenue_account_id, array['revenue']::public.account_type[]);
  return new;
end;
$$;

create trigger charge_codes_validate before insert or update of revenue_account_id on public.charge_codes
  for each row execute function app.charge_codes_validate();

create table public.charge_code_taxes (
  hotel_id        uuid not null,
  charge_code_id  uuid not null,
  tax_rate_id     uuid not null,
  primary key (charge_code_id, tax_rate_id),
  foreign key (hotel_id, charge_code_id) references public.charge_codes (hotel_id, id) on delete cascade,
  foreign key (hotel_id, tax_rate_id) references public.tax_rates (hotel_id, id) on delete cascade
);

-- -----------------------------------------------------------------------------
-- طرق الدفع
-- -----------------------------------------------------------------------------
create type public.payment_method_kind as enum (
  'cash', 'card', 'bank_transfer', 'cheque', 'e_wallet',
  -- آجل: تحويل الرصيد إلى ذمة مدينة على شركة/عميل (City Ledger)
  'city_ledger'
);

create table public.payment_methods (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references public.hotels(id) on delete cascade,
  code        text not null check (code ~ '^[A-Z0-9_-]{1,20}$'),
  name_ar     text not null,
  name_en     text,
  kind        public.payment_method_kind not null,
  -- الحساب المدين عند القبض (صندوق، بنك، مدفوعات بطاقات قيد التحصيل، ذمم مدينة للآجل)
  account_id  uuid not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id),
  unique (hotel_id, code),
  unique (hotel_id, id),
  foreign key (hotel_id, account_id) references public.chart_of_accounts (hotel_id, id)
);

create trigger payment_methods_set_created before insert on public.payment_methods
  for each row execute function app.set_created_by();
create trigger payment_methods_set_updated before update on public.payment_methods
  for each row execute function app.set_updated_at();

create or replace function app.payment_methods_validate()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform app.assert_account(new.hotel_id, new.account_id, array['asset']::public.account_type[]);
  return new;
end;
$$;

create trigger payment_methods_validate before insert or update of account_id on public.payment_methods
  for each row execute function app.payment_methods_validate();

-- -----------------------------------------------------------------------------
-- العملاء (أفراد وشركات ووكالات سفر ومنصات حجز) — أساس الذمم المدينة
-- -----------------------------------------------------------------------------
create type public.customer_type as enum ('individual', 'company', 'travel_agent', 'ota', 'government');

create table public.customers (
  id                   uuid primary key default gen_random_uuid(),
  hotel_id             uuid not null references public.hotels(id) on delete cascade,
  code                 text not null check (code ~ '^[A-Z0-9_-]{1,20}$'),
  name_ar              text not null check (length(trim(name_ar)) > 0),
  name_en              text,
  customer_type        public.customer_type not null default 'company',
  tax_number           text,
  commercial_registration text,
  email                text,
  phone                text,
  address              text,
  -- null ⇒ بلا حد ائتماني (لا يُسمح بالآجل إلا إذا كان للعميل حساب آجل مفعّل)
  credit_limit         numeric(19, 4) check (credit_limit is null or credit_limit >= 0),
  allow_credit         boolean not null default false,
  payment_terms_days   integer not null default 30 check (payment_terms_days between 0 and 365),
  notes                text,
  is_active            boolean not null default true,
  created_at           timestamptz not null default now(),
  created_by           uuid references auth.users(id),
  updated_at           timestamptz not null default now(),
  updated_by           uuid references auth.users(id),
  unique (hotel_id, code),
  unique (hotel_id, id)
);

create trigger customers_set_created before insert on public.customers
  for each row execute function app.set_created_by();
create trigger customers_set_updated before update on public.customers
  for each row execute function app.set_updated_at();

-- =============================================================================
-- محرك الترحيل الآلي
-- =============================================================================
-- المستندات الفرعية (فوليو، فاتورة، سند) تنشئ قيودها عبر app.post_system_entry.
-- هذه الدالة تفعّل علَم "ترحيل نظامي" على مستوى المعاملة، فيسمح التريغر بالترحيل
-- بدون صلاحية gl.journal.post (الكاشير يرحّل الرسوم دون أن يملك صلاحية القيد اليدوي).
-- لا يمكن للمستخدم تفعيل العلَم بنفسه: set_config غير مكشوفة عبر PostgREST،
-- والدالة نفسها في المخطط app غير المكشوف.
-- القواعد المحاسبية (التوازن، الحسابات التفصيلية، الفترة المقفلة) تبقى مفروضة كاملة.
-- -----------------------------------------------------------------------------
create or replace function app.is_system_posting()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(current_setting('app.system_posting', true), '') = 'on';
$$;

-- p_lines: [{account_id, department_id?, description?, debit?, credit?}] — السطور الصفرية تُتجاهل
create or replace function app.post_system_entry(
  p_hotel_id    uuid,
  p_entry_date  date,
  p_description text,
  p_source      public.journal_source,
  p_source_id   uuid,
  p_reference   text,
  p_lines       jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry_id uuid;
  v_line     jsonb;
  v_no       integer := 0;
  -- نعيد العلَم لحالته السابقة حتى لا نعطّله على دالة مستدعية ما زالت تحتاجه
  v_prev     text := coalesce(current_setting('app.system_posting', true), 'off');
begin
  if p_source in ('manual', 'opening', 'adjustment', 'closing', 'reversal') then
    raise exception 'post_system_entry is only for document-generated entries' using errcode = '22023';
  end if;

  perform set_config('app.system_posting', 'on', true);

  insert into public.journal_entries
    (hotel_id, entry_date, period_id, description, reference, source, source_id, currency_code, exchange_rate)
  select p_hotel_id, p_entry_date, '00000000-0000-0000-0000-000000000000'::uuid,
         p_description, p_reference, p_source, p_source_id, h.base_currency, 1
  from public.hotels h where h.id = p_hotel_id
  returning id into v_entry_id;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    if coalesce((v_line ->> 'debit')::numeric, 0) = 0 and coalesce((v_line ->> 'credit')::numeric, 0) = 0 then
      continue;
    end if;
    v_no := v_no + 1;
    insert into public.journal_entry_lines
      (journal_entry_id, hotel_id, line_no, account_id, department_id, description, debit, credit)
    values (
      v_entry_id, p_hotel_id, v_no,
      (v_line ->> 'account_id')::uuid,
      nullif(v_line ->> 'department_id', '')::uuid,
      nullif(v_line ->> 'description', ''),
      coalesce((v_line ->> 'debit')::numeric, 0),
      coalesce((v_line ->> 'credit')::numeric, 0)
    );
  end loop;

  update public.journal_entries set status = 'posted' where id = v_entry_id;

  perform set_config('app.system_posting', v_prev, true);
  return v_entry_id;
end;
$$;

-- عكس قيد نظامي (عند إلغاء مستند فرعي)
create or replace function app.reverse_system_entry(p_entry_id uuid, p_date date, p_description text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_orig   public.journal_entries%rowtype;
  v_new_id uuid;
  v_prev   text := coalesce(current_setting('app.system_posting', true), 'off');
begin
  select * into v_orig from public.journal_entries where id = p_entry_id for update;
  if v_orig.status <> 'posted' or v_orig.reversed_by_id is not null then
    raise exception 'Entry cannot be reversed' using errcode = '23514';
  end if;

  perform set_config('app.system_posting', 'on', true);

  insert into public.journal_entries
    (hotel_id, entry_date, period_id, description, reference, source, source_id,
     currency_code, exchange_rate, reversal_of_id)
  values (v_orig.hotel_id, p_date, v_orig.period_id, p_description, v_orig.entry_number,
          v_orig.source, v_orig.source_id, v_orig.currency_code, v_orig.exchange_rate, v_orig.id)
  returning id into v_new_id;

  insert into public.journal_entry_lines
    (journal_entry_id, hotel_id, line_no, account_id, department_id, description, debit, credit)
  select v_new_id, l.hotel_id, l.line_no, l.account_id, l.department_id, l.description, l.credit, l.debit
  from public.journal_entry_lines l where l.journal_entry_id = v_orig.id;

  update public.journal_entries set status = 'posted' where id = v_new_id;
  update public.journal_entries set reversed_by_id = v_new_id where id = v_orig.id;

  perform set_config('app.system_posting', v_prev, true);
  return v_new_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- تحديث حارس القيود ليدعم الترحيل النظامي ويحمي القيود الآلية
--  * المستخدم لا ينشئ يدويًا قيودًا بمصادر آلية (folio/invoice/payment...)
--  * القيود الآلية لا تُعكس يدويًا؛ تُصحّح من مستندها (إلغاء حركة الفوليو/السند)
--    حتى يبقى الدفتر الفرعي (الفوليو/الفواتير) مطابقًا لدفتر الأستاذ
-- -----------------------------------------------------------------------------
create or replace function app.journal_entries_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period public.accounting_periods%rowtype;
  v_system boolean := app.is_system_posting();
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Posted journal entries cannot be deleted; create a reversal instead'
        using errcode = '42501';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'Journal entries must be created as drafts and posted afterwards'
        using errcode = '23514';
    end if;
    if not v_system and not (
      new.source in ('manual', 'opening', 'adjustment', 'closing')
      or (new.source = 'reversal' and new.reversal_of_id is not null)
    ) then
      raise exception 'Entries with source % are generated by their source documents only', new.source
        using errcode = '42501';
    end if;
    if auth.uid() is not null then
      new.created_by := auth.uid();
    end if;
    new.created_at := now();
    new.updated_at := now();
    new.posted_at := null;
    new.posted_by := null;
    new.entry_number := null;
    new.reversed_by_id := null;
  end if;

  if tg_op = 'UPDATE' then
    -- القيد المرحّل غير قابل للتعديل إطلاقًا؛ الاستثناء الوحيد هو ربطه بقيده العكسي
    if old.status = 'posted' then
      if old.reversed_by_id is null and new.reversed_by_id is not null
         and (to_jsonb(new) - 'reversed_by_id' - 'updated_at' - 'updated_by')
             = (to_jsonb(old) - 'reversed_by_id' - 'updated_at' - 'updated_by') then
        if not v_system then
          if old.source not in ('manual', 'opening', 'adjustment', 'closing') then
            raise exception 'System-generated entries must be corrected from their source document'
              using errcode = '42501';
          end if;
          perform app.require_permission(old.hotel_id, 'gl.journal.reverse');
        end if;
        new.updated_at := now();
        return new;
      end if;
      raise exception 'Posted journal entries are immutable; create a reversal entry instead'
        using errcode = '42501';
    end if;

    if new.hotel_id <> old.hotel_id or new.created_by is distinct from old.created_by
       or new.reversal_of_id is distinct from old.reversal_of_id
       or new.source is distinct from old.source or new.source_id is distinct from old.source_id then
      raise exception 'Immutable journal entry field changed' using errcode = '42501';
    end if;
    if new.reversed_by_id is not null then
      raise exception 'Only posted entries can be reversed' using errcode = '23514';
    end if;
    new.updated_at := now();
    if auth.uid() is not null then
      new.updated_by := auth.uid();
    end if;
  end if;

  v_period := app.period_for_date(new.hotel_id, new.entry_date);
  if v_period.id is null then
    raise exception 'No accounting period defined for date %', new.entry_date using errcode = '23514';
  end if;
  new.period_id := v_period.id;

  if new.status = 'posted' then
    if (to_jsonb(new) - 'status' - 'updated_at' - 'updated_by' - 'period_id')
       <> (to_jsonb(old) - 'status' - 'updated_at' - 'updated_by' - 'period_id') then
      raise exception 'Posting must not change other fields of the entry' using errcode = '23514';
    end if;
    if not v_system then
      perform app.require_permission(new.hotel_id, 'gl.journal.post');
    end if;
    perform app.assert_journal_entry_postable(new);
    new.posted_at := now();
    new.posted_by := auth.uid();
    new.entry_number := app.next_document_number(new.hotel_id, 'journal_entry', 'JV', new.entry_date);
  end if;

  return new;
end;
$$;
