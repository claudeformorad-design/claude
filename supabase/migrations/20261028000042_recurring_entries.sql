-- =============================================================================
-- القيود الدورية: نموذج قيد متوازن يتكرر أسبوعيًا أو شهريًا أو ربع سنويًا أو سنويًا من تاريخ بداية،
-- لعدد مرات محدد أو حتى تاريخ نهاية. «ترحيل القيود المستحقة» ينشئ كل قيد حان موعده حتى اليوم
-- بالقواعد نفسها للقيد اليدوي (التوازن، الفترات المقفلة، الحسابات التفصيلية، حدود الاعتماد).
-- يغطي توزيع المصروفات المدفوعة مقدمًا: مدين المصروف ودائن «مصروفات مدفوعة مقدمًا» عدد أشهر محدد.
-- =============================================================================

create table public.recurring_entries (
  id              uuid primary key default gen_random_uuid(),
  hotel_id        uuid not null references public.hotels(id) on delete cascade,
  name            text not null check (length(trim(name)) between 1 and 120),
  description     text not null check (length(trim(description)) > 0),
  lines           jsonb not null check (jsonb_typeof(lines) = 'array'),
  frequency       text not null check (frequency in ('weekly', 'monthly', 'quarterly', 'yearly')),
  start_date      date not null,
  end_date        date,
  total_count     integer check (total_count is null or total_count between 1 and 600),
  posted_count    integer not null default 0 check (posted_count >= 0),
  is_active       boolean not null default true,
  last_entry_id   uuid references public.journal_entries(id),
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id),
  updated_at      timestamptz not null default now(),
  unique (hotel_id, id),
  constraint recurring_end_after_start check (end_date is null or end_date >= start_date)
);
create index recurring_entries_hotel_idx on public.recurring_entries (hotel_id, is_active);

alter table public.recurring_entries enable row level security;
create policy recurring_entries_read on public.recurring_entries for select to authenticated
  using (hotel_id in (select app.permitted_hotels('gl.journal.view')));
create trigger recurring_entries_set_created before insert on public.recurring_entries for each row execute function app.set_created_by();
create trigger audit_recurring_entries after insert or update or delete on public.recurring_entries for each row execute function app.audit_trigger();

-- موعد التكرار رقم n (من صفر) محسوبًا من تاريخ البداية حتى لا ينزاح آخر الشهر
create or replace function app.recurring_date(p_start date, p_frequency text, p_n integer)
returns date language sql immutable as $$
  select (p_start + case p_frequency
    when 'weekly' then make_interval(days => 7 * p_n)
    when 'monthly' then make_interval(months => p_n)
    when 'quarterly' then make_interval(months => 3 * p_n)
    else make_interval(years => p_n) end)::date;
$$;

-- التحقق من سطور النموذج: سطران على الأقل، كل سطر مدين أو دائن، متوازن، وحسابات تفصيلية فعالة
create or replace function app.check_recurring_lines(p_hotel_id uuid, p_lines jsonb)
returns void
language plpgsql
stable
set search_path = ''
as $$
declare
  v_line jsonb;
  v_dr numeric := 0;
  v_cr numeric := 0;
  v_d numeric;
  v_c numeric;
  v_n integer := 0;
begin
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) < 2 then
    raise exception 'A journal entry must have at least two lines' using errcode = '22023';
  end if;
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_n := v_n + 1;
    v_d := coalesce((v_line ->> 'debit')::numeric, 0);
    v_c := coalesce((v_line ->> 'credit')::numeric, 0);
    if v_d < 0 or v_c < 0 or (v_d > 0) = (v_c > 0) then
      raise exception 'Each line is either a debit or a credit' using errcode = '22023';
    end if;
    if not exists (select 1 from public.chart_of_accounts a
                   where a.id = (v_line ->> 'account_id')::uuid and a.hotel_id = p_hotel_id and a.is_postable and a.is_active) then
      raise exception 'Account not found, inactive or not postable' using errcode = '23503';
    end if;
    if app.is_control_account((v_line ->> 'account_id')::uuid) then
      raise exception 'Account is a control account (receivables/payables/deposits/inventory); use its source document' using errcode = '23514';
    end if;
    v_dr := v_dr + v_d;
    v_cr := v_cr + v_c;
  end loop;
  if v_dr <> v_cr then
    raise exception 'Journal entry is not balanced: debit % <> credit %', v_dr, v_cr using errcode = '23514';
  end if;
end;
$$;

