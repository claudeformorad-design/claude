-- =============================================================================
-- المرحلة 1 / الترحيل 3: السنوات والفترات المحاسبية + دفتر الأستاذ العام
-- (القيد المزدوج، الترحيل، العكس، الترقيم المتسلسل، منع التعديل بعد الترحيل)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- السنوات المالية والفترات المحاسبية
-- -----------------------------------------------------------------------------
create type public.period_status as enum ('open', 'closed');

create table public.fiscal_years (
  id          uuid primary key default gen_random_uuid(),
  hotel_id    uuid not null references public.hotels(id) on delete cascade,
  name        text not null,
  start_date  date not null,
  end_date    date not null,
  status      public.period_status not null default 'open',
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users(id),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id),
  unique (hotel_id, name),
  unique (hotel_id, id),
  constraint fiscal_years_dates check (end_date > start_date),
  constraint fiscal_years_no_overlap exclude using gist (
    hotel_id with =, daterange(start_date, end_date, '[]') with &&
  )
);

create trigger fiscal_years_set_created before insert on public.fiscal_years
  for each row execute function app.set_created_by();
create trigger fiscal_years_set_updated before update on public.fiscal_years
  for each row execute function app.set_updated_at();

create table public.accounting_periods (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null references public.hotels(id) on delete cascade,
  fiscal_year_id  uuid not null,
  period_no       smallint not null check (period_no between 1 and 13),
  name            text not null,
  start_date      date not null,
  end_date        date not null,
  status          public.period_status not null default 'open',
  closed_at       timestamptz,
  closed_by       uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id),
  foreign key (hotel_id, fiscal_year_id) references public.fiscal_years (hotel_id, id) on delete cascade,
  unique (fiscal_year_id, period_no),
  unique (hotel_id, id),
  constraint accounting_periods_dates check (end_date >= start_date),
  constraint accounting_periods_no_overlap exclude using gist (
    hotel_id with =, daterange(start_date, end_date, '[]') with &&
  )
);

create trigger accounting_periods_set_created before insert on public.accounting_periods
  for each row execute function app.set_created_by();
create trigger accounting_periods_set_updated before update on public.accounting_periods
  for each row execute function app.set_updated_at();

-- الفترة يجب أن تقع ضمن حدود سنتها المالية
create or replace function app.check_period_within_year()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_year public.fiscal_years%rowtype;
begin
  select * into v_year from public.fiscal_years where id = new.fiscal_year_id;
  if new.start_date < v_year.start_date or new.end_date > v_year.end_date then
    raise exception 'Period must fall within its fiscal year' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger accounting_periods_within_year before insert or update of start_date, end_date, fiscal_year_id
  on public.accounting_periods
  for each row execute function app.check_period_within_year();

-- -----------------------------------------------------------------------------
-- الترقيم المتسلسل للمستندات (بدون فجوات، لكل فندق/نوع/سنة)
-- قفل الصف (FOR UPDATE ضمنيًا عبر UPDATE) يضمن عدم تكرار الرقم مع التزامن
-- -----------------------------------------------------------------------------
create table public.document_sequences (
  hotel_id    uuid not null references public.hotels(id) on delete cascade,
  doc_type    text not null,
  year        integer not null,
  prefix      text not null,
  last_value  bigint not null default 0,
  primary key (hotel_id, doc_type, year)
);

create or replace function app.next_document_number(p_hotel_id uuid, p_doc_type text, p_prefix text, p_date date)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year  integer := extract(year from p_date)::integer;
  v_value bigint;
begin
  insert into public.document_sequences (hotel_id, doc_type, year, prefix, last_value)
  values (p_hotel_id, p_doc_type, v_year, p_prefix, 1)
  on conflict (hotel_id, doc_type, year)
    do update set last_value = public.document_sequences.last_value + 1
  returning last_value into v_value;

  return p_prefix || '-' || v_year::text || '-' || lpad(v_value::text, 6, '0');
end;
$$;

