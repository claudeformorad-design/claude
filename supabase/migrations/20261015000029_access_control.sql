-- =============================================================================
-- نظام الصلاحيات المتقدم
--  1) استثناءات لكل موظف فوق صلاحيات دوره: منح أو منع صلاحية بعينها
--  2) الصلاحية الفعلية = (صلاحيات أدواره ∪ ما مُنح له) − ما مُنع عنه، ضمن أقسام الفندق المفعّلة
--  3) حدود مالية لكل دور ولكل موظف: أقصى خصم على الفوليو، أقصى استرداد، أقصى تخفيض على سعر الغرفة
--  4) طلبات الموافقة: الموظف يطلب ما يتجاوز صلاحيته أو حده، والمدير يوافق فتُنفَّذ باسمه
--  5) إعدادات الواجهة لكل دور ولكل موظف: الصفحة الأولى، الإجراءات السريعة، بطاقات لوحة التحكم
--  6) حراسة صارمة: لا يعدّل أحد صلاحياته بنفسه، ولا يمنح صلاحية لا يملكها، ولا يبقى الفندق بلا مدير للمستخدمين
-- =============================================================================

-- -----------------------------------------------------------------------------
-- صلاحية الموافقات
-- -----------------------------------------------------------------------------
insert into public.permissions (code, module, action, name_ar, name_en, sort_order, product) values
  ('approvals.decide', 'approvals', 'approve', 'الموافقة على طلبات الموظفين ورفضها', 'Approve or reject staff requests', 90, 'core')
on conflict (code) do nothing;

insert into public.role_permissions (role_id, permission_code)
select r.id, 'approvals.decide' from public.roles r where r.is_system and r.code = 'general_manager'
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- استثناءات الموظف
-- -----------------------------------------------------------------------------
create table public.user_permission_overrides (
  hotel_id         uuid not null,
  user_id          uuid not null,
  permission_code  text not null references public.permissions(code) on delete cascade,
  allow            boolean not null,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users(id),
  primary key (hotel_id, user_id, permission_code),
  foreign key (hotel_id, user_id) references public.hotel_members (hotel_id, user_id) on delete cascade
);
create index user_permission_overrides_user_idx on public.user_permission_overrides (user_id, hotel_id);
create trigger user_permission_overrides_set_created before insert on public.user_permission_overrides
  for each row execute function app.set_created_by();
create trigger audit_user_permission_overrides after insert or update or delete on public.user_permission_overrides
  for each row execute function app.audit_trigger();

-- إعدادات الموظف في الفندق: صفحته الأولى وحدوده الخاصة
alter table public.hotel_members
  add column home_path text check (home_path is null or home_path ~ '^/[a-z0-9/_-]*$'),
  add column limits jsonb not null default '{}'::jsonb check (jsonb_typeof(limits) = 'object');

-- إعدادات الدور في الفندق (للأدوار النظامية والخاصة معًا)
create table public.role_settings (
  hotel_id          uuid not null references public.hotels(id) on delete cascade,
  role_id           uuid not null references public.roles(id) on delete cascade,
  home_path         text check (home_path is null or home_path ~ '^/[a-z0-9/_-]*$'),
  quick_actions     text[] not null default '{}',
  dashboard_hidden  text[] not null default '{}',
  limits            jsonb not null default '{}'::jsonb check (jsonb_typeof(limits) = 'object'),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references auth.users(id),
  primary key (hotel_id, role_id)
);
create trigger audit_role_settings after insert or update or delete on public.role_settings
  for each row execute function app.audit_trigger();

-- -----------------------------------------------------------------------------
-- الصلاحية الفعلية
-- -----------------------------------------------------------------------------
create or replace function app.effective_permissions(p_hotel_id uuid, p_user_id uuid)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  with member as (
    select h.enabled_modules
    from public.hotel_members m
    join public.hotels h on h.id = m.hotel_id
    where m.hotel_id = p_hotel_id and m.user_id = p_user_id and m.is_active and h.is_active
  ),
  granted as (
    select rp.permission_code as code
    from public.user_hotel_roles uhr
    join public.role_permissions rp on rp.role_id = uhr.role_id
    where uhr.hotel_id = p_hotel_id and uhr.user_id = p_user_id
    union
    select o.permission_code from public.user_permission_overrides o
    where o.hotel_id = p_hotel_id and o.user_id = p_user_id and o.allow
  )
  select g.code
  from granted g
  join public.permissions p on p.code = g.code
  cross join member mb
  where (p.product = 'core' or p.product = any (mb.enabled_modules))
    and not exists (
      select 1 from public.user_permission_overrides d
      where d.hotel_id = p_hotel_id and d.user_id = p_user_id and d.permission_code = g.code and not d.allow
    );