create or replace function public.save_recurring_entry(
  p_hotel_id uuid, p_id uuid, p_name text, p_description text, p_lines jsonb, p_frequency text,
  p_start_date date, p_end_date date default null, p_total_count integer default null, p_active boolean default true
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid := p_id;
begin
  perform app.require_permission(p_hotel_id, 'gl.journal.create');
  perform app.check_recurring_lines(p_hotel_id, p_lines);
  if p_frequency not in ('weekly', 'monthly', 'quarterly', 'yearly') then
    raise exception 'Unknown frequency' using errcode = '22023';
  end if;
  if p_start_date is null then
    raise exception 'Start date is required' using errcode = '22023';
  end if;
  if v_id is null then
    insert into public.recurring_entries (hotel_id, name, description, lines, frequency, start_date, end_date, total_count, is_active)
    values (p_hotel_id, trim(p_name), trim(p_description), p_lines, p_frequency, p_start_date, p_end_date, p_total_count, coalesce(p_active, true))
    returning id into v_id;
  else
    update public.recurring_entries
       set name = trim(p_name), description = trim(p_description), lines = p_lines, frequency = p_frequency,
           -- تغيير البداية أو التكرار بعد ترحيل قيود يبدأ العدّ من جديد من البداية الجديدة
           start_date = p_start_date, end_date = p_end_date, total_count = p_total_count,
           posted_count = case when start_date = p_start_date and frequency = p_frequency then posted_count else 0 end,
           is_active = coalesce(p_active, true), updated_at = now()
     where id = v_id and hotel_id = p_hotel_id;
    if not found then
      raise exception 'Recurring entry not found' using errcode = 'P0002';
    end if;
  end if;
  return v_id;
end;
$$;

-- نموذج دوري من قيد يدوي مرحّل (نفس الحسابات والمبالغ ومراكز التكلفة)
create or replace function public.recurring_from_entry(
  p_entry_id uuid, p_name text, p_frequency text, p_start_date date, p_end_date date default null, p_total_count integer default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_je public.journal_entries%rowtype;
  v_lines jsonb;
begin
  select * into v_je from public.journal_entries where id = p_entry_id;
  if v_je.id is null then
    raise exception 'Journal entry not found' using errcode = 'P0002';
  end if;
  select jsonb_agg(jsonb_build_object('account_id', l.account_id, 'department_id', l.department_id, 'description', l.description,
                                      'debit', l.base_debit, 'credit', l.base_credit) order by l.line_no)
    into v_lines
  from public.journal_entry_lines l where l.journal_entry_id = p_entry_id;
  return public.save_recurring_entry(v_je.hotel_id, null, coalesce(nullif(trim(p_name), ''), v_je.description), v_je.description,
    v_lines, p_frequency, p_start_date, p_end_date, p_total_count, true);
end;
$$;

create or replace function public.set_recurring_entry_active(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hotel uuid;
begin
  select hotel_id into v_hotel from public.recurring_entries where id = p_id;
  if v_hotel is null then
    raise exception 'Recurring entry not found' using errcode = 'P0002';
  end if;
  perform app.require_permission(v_hotel, 'gl.journal.create');
  update public.recurring_entries set is_active = p_active, updated_at = now() where id = p_id;
end;
$$;

create or replace function public.delete_recurring_entry(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hotel uuid;
begin
  select hotel_id into v_hotel from public.recurring_entries where id = p_id;
  if v_hotel is null then
    raise exception 'Recurring entry not found' using errcode = 'P0002';
  end if;
  perform app.require_permission(v_hotel, 'gl.journal.create');
  -- القيود التي رُحّلت منه تبقى في الدفاتر كما هي
  delete from public.recurring_entries where id = p_id;
end;
$$;

-- الموعد القادم للنموذج، أو null إن انتهى
create or replace function app.recurring_next(r public.recurring_entries)
returns date language sql stable as $$
  select case
    when r.total_count is not null and r.posted_count >= r.total_count then null
    when r.end_date is not null and app.recurring_date(r.start_date, r.frequency, r.posted_count) > r.end_date then null
    else app.recurring_date(r.start_date, r.frequency, r.posted_count) end;
$$;

create or replace function public.recurring_entries_due(p_hotel_id uuid)
returns table (id uuid, next_date date, due_count integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := app.today_for_hotel(p_hotel_id);
begin
  perform app.require_permission(p_hotel_id, 'gl.journal.view');
  return query
  select r.id, app.recurring_next(r),
         (select count(*)::integer from generate_series(r.posted_count, r.posted_count + 600) g(n)
           where app.recurring_date(r.start_date, r.frequency, g.n) <= v_today
             and (r.end_date is null or app.recurring_date(r.start_date, r.frequency, g.n) <= r.end_date)
             and (r.total_count is null or g.n < r.total_count))
  from public.recurring_entries r where r.hotel_id = p_hotel_id;
end;
$$;

-- ترحيل كل ما حان موعده حتى اليوم (ويلحق المواعيد الفائتة)، ويعيد عدد القيود المرحّلة
create or replace function public.post_due_recurring_entries(p_hotel_id uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today date := app.today_for_hotel(p_hotel_id);
  v_r     public.recurring_entries%rowtype;
  v_date  date;
  v_entry uuid;
  v_count integer := 0;
  v_guard integer;
begin
  perform app.require_permission(p_hotel_id, 'gl.journal.create');
  perform app.require_permission(p_hotel_id, 'gl.journal.post');
  perform pg_advisory_xact_lock(hashtext('nazeel.recurring.' || p_hotel_id::text));
  for v_r in select * from public.recurring_entries where hotel_id = p_hotel_id and is_active order by start_date, name loop
    v_guard := 0;
    loop
      v_date := app.recurring_next(v_r);
      exit when v_date is null or v_date > v_today or v_guard >= 120;
      v_entry := public.save_journal_entry(p_hotel_id, v_date, v_r.description, v_r.lines,
                   'REC ' || left(v_r.name, 40) || ' #' || (v_r.posted_count + 1)::text, null, 1, null, true);
      v_r.posted_count := v_r.posted_count + 1;
      update public.recurring_entries set posted_count = v_r.posted_count, last_entry_id = v_entry, updated_at = now() where id = v_r.id;
      v_count := v_count + 1;
      v_guard := v_guard + 1;
    end loop;
  end loop;
  return v_count;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.save_recurring_entry(uuid, uuid, text, text, jsonb, text, date, date, integer, boolean)',
    'public.recurring_from_entry(uuid, text, text, date, date, integer)',
    'public.set_recurring_entry_active(uuid, boolean)',
    'public.delete_recurring_entry(uuid)',
    'public.recurring_entries_due(uuid)',
    'public.post_due_recurring_entries(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function app.check_recurring_lines(uuid, jsonb) from public, anon;
revoke all on function app.recurring_next(public.recurring_entries) from public, anon;