-- -----------------------------------------------------------------------------
-- القيود اليومية
-- -----------------------------------------------------------------------------
create type public.journal_status as enum ('draft', 'posted');

create type public.journal_source as enum (
  'manual',      -- قيد يدوي
  'opening',     -- قيد افتتاحي
  'reversal',    -- قيد عكسي
  'closing',     -- قيد إقفال
  'adjustment',  -- قيد تسوية
  -- مصادر آلية للمراحل القادمة
  'folio', 'invoice', 'payment', 'vendor_bill', 'expense', 'payroll',
  'depreciation', 'inventory', 'petty_cash'
);

create table public.journal_entries (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null references public.hotels(id),
  -- الرقم المتسلسل الرسمي، يُمنح عند الترحيل (JV-2026-000001)
  entry_number    text,
  entry_date      date not null,
  period_id       uuid not null,
  description     text not null check (length(trim(description)) > 0),
  -- مرجع خارجي اختياري (رقم فاتورة، شيك ...)
  reference       text,
  source          public.journal_source not null default 'manual',
  source_id       uuid,
  currency_code   char(3) not null references public.currencies(code),
  -- سعر الصرف مقابل العملة الأساسية للفندق (1 إذا كانت نفس العملة)
  exchange_rate   numeric(20, 10) not null default 1 check (exchange_rate > 0),
  status          public.journal_status not null default 'draft',
  posted_at       timestamptz,
  posted_by       uuid references auth.users(id),
  reversal_of_id  uuid unique references public.journal_entries(id),
  reversed_by_id  uuid unique references public.journal_entries(id),
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id),
  unique (hotel_id, id),
  unique (hotel_id, entry_number),
  foreign key (hotel_id, period_id) references public.accounting_periods (hotel_id, id),
  constraint je_posted_fields check (
    (status = 'draft'  and posted_at is null and posted_by is null and entry_number is null)
    or (status = 'posted' and posted_at is not null and entry_number is not null)
  ),
  constraint je_not_self_reversal check (reversal_of_id is distinct from id and reversed_by_id is distinct from id)
);

create index je_hotel_date_idx on public.journal_entries (hotel_id, entry_date desc);
create index je_period_idx on public.journal_entries (period_id);
create index je_source_idx on public.journal_entries (source, source_id) where source_id is not null;

create table public.journal_entry_lines (
  id                uuid primary key default gen_random_uuid(),
  journal_entry_id  uuid not null,
  hotel_id          uuid not null,
  line_no           smallint not null check (line_no > 0),
  account_id        uuid not null,
  department_id     uuid,
  description       text,
  -- المبالغ بعملة القيد
  debit             numeric(19, 4) not null default 0 check (debit >= 0),
  credit            numeric(19, 4) not null default 0 check (credit >= 0),
  -- المبالغ بالعملة الأساسية = المبلغ × سعر الصرف.
  -- تُخزن بدقة غير محدودة (numeric بلا مقياس) حتى يبقى التوازن مضمونًا رياضيًا:
  -- Σ(مدين × س) = س × Σ(مدين) = س × Σ(دائن) = Σ(دائن × س). التقريب يتم عند العرض فقط.
  base_debit        numeric not null default 0,
  base_credit       numeric not null default 0,
  created_at        timestamptz not null default now(),
  foreign key (hotel_id, journal_entry_id) references public.journal_entries (hotel_id, id) on delete cascade,
  foreign key (hotel_id, account_id) references public.chart_of_accounts (hotel_id, id),
  foreign key (hotel_id, department_id) references public.departments (hotel_id, id),
  unique (journal_entry_id, line_no),
  -- كل سطر إما مدين أو دائن (وليس كلاهما ولا صفرًا)
  constraint jel_one_side check ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
);

create index jel_account_idx on public.journal_entry_lines (hotel_id, account_id);
create index jel_entry_idx on public.journal_entry_lines (journal_entry_id);
create index jel_department_idx on public.journal_entry_lines (department_id) where department_id is not null;