$$;

create or replace function app.has_permission(p_hotel_id uuid, p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.hotel_members m
    join public.hotels h on h.id = m.hotel_id
    join public.permissions p on p.code = p_permission
    where m.hotel_id = p_hotel_id
      and m.user_id = auth.uid()
      and m.is_active
      and h.is_active
      and (p.product = 'core' or p.product = any (h.enabled_modules))
      and not exists (
        select 1 from public.user_permission_overrides d
        where d.hotel_id = m.hotel_id and d.user_id = m.user_id and d.permission_code = p_permission and not d.allow
      )
      and (
        exists (
          select 1 from public.user_hotel_roles uhr
          join public.role_permissions rp on rp.role_id = uhr.role_id
          where uhr.hotel_id = m.hotel_id and uhr.user_id = m.user_id and rp.permission_code = p_permission
        )
        or exists (
          select 1 from public.user_permission_overrides o
          where o.hotel_id = m.hotel_id and o.user_id = m.user_id and o.permission_code = p_permission and o.allow
        )
      )
  );
$$;

create or replace function app.permitted_hotels(p_permission text)
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  select m.hotel_id
  from public.hotel_members m
  where m.user_id = auth.uid() and m.is_active and app.has_permission(m.hotel_id, p_permission);
$$;

create or replace function public.my_permissions(p_hotel_id uuid)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select app.effective_permissions(p_hotel_id, auth.uid());
$$;

-- -----------------------------------------------------------------------------
-- الحدود
-- القيمة null أو غياب المفتاح = بلا حد. حد الموظف يتقدم على حد أدواره، ومن أدوار متعددة يؤخذ الأوسع.
-- -----------------------------------------------------------------------------
create or replace function app.member_limit(p_hotel_id uuid, p_key text, p_user_id uuid default auth.uid())
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_member jsonb;
  v_unlimited boolean;
  v_max numeric;
begin
  if p_user_id is null then
    return null;
  end if;
  select limits into v_member from public.hotel_members where hotel_id = p_hotel_id and user_id = p_user_id;
  if v_member ? p_key then
    return case when jsonb_typeof(v_member -> p_key) = 'number' then (v_member ->> p_key)::numeric end;
  end if;
  select bool_or(not coalesce(s.limits ? p_key, false) or jsonb_typeof(s.limits -> p_key) <> 'number'),
         max(case when jsonb_typeof(s.limits -> p_key) = 'number' then (s.limits ->> p_key)::numeric end)
    into v_unlimited, v_max
  from public.user_hotel_roles uhr
  left join public.role_settings s on s.hotel_id = uhr.hotel_id and s.role_id = uhr.role_id
  where uhr.hotel_id = p_hotel_id and uhr.user_id = p_user_id;
  if v_unlimited is null or v_unlimited then
    return null;
  end if;
  return v_max;
end;
$$;

create or replace function public.my_limits(p_hotel_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'max_allowance', app.member_limit(p_hotel_id, 'max_allowance'),
    'max_refund', app.member_limit(p_hotel_id, 'max_refund'),
    'max_rate_discount_pct', app.member_limit(p_hotel_id, 'max_rate_discount_pct')
  );
$$;

-- خصم الفوليو والاسترداد فوق حد الموظف
create or replace function app.check_folio_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit numeric;
begin
  if auth.uid() is null or new.direction <> 1 then
    return new;
  end if;
  if new.txn_type = 'allowance' then
    v_limit := app.member_limit(new.hotel_id, 'max_allowance');
    if v_limit is not null and new.total_amount > v_limit then
      raise exception 'Approval required: allowance % is above your limit of %', new.total_amount, v_limit using errcode = '42501';
    end if;
  elsif new.txn_type in ('refund', 'deposit_refund') then
    v_limit := app.member_limit(new.hotel_id, 'max_refund');
    if v_limit is not null and new.total_amount > v_limit then
      raise exception 'Approval required: refund % is above your limit of %', new.total_amount, v_limit using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
create trigger folio_transactions_z_limits before insert on public.folio_transactions
  for each row execute function app.check_folio_limits();

-- التخفيض اليدوي على سعر الغرفة فوق حد الموظف
create or replace function app.check_rate_limits()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit numeric;
  v_base  numeric;
  v_pct   numeric;
begin
  if auth.uid() is null or new.pricing <> 'fixed' or new.fixed_rate is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.pricing = new.pricing and old.fixed_rate is not distinct from new.fixed_rate and old.room_type_id = new.room_type_id then
    return new;
  end if;
  v_limit := app.member_limit(new.hotel_id, 'max_rate_discount_pct');
  if v_limit is null then
    return new;
  end if;
  select base_rate into v_base from public.room_types where id = new.room_type_id;
  if v_base is null or v_base <= 0 then
    return new;
  end if;
  v_pct := round((v_base - new.fixed_rate) / v_base * 100, 2);
  if v_pct > v_limit then
    raise exception 'Approval required: rate discount % percent is above your limit of % percent', v_pct, v_limit using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger reservations_z_rate_limits before insert or update on public.reservations
  for each row execute function app.check_rate_limits();

-- -----------------------------------------------------------------------------
-- حراسة إدارة المستخدمين
-- -----------------------------------------------------------------------------
-- هل يبقى في الفندق عضو نشط يملك إدارة المستخدمين؟
create or replace function app.hotel_has_user_admin(p_hotel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.hotel_members m
    where m.hotel_id = p_hotel_id and m.is_active
      and 'settings.users.manage' in (select app.effective_permissions(p_hotel_id, m.user_id))
  );
$$;

-- هل يملك المنفّذ كل هذه الصلاحيات؟ (لا يمنح أحد ما لا يملكه)
create or replace function app.actor_holds_all(p_hotel_id uuid, p_codes text[])
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select unnest(p_codes)
    except
    select app.effective_permissions(p_hotel_id, auth.uid())
  );
$$;

create or replace function app.guard_member_access()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hotel  uuid := coalesce(new.hotel_id, old.hotel_id);
  v_user   uuid := coalesce(new.user_id, old.user_id);
  v_codes  text[];
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  -- الفندق محذوف (حذف متتابع) أو إعداد فندق جديد: أول دور لمنشئه
  if not exists (select 1 from public.hotels where id = v_hotel) then
    return coalesce(new, old);
  end if;
  if tg_table_name = 'user_hotel_roles' and tg_op = 'INSERT' then
    if not exists (select 1 from public.user_hotel_roles where hotel_id = v_hotel and not (user_id = new.user_id and role_id = new.role_id)) then
      return new;
    end if;
  end if;

  if v_user = auth.uid() then
    if tg_table_name = 'hotel_members' then
      if new.is_active = old.is_active and new.limits = old.limits then
        return new; -- الموظف يغيّر صفحته الأولى فقط
      end if;
    end if;
    raise exception 'You cannot change your own access' using errcode = '42501';
  end if;

  -- لا يدير أحد موظفًا أعلى منه: صلاحيات الهدف الحالية يجب أن تكون ضمن صلاحيات المنفّذ
  select array_agg(e) into v_codes from app.effective_permissions(v_hotel, v_user) e;
  if v_codes is not null and not app.actor_holds_all(v_hotel, v_codes) then
    raise exception 'You cannot manage a user who has permissions you do not have' using errcode = '42501';
  end if;
  v_codes := null;

  -- عدم منح ما لا يملكه المنفّذ
  if tg_op <> 'DELETE' then
    if tg_table_name = 'user_hotel_roles' then
      select array_agg(permission_code) into v_codes from public.role_permissions where role_id = new.role_id;
    elsif tg_table_name = 'user_permission_overrides' then
      if new.allow then
        v_codes := array[new.permission_code];
      end if;
    end if;
    if v_codes is not null and not app.actor_holds_all(v_hotel, v_codes) then
      raise exception 'You cannot grant permissions you do not have' using errcode = '42501';
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function app.guard_user_admin_remains()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hotel uuid := coalesce(new.hotel_id, old.hotel_id);
begin
  if auth.uid() is null or not exists (select 1 from public.hotels where id = v_hotel) then
    return null;
  end if;
  if not app.hotel_has_user_admin(v_hotel) then
    raise exception 'The hotel must keep at least one active user who manages users' using errcode = '23514';
  end if;
  return null;