-- -----------------------------------------------------------------------------
-- إيجاد الفترة المحاسبية لتاريخ معين
-- -----------------------------------------------------------------------------
create or replace function app.period_for_date(p_hotel_id uuid, p_date date)
returns public.accounting_periods
language sql
stable
security definer
set search_path = ''
as $$
  select p.* from public.accounting_periods p
  where p.hotel_id = p_hotel_id and p_date between p.start_date and p.end_date
  limit 1;
$$;

-- -----------------------------------------------------------------------------
-- التحقق من صلاحية قيد للترحيل (قلب نظام القيد المزدوج)
-- -----------------------------------------------------------------------------
-- القواعد:
--  1) عدد السطور ≥ 2.
--  2) مجموع المدين = مجموع الدائن (بعملة القيد وبالعملة الأساسية) وأكبر من صفر.
--  3) كل الحسابات فعّالة، تفصيلية (تقبل الترحيل)، ومن نفس الفندق.
--  4) الحساب المقيد بعملة لا يقبل إلا قيودًا بنفس العملة.
--  5) الفترة مفتوحة، أو يملك المستخدم صلاحية استثناء الترحيل في فترة مقفلة.
-- -----------------------------------------------------------------------------
create or replace function app.assert_journal_entry_postable(p_entry public.journal_entries)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_lines        integer;
  v_debit        numeric;
  v_credit       numeric;
  v_base_debit   numeric;
  v_base_credit  numeric;
  v_bad_account  text;
  v_period       public.accounting_periods%rowtype;
begin
  select count(*), coalesce(sum(debit), 0), coalesce(sum(credit), 0),
         coalesce(sum(base_debit), 0), coalesce(sum(base_credit), 0)
    into v_lines, v_debit, v_credit, v_base_debit, v_base_credit
  from public.journal_entry_lines
  where journal_entry_id = p_entry.id;

  if v_lines < 2 then
    raise exception 'Journal entry must have at least two lines' using errcode = '23514';
  end if;

  if v_debit <> v_credit then
    raise exception 'Journal entry is not balanced: debit % <> credit %', v_debit, v_credit
      using errcode = '23514';
  end if;

  if v_debit = 0 then
    raise exception 'Journal entry total must be greater than zero' using errcode = '23514';
  end if;

  -- حماية إضافية: التوازن بالعملة الأساسية (مضمون رياضيًا، لكن نتحقق دفاعيًا)
  if v_base_debit <> v_base_credit then
    raise exception 'Journal entry is not balanced in base currency' using errcode = '23514';
  end if;

  select a.code into v_bad_account
  from public.journal_entry_lines l
  join public.chart_of_accounts a on a.id = l.account_id
  where l.journal_entry_id = p_entry.id
    and (not a.is_active or not a.is_postable or a.hotel_id <> p_entry.hotel_id)
  limit 1;
  if v_bad_account is not null then
    raise exception 'Account % is inactive or is a header account', v_bad_account using errcode = '23514';
  end if;

  select a.code into v_bad_account
  from public.journal_entry_lines l
  join public.chart_of_accounts a on a.id = l.account_id
  where l.journal_entry_id = p_entry.id
    and a.currency_code is not null and a.currency_code <> p_entry.currency_code
  limit 1;
  if v_bad_account is not null then
    raise exception 'Account % only accepts entries in its own currency', v_bad_account using errcode = '23514';
  end if;

  select * into v_period from public.accounting_periods where id = p_entry.period_id;
  if v_period.status = 'closed' then
    if auth.uid() is not null and not app.has_permission(p_entry.hotel_id, 'gl.periods.post_closed') then
      raise exception 'Accounting period % is closed', v_period.name using errcode = '42501';
    end if;
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- تريغر رأس القيد: يفرض دورة الحياة draft → posted وعدم قابلية التعديل بعد الترحيل
-- -----------------------------------------------------------------------------
create or replace function app.journal_entries_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period public.accounting_periods%rowtype;
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
        perform app.require_permission(old.hotel_id, 'gl.journal.reverse');
        new.updated_at := now();
        return new;
      end if;
      raise exception 'Posted journal entries are immutable; create a reversal entry instead'
        using errcode = '42501';
    end if;

    if new.hotel_id <> old.hotel_id or new.created_by is distinct from old.created_by
       or new.reversal_of_id is distinct from old.reversal_of_id then
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

  -- ربط القيد بالفترة المحاسبية المطابقة لتاريخه
  v_period := app.period_for_date(new.hotel_id, new.entry_date);
  if v_period.id is null then
    raise exception 'No accounting period defined for date %', new.entry_date using errcode = '23514';
  end if;
  new.period_id := v_period.id;

  -- الترحيل: draft → posted
  if new.status = 'posted' then
    if (to_jsonb(new) - 'status' - 'updated_at' - 'updated_by' - 'period_id')
       <> (to_jsonb(old) - 'status' - 'updated_at' - 'updated_by' - 'period_id') then
      raise exception 'Posting must not change other fields of the entry' using errcode = '23514';
    end if;
    perform app.require_permission(new.hotel_id, 'gl.journal.post');
    perform app.assert_journal_entry_postable(new);
    new.posted_at := now();
    new.posted_by := auth.uid();
    new.entry_number := app.next_document_number(new.hotel_id, 'journal_entry', 'JV', new.entry_date);
  end if;

  return new;
end;
$$;

create trigger journal_entries_guard
  before insert or update or delete on public.journal_entries
  for each row execute function app.journal_entries_guard();

-- عند تغيير سعر الصرف في مسودة: إعادة حساب المبالغ بالعملة الأساسية للسطور
create or replace function app.journal_entries_recalc_base()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'draft' and new.exchange_rate <> old.exchange_rate then
    update public.journal_entry_lines
       set base_debit = debit * new.exchange_rate,
           base_credit = credit * new.exchange_rate
     where journal_entry_id = new.id;
  end if;
  return null;
end;
$$;

create trigger journal_entries_recalc_base
  after update of exchange_rate on public.journal_entries
  for each row execute function app.journal_entries_recalc_base();

-- -----------------------------------------------------------------------------
-- تريغر سطور القيد: لا تعديل على سطور قيد مرحّل، وحساب المبالغ الأساسية
-- -----------------------------------------------------------------------------
create or replace function app.journal_lines_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry   public.journal_entries%rowtype;
  v_account public.chart_of_accounts%rowtype;
begin
  select * into v_entry from public.journal_entries
  where id = coalesce(new.journal_entry_id, old.journal_entry_id);

  if tg_op = 'DELETE' then
    -- الرأس غير موجود ⇒ حذف متتالٍ لمسودة (الرأس سُمح بحذفه لأنه مسودة)
    if found and v_entry.status <> 'draft' then
      raise exception 'Lines of a posted journal entry cannot be deleted' using errcode = '42501';
    end if;
    return old;
  end if;

  if not found then
    raise exception 'Journal entry not found' using errcode = '23503';
  end if;
  if v_entry.status <> 'draft' then
    raise exception 'Lines of a posted journal entry cannot be modified' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.journal_entry_id <> old.journal_entry_id then
    raise exception 'Cannot move a line to another entry' using errcode = '42501';
  end if;

  new.hotel_id := v_entry.hotel_id;

  select * into v_account from public.chart_of_accounts where id = new.account_id;
  if not found or v_account.hotel_id <> v_entry.hotel_id then
    raise exception 'Account does not belong to this hotel' using errcode = '23503';
  end if;
  if not v_account.is_postable then
    raise exception 'Account % is a header account and cannot receive entries', v_account.code
      using errcode = '23514';
  end if;

  new.base_debit := new.debit * v_entry.exchange_rate;
  new.base_credit := new.credit * v_entry.exchange_rate;
  return new;
end;
$$;

create trigger journal_lines_guard
  before insert or update or delete on public.journal_entry_lines
  for each row execute function app.journal_lines_guard();