end;
$$;

create trigger user_hotel_roles_zz_guard before insert or update or delete on public.user_hotel_roles
  for each row execute function app.guard_member_access();
create trigger user_permission_overrides_zz_guard before insert or update or delete on public.user_permission_overrides
  for each row execute function app.guard_member_access();
create trigger hotel_members_zz_guard before update on public.hotel_members
  for each row execute function app.guard_member_access();

create constraint trigger user_hotel_roles_admin_remains after delete or update on public.user_hotel_roles
  deferrable initially deferred for each row execute function app.guard_user_admin_remains();
create constraint trigger user_permission_overrides_admin_remains after insert or update on public.user_permission_overrides
  deferrable initially deferred for each row execute function app.guard_user_admin_remains();
create constraint trigger hotel_members_admin_remains after update on public.hotel_members
  deferrable initially deferred for each row execute function app.guard_user_admin_remains();

-- صلاحيات الأدوار الخاصة: لا يضيف أحد لدور صلاحية لا يملكها، ولا يعدّل دورًا يحمله هو نفسه
create or replace function app.guard_role_permissions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role  uuid := coalesce(new.role_id, old.role_id);
  v_hotel uuid;
begin
  if auth.uid() is null then
    return coalesce(new, old);
  end if;
  select hotel_id into v_hotel from public.roles where id = v_role;
  if v_hotel is null then
    return coalesce(new, old);
  end if;
  if exists (select 1 from public.user_hotel_roles where hotel_id = v_hotel and user_id = auth.uid() and role_id = v_role) then
    raise exception 'You cannot change your own access' using errcode = '42501';
  end if;
  if tg_op <> 'DELETE' and not app.actor_holds_all(v_hotel, array[new.permission_code]) then
    raise exception 'You cannot grant permissions you do not have' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
create trigger role_permissions_guard before insert or update or delete on public.role_permissions
  for each row execute function app.guard_role_permissions();
create or replace function app.guard_role_admin_remains()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hotel uuid;
begin
  if auth.uid() is null then
    return null;
  end if;
  select hotel_id into v_hotel from public.roles where id = old.role_id;
  if v_hotel is not null and not app.hotel_has_user_admin(v_hotel) then
    raise exception 'The hotel must keep at least one active user who manages users' using errcode = '23514';
  end if;
  return null;
end;
$$;
create constraint trigger role_permissions_admin_remains after delete or update on public.role_permissions
  deferrable initially deferred for each row execute function app.guard_role_admin_remains();

-- -----------------------------------------------------------------------------
-- سياسات القراءة والكتابة
-- -----------------------------------------------------------------------------
alter table public.user_permission_overrides enable row level security;
alter table public.role_settings enable row level security;

create policy user_permission_overrides_read on public.user_permission_overrides
  for select to authenticated using (user_id = auth.uid() or hotel_id in (select app.permitted_hotels('settings.users.manage')));
create policy user_permission_overrides_write on public.user_permission_overrides
  for all to authenticated
  using (hotel_id in (select app.permitted_hotels('settings.users.manage')))
  with check (hotel_id in (select app.permitted_hotels('settings.users.manage')));

create policy role_settings_read on public.role_settings
  for select to authenticated using (hotel_id in (select app.member_hotels()));
create policy role_settings_write on public.role_settings
  for all to authenticated
  using (hotel_id in (select app.permitted_hotels('settings.users.manage')))
  with check (hotel_id in (select app.permitted_hotels('settings.users.manage')));

-- إعدادات واجهة المستخدم الحالي: صفحته الأولى وإجراءاته السريعة وما يُخفى من لوحته
create or replace function public.my_interface(p_hotel_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'home_path', coalesce(
      (select home_path from public.hotel_members where hotel_id = p_hotel_id and user_id = auth.uid()),
      (select s.home_path from public.user_hotel_roles uhr join public.role_settings s on s.hotel_id = uhr.hotel_id and s.role_id = uhr.role_id
        where uhr.hotel_id = p_hotel_id and uhr.user_id = auth.uid() and s.home_path is not null order by s.home_path limit 1)),
    'quick_actions', coalesce((select array_agg(distinct q) from public.user_hotel_roles uhr
        join public.role_settings s on s.hotel_id = uhr.hotel_id and s.role_id = uhr.role_id
        cross join unnest(s.quick_actions) q
        where uhr.hotel_id = p_hotel_id and uhr.user_id = auth.uid()), '{}'),
    -- يُخفى القسم فقط إن أخفته كل أدوار الموظف
    'dashboard_hidden', coalesce((
      select array_agg(t.h) from (
        select h, count(distinct uhr.role_id) as n
        from public.user_hotel_roles uhr
        join public.role_settings s on s.hotel_id = uhr.hotel_id and s.role_id = uhr.role_id
        cross join unnest(s.dashboard_hidden) h
        where uhr.hotel_id = p_hotel_id and uhr.user_id = auth.uid()
        group by h
      ) t
      where t.n = (select count(*) from public.user_hotel_roles x where x.hotel_id = p_hotel_id and x.user_id = auth.uid())), '{}'),
    'limits', public.my_limits(p_hotel_id)
  );
$$;

-- -----------------------------------------------------------------------------
-- طلبات الموافقة
-- -----------------------------------------------------------------------------
create table public.approval_requests (
  id             uuid primary key default gen_random_uuid(),
  hotel_id       uuid not null references public.hotels(id) on delete cascade,
  kind           text not null check (kind in ('folio_action', 'reservation_cancel', 'voucher_void')),
  payload        jsonb not null check (jsonb_typeof(payload) = 'object'),
  summary        text not null check (length(trim(summary)) > 0),
  amount         numeric(19, 4),
  note           text,
  status         text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'executed', 'failed', 'cancelled')),
  requested_by   uuid not null default auth.uid() references auth.users(id),
  requested_at   timestamptz not null default now(),
  decided_by     uuid references auth.users(id),
  decided_at     timestamptz,
  decision_note  text,
  result         text,
  error          text,
  constraint approval_not_self check (decided_by is null or decided_by <> requested_by)
);
create index approval_requests_pending_idx on public.approval_requests (hotel_id, status, requested_at desc);
create trigger audit_approval_requests after insert or update or delete on public.approval_requests
  for each row execute function app.audit_trigger();

alter table public.approval_requests enable row level security;
create policy approval_requests_read on public.approval_requests
  for select to authenticated using (requested_by = auth.uid() or hotel_id in (select app.permitted_hotels('approvals.decide')));
create policy approval_requests_insert on public.approval_requests
  for insert to authenticated
  with check (requested_by = auth.uid() and status = 'pending' and decided_by is null and hotel_id in (select app.member_hotels()));

-- القرار: المدير فقط، ولا يوافق أحد على طلبه
create or replace function public.decide_approval(p_request_id uuid, p_approve boolean, p_note text default null)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.approval_requests%rowtype;
begin
  select * into v_r from public.approval_requests where id = p_request_id for update;
  if v_r.id is null then
    raise exception 'Approval request not found' using errcode = '23503';
  end if;
  perform app.require_permission(v_r.hotel_id, 'approvals.decide');
  if v_r.status <> 'pending' then
    raise exception 'This request was already handled' using errcode = '23514';
  end if;
  if v_r.requested_by = auth.uid() then
    raise exception 'You cannot approve your own request' using errcode = '42501';
  end if;
  update public.approval_requests
     set status = case when p_approve then 'approved' else 'rejected' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = nullif(trim(coalesce(p_note, '')), '')
   where id = p_request_id;
  return case when p_approve then 'approved' else 'rejected' end;
end;
$$;