-- لا يمكن تحويل حساب عليه حركات إلى حساب تجميعي
create or replace function app.coa_protect_used_account()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.journal_entry_lines l where l.account_id = new.id) then
    if not new.is_postable then
      raise exception 'Account % has journal lines and cannot become a header account', new.code
        using errcode = '23514';
    end if;
    if new.account_type <> old.account_type then
      raise exception 'Account % has journal lines; its type cannot change', new.code
        using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create trigger coa_protect_used_account before update of is_postable, account_type
  on public.chart_of_accounts
  for each row execute function app.coa_protect_used_account();

-- لا يمكن تغيير العملة الأساسية بعد وجود قيود مرحّلة
create or replace function app.hotels_protect_base_currency()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.base_currency <> old.base_currency and exists (
    select 1 from public.journal_entries j where j.hotel_id = new.id and j.status = 'posted'
  ) then
    raise exception 'Base currency cannot change after entries are posted' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger hotels_protect_base_currency before update of base_currency on public.hotels
  for each row execute function app.hotels_protect_base_currency();

-- لا يُعاد فتح سنة مالية/فترة إلا بصلاحية، ولا تُحذف فترة عليها قيود (FK يمنع ذلك)
create or replace function app.accounting_periods_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> old.status then
    perform app.require_permission(new.hotel_id, 'gl.periods.manage');
    if new.status = 'closed' then
      new.closed_at := now();
      new.closed_by := auth.uid();
    else
      new.closed_at := null;
      new.closed_by := null;
    end if;
  end if;
  return new;
end;
$$;

create trigger accounting_periods_guard before update on public.accounting_periods
  for each row execute function app.accounting_periods_guard();

-- =============================================================================
-- واجهات RPC (SECURITY INVOKER: تخضع لسياسات RLS + فحص صريح للصلاحيات)
-- =============================================================================

-- إنشاء سنة مالية بفترات شهرية
create or replace function public.create_fiscal_year(p_hotel_id uuid, p_start_date date, p_name text default null)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_year_id uuid;
  v_end     date := (p_start_date + interval '12 months' - interval '1 day')::date;
  v_start   date;
  i         integer;
begin
  perform app.require_permission(p_hotel_id, 'gl.periods.manage');

  insert into public.fiscal_years (hotel_id, name, start_date, end_date)
  values (
    p_hotel_id,
    coalesce(p_name, case when extract(month from p_start_date) = 1
                          then extract(year from p_start_date)::text
                          else extract(year from p_start_date)::text || '/' || extract(year from v_end)::text end),
    p_start_date, v_end
  )
  returning id into v_year_id;

  for i in 1..12 loop
    v_start := (p_start_date + make_interval(months => i - 1))::date;
    insert into public.accounting_periods (hotel_id, fiscal_year_id, period_no, name, start_date, end_date)
    values (
      p_hotel_id, v_year_id, i, to_char(v_start, 'YYYY-MM'),
      v_start, (v_start + interval '1 month' - interval '1 day')::date
    );
  end loop;

  return v_year_id;
end;
$$;