-- تسجيل نتيجة التنفيذ بعد الموافقة (يتم بهوية من وافق)
create or replace function public.finish_approval(p_request_id uuid, p_ok boolean, p_result text default null, p_error text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_r public.approval_requests%rowtype;
begin
  select * into v_r from public.approval_requests where id = p_request_id for update;
  if v_r.id is null or v_r.status <> 'approved' or v_r.decided_by is distinct from auth.uid() then
    raise exception 'Only the approver can record the outcome of an approved request' using errcode = '42501';
  end if;
  update public.approval_requests
     set status = case when p_ok then 'executed' else 'failed' end, result = p_result, error = p_error
   where id = p_request_id;
end;
$$;

-- الموظف يسحب طلبه قبل البت فيه
create or replace function public.cancel_approval(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.approval_requests set status = 'cancelled'
   where id = p_request_id and requested_by = auth.uid() and status = 'pending';
  if not found then
    raise exception 'Only your own pending requests can be withdrawn' using errcode = '42501';
  end if;
end;
$$;

-- قائمة الأعضاء مع إعداداتهم واستثناءاتهم (لمن يدير المستخدمين)
create or replace function public.member_access(p_hotel_id uuid, p_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_permission(p_hotel_id, 'settings.users.manage');
  return (
    select jsonb_build_object(
      'user_id', m.user_id, 'is_active', m.is_active, 'home_path', m.home_path, 'limits', m.limits,
      'role_ids', coalesce((select jsonb_agg(role_id) from public.user_hotel_roles where hotel_id = m.hotel_id and user_id = m.user_id), '[]'),
      'grants', coalesce((select jsonb_agg(permission_code) from public.user_permission_overrides where hotel_id = m.hotel_id and user_id = m.user_id and allow), '[]'),
      'denies', coalesce((select jsonb_agg(permission_code) from public.user_permission_overrides where hotel_id = m.hotel_id and user_id = m.user_id and not allow), '[]'),
      'effective', coalesce((select jsonb_agg(e) from app.effective_permissions(m.hotel_id, m.user_id) e), '[]')
    )
    from public.hotel_members m where m.hotel_id = p_hotel_id and m.user_id = p_user_id
  );
end;
$$;

-- حفظ صلاحيات موظف دفعة واحدة: أدواره واستثناءاته وصفحته الأولى وحدوده وحالته
create or replace function public.set_member_access(
  p_hotel_id uuid, p_user_id uuid, p_role_ids uuid[], p_grants text[], p_denies text[],
  p_home_path text, p_limits jsonb, p_is_active boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_permission(p_hotel_id, 'settings.users.manage');
  if p_user_id = auth.uid() then
    raise exception 'You cannot change your own access' using errcode = '42501';
  end if;
  if not exists (select 1 from public.hotel_members where hotel_id = p_hotel_id and user_id = p_user_id) then
    raise exception 'User is not a member of this hotel' using errcode = '23503';
  end if;
  if exists (select 1 from unnest(coalesce(p_grants, '{}')) g where g = any (coalesce(p_denies, '{}'))) then
    raise exception 'A permission cannot be both granted and denied' using errcode = '23514';
  end if;
  if exists (select 1 from unnest(coalesce(p_role_ids, '{}')) r
             where not exists (select 1 from public.roles x where x.id = r and (x.hotel_id is null or x.hotel_id = p_hotel_id))) then
    raise exception 'Unknown role' using errcode = '23503';
  end if;

  -- تُطبَّق عبر الجداول نفسها حتى تعمل كل الحراسات (عدم المنح الزائد، بقاء مدير للمستخدمين)
  delete from public.user_hotel_roles where hotel_id = p_hotel_id and user_id = p_user_id and not (role_id = any (coalesce(p_role_ids, '{}')));
  insert into public.user_hotel_roles (hotel_id, user_id, role_id)
  select p_hotel_id, p_user_id, r from unnest(coalesce(p_role_ids, '{}')) r on conflict do nothing;

  delete from public.user_permission_overrides where hotel_id = p_hotel_id and user_id = p_user_id;
  insert into public.user_permission_overrides (hotel_id, user_id, permission_code, allow)
  select p_hotel_id, p_user_id, g, true from unnest(coalesce(p_grants, '{}')) g
  union all
  select p_hotel_id, p_user_id, d, false from unnest(coalesce(p_denies, '{}')) d;

  update public.hotel_members
     set home_path = nullif(trim(coalesce(p_home_path, '')), ''), limits = coalesce(p_limits, '{}'::jsonb), is_active = coalesce(p_is_active, true)
   where hotel_id = p_hotel_id and user_id = p_user_id;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.my_limits(uuid)', 'public.my_interface(uuid)', 'public.decide_approval(uuid, boolean, text)',
    'public.finish_approval(uuid, boolean, text, text)', 'public.cancel_approval(uuid)',
    'public.member_access(uuid, uuid)',
    'public.set_member_access(uuid, uuid, uuid[], text[], text[], text, jsonb, boolean)'
  ] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
grant execute on function app.effective_permissions(uuid, uuid) to authenticated;
grant execute on function app.member_limit(uuid, text, uuid) to authenticated;
grant execute on function app.hotel_has_user_admin(uuid) to authenticated;
grant execute on function app.actor_holds_all(uuid, text[]) to authenticated;