-- إنشاء أو تحديث مسودة قيد يدوي مع سطورها في معاملة واحدة (ذرّية)
-- p_lines: [{ "account_id": uuid, "department_id": uuid|null, "description": text,
--             "debit": number, "credit": number }]
create or replace function public.save_journal_entry(
  p_hotel_id      uuid,
  p_entry_date    date,
  p_description   text,
  p_lines         jsonb,
  p_reference     text default null,
  p_currency_code char(3) default null,
  p_exchange_rate numeric default 1,
  p_entry_id      uuid default null,
  p_post          boolean default false
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_entry_id uuid := p_entry_id;
  v_currency char(3);
  v_line     jsonb;
  v_no       integer := 0;
begin
  perform app.require_permission(p_hotel_id, 'gl.journal.create');

  if jsonb_typeof(p_lines) <> 'array' then
    raise exception 'p_lines must be a JSON array' using errcode = '22023';
  end if;

  select coalesce(p_currency_code, h.base_currency) into v_currency
  from public.hotels h where h.id = p_hotel_id;
  if v_currency is null then
    raise exception 'Hotel not found' using errcode = '23503';
  end if;

  if v_entry_id is null then
    insert into public.journal_entries
      (hotel_id, entry_date, period_id, description, reference, source, currency_code, exchange_rate)
    values (
      p_hotel_id, p_entry_date,
      -- قيمة مؤقتة؛ التريغر يحدد الفترة الصحيحة من التاريخ
      '00000000-0000-0000-0000-000000000000'::uuid,
      p_description, nullif(trim(p_reference), ''), 'manual', v_currency, coalesce(p_exchange_rate, 1)
    )
    returning id into v_entry_id;
  else
    update public.journal_entries
       set entry_date = p_entry_date,
           description = p_description,
           reference = nullif(trim(p_reference), ''),
           currency_code = v_currency,
           exchange_rate = coalesce(p_exchange_rate, 1)
     where id = v_entry_id and hotel_id = p_hotel_id and status = 'draft';
    if not found then
      raise exception 'Draft journal entry not found' using errcode = 'P0002';
    end if;
    delete from public.journal_entry_lines where journal_entry_id = v_entry_id;
  end if;

  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_no := v_no + 1;
    insert into public.journal_entry_lines
      (journal_entry_id, hotel_id, line_no, account_id, department_id, description, debit, credit)
    values (
      v_entry_id, p_hotel_id, v_no,
      (v_line ->> 'account_id')::uuid,
      nullif(v_line ->> 'department_id', '')::uuid,
      nullif(trim(v_line ->> 'description'), ''),
      coalesce((v_line ->> 'debit')::numeric, 0),
      coalesce((v_line ->> 'credit')::numeric, 0)
    );
  end loop;

  if p_post then
    update public.journal_entries set status = 'posted' where id = v_entry_id;
  end if;

  return v_entry_id;
end;
$$;

-- ترحيل مسودة
create or replace function public.post_journal_entry(p_entry_id uuid)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_number text;
begin
  update public.journal_entries set status = 'posted'
   where id = p_entry_id and status = 'draft'
  returning entry_number into v_number;
  if v_number is null then
    raise exception 'Draft journal entry not found' using errcode = 'P0002';
  end if;
  return v_number;
end;
$$;

-- عكس قيد مرحّل: ينشئ قيدًا جديدًا بتبديل المدين والدائن ويرحّله، ثم يربط القيدين.
-- لا يُحذف أو يُعدل القيد الأصلي (مبدأ عدم قابلية التعديل).
create or replace function public.reverse_journal_entry(
  p_entry_id      uuid,
  p_reversal_date date default null,
  p_description   text default null
)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_orig   public.journal_entries%rowtype;
  v_new_id uuid;
begin
  select * into v_orig from public.journal_entries where id = p_entry_id for update;
  if not found then
    raise exception 'Journal entry not found' using errcode = 'P0002';
  end if;
  perform app.require_permission(v_orig.hotel_id, 'gl.journal.reverse');
  if v_orig.status <> 'posted' then
    raise exception 'Only posted entries can be reversed' using errcode = '23514';
  end if;
  if v_orig.reversed_by_id is not null then
    raise exception 'Entry % is already reversed', v_orig.entry_number using errcode = '23514';
  end if;
  if v_orig.reversal_of_id is not null then
    raise exception 'A reversal entry cannot itself be reversed' using errcode = '23514';
  end if;

  insert into public.journal_entries
    (hotel_id, entry_date, period_id, description, reference, source, source_id,
     currency_code, exchange_rate, reversal_of_id)
  values (
    v_orig.hotel_id,
    coalesce(p_reversal_date, v_orig.entry_date),
    v_orig.period_id,
    coalesce(nullif(trim(p_description), ''), 'عكس القيد / Reversal of ' || v_orig.entry_number),
    v_orig.entry_number, 'reversal', v_orig.id,
    v_orig.currency_code, v_orig.exchange_rate, v_orig.id
  )
  returning id into v_new_id;

  -- تبديل المدين والدائن لكل سطر
  insert into public.journal_entry_lines
    (journal_entry_id, hotel_id, line_no, account_id, department_id, description, debit, credit)
  select v_new_id, l.hotel_id, l.line_no, l.account_id, l.department_id, l.description, l.credit, l.debit
  from public.journal_entry_lines l
  where l.journal_entry_id = v_orig.id;

  -- الترحيل عبر التريغر (يتحقق من صلاحية الترحيل وحالة الفترة)
  update public.journal_entries set status = 'posted' where id = v_new_id;
  update public.journal_entries set reversed_by_id = v_new_id where id = v_orig.id;

  return v_new_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- إنشاء فندق جديد (Onboarding): الفندق + عضوية المُنشئ كمدير عام + بيانات افتراضية
-- -----------------------------------------------------------------------------
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
  insert into public.hotel_members (hotel_id, user_id, role_id) values (v_hotel_id, auth.uid(), v_gm_role);

  update public.users_profiles set default_hotel_id = v_hotel_id
   where id = auth.uid() and default_hotel_id is null;

  if p_seed_defaults then
    perform app.seed_default_departments(v_hotel_id);
    perform app.seed_default_chart_of_accounts(v_hotel_id);

    -- السنة المالية الحالية بحسب شهر البداية المحدد
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
-- بيانات ميزان المراجعة: حركة كل حساب مقسمة إلى ثلاث شرائح زمنية.
-- العرض النهائي (أرصدة افتتاحية/ختامية وترحيل أرباح السنوات السابقة للأرباح المبقاة)
-- يتم في طبقة lib/accounting/trial-balance.ts حتى يكون قابلًا للاختبار.
-- -----------------------------------------------------------------------------
create or replace function public.gl_account_activity(
  p_hotel_id         uuid,
  p_fiscal_year_start date,
  p_from             date,
  p_to               date
)
returns table (
  account_id         uuid,
  prior_years_debit  numeric,
  prior_years_credit numeric,
  ytd_before_debit   numeric,
  ytd_before_credit  numeric,
  period_debit       numeric,
  period_credit      numeric
)
language plpgsql
stable
set search_path = ''
as $$
begin
  perform app.require_permission(p_hotel_id, 'reports.trial_balance.view');
  if p_from > p_to or p_fiscal_year_start > p_from then
    raise exception 'Invalid date range' using errcode = '22023';
  end if;

  return query
  select l.account_id,
         coalesce(sum(l.base_debit)  filter (where j.entry_date <  p_fiscal_year_start), 0),
         coalesce(sum(l.base_credit) filter (where j.entry_date <  p_fiscal_year_start), 0),
         coalesce(sum(l.base_debit)  filter (where j.entry_date >= p_fiscal_year_start and j.entry_date < p_from), 0),
         coalesce(sum(l.base_credit) filter (where j.entry_date >= p_fiscal_year_start and j.entry_date < p_from), 0),
         coalesce(sum(l.base_debit)  filter (where j.entry_date between p_from and p_to), 0),
         coalesce(sum(l.base_credit) filter (where j.entry_date between p_from and p_to), 0)
  from public.journal_entry_lines l
  join public.journal_entries j on j.id = l.journal_entry_id
  where j.hotel_id = p_hotel_id
    and j.status = 'posted'
    and j.entry_date <= p_to
  group by l.account_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- عرض مجاميع القيود (security_invoker ⇒ يخضع لـ RLS الجداول الأصلية)
-- -----------------------------------------------------------------------------
create view public.journal_entry_totals
with (security_invoker = true) as
select j.id as journal_entry_id,
       j.hotel_id,
       count(l.id)::integer as line_count,
       coalesce(sum(l.debit), 0) as total_debit,
       coalesce(sum(l.credit), 0) as total_credit,
       coalesce(sum(l.base_debit), 0) as base_total_debit,
       coalesce(sum(l.base_credit), 0) as base_total_credit
from public.journal_entries j
left join public.journal_entry_lines l on l.journal_entry_id = j.id
group by j.id, j.hotel_id;
