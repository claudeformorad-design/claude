-- =============================================================================
-- تخصيص النظام لكل فندق على ثلاثة مستويات:
--   1) الأقسام (الحجوزات، المحاسبة، المغسلة، الموظفين...): يملكها صاحب النظام، فهي ما اشتراه الفندق.
--      إن لم يُحدَّد صاحب للنظام (التثبيت المحلي قبل الترخيص) يتحكم فيها مدير الفندق.
--   2) أجزاء الأقسام، 3) الخانات والأزرار: يتحكم فيها مدير الفندق.
-- القائمة نفسها (ما هو كل مفتاح وما يتبعه من صفحات وصلاحيات) في التطبيق؛ هنا الحفظ والتطبيق الفعلي:
-- ما يُطفأ يحمل معه صلاحياته الخاصة، فتسقط من صلاحيات كل موظفي الفندق (الواجهة والقاعدة معًا).
-- لا يُحذف شيء من البيانات: الإطفاء يخفي ويمنع فقط، والتشغيل يعيد كل شيء كما كان.
-- =============================================================================

alter table public.hotels
  add column blocked_sections    text[] not null default '{}',
  add column section_permissions text[] not null default '{}',
  add column disabled_features   text[] not null default '{}',
  add column feature_permissions text[] not null default '{}',
  -- إدارة الفندق والمستخدمين لا تُطفأ أبدًا: بدونها لا يمكن التراجع
  add constraint hotels_toggles_keep_admin check (
    not (section_permissions && array['settings.hotel.manage', 'settings.users.manage'])
    and not (feature_permissions && array['settings.hotel.manage', 'settings.users.manage'])
  );

-- هل يتحكم المستخدم الحالي في أقسام الفندق؟ صاحب النظام دائمًا، ومدير الفندق إن لم يُحدَّد صاحب للنظام
create or replace function app.can_manage_sections(p_hotel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_owner(auth.uid())
      or (coalesce(app.setting('owner_user'), '') = '' and coalesce(app.setting('owner_email'), '') = ''
          and app.has_permission(p_hotel_id, 'settings.hotel.manage'));
$$;

create or replace function public.can_manage_sections(p_hotel_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.can_manage_sections(p_hotel_id);
$$;

-- حراسة: أعمدة الأقسام لا يغيّرها إلا من يملكها، حتى بالتحديث المباشر على جدول الفنادق
create or replace function app.guard_hotel_sections()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null
     and (new.enabled_modules is distinct from old.enabled_modules
          or new.blocked_sections is distinct from old.blocked_sections
          or new.section_permissions is distinct from old.section_permissions)
     and not app.can_manage_sections(new.id) then
    raise exception 'Only the system owner can turn sections on or off' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger hotels_guard_sections before update of enabled_modules, blocked_sections, section_permissions on public.hotels
  for each row execute function app.guard_hotel_sections();

-- تنظيف قائمة نصية: بلا فراغات ولا تكرار، مرتبة
create or replace function app.clean_keys(p_keys text[])
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(distinct k order by k), '{}')
  from unnest(coalesce(p_keys, '{}')) k
  where k is not null and length(trim(k)) between 1 and 120;
$$;

-- الأقسام: الأساسية (الحجوزات والمحاسبة) في enabled_modules كما كانت، والبقية في blocked_sections
create or replace function public.save_hotel_sections(
  p_hotel_id uuid, p_modules text[], p_blocked text[], p_permissions text[]
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- غير المدير يُرفض كالمعتاد، والمدير يُرفض إن كان للنظام صاحب غيره
  if not app.is_owner(auth.uid()) then
    perform app.require_permission(p_hotel_id, 'settings.hotel.manage');
  end if;
  if not app.can_manage_sections(p_hotel_id) then
    raise exception 'Only the system owner can turn sections on or off' using errcode = '42501';
  end if;
  if p_modules is null or cardinality(p_modules) = 0 then
    raise exception 'At least one module must be enabled' using errcode = '23514';
  end if;
  update public.hotels
     set enabled_modules = app.clean_keys(p_modules),
         blocked_sections = app.clean_keys(p_blocked),
         section_permissions = app.clean_keys(array_remove(array_remove(p_permissions, 'settings.hotel.manage'), 'settings.users.manage'))
   where id = p_hotel_id;
end;
$$;

-- الأجزاء والخانات والأزرار: مدير الفندق
create or replace function public.save_hotel_features(p_hotel_id uuid, p_disabled text[], p_permissions text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_permission(p_hotel_id, 'settings.hotel.manage');
  update public.hotels
     set disabled_features = app.clean_keys(p_disabled),
         feature_permissions = app.clean_keys(array_remove(array_remove(p_permissions, 'settings.hotel.manage'), 'settings.users.manage'))
   where id = p_hotel_id;
end;
$$;

-- الأقسام تُدار الآن من صفحة تخصيص النظام بحراسة صاحب النظام
create or replace function public.set_hotel_modules(p_hotel_id uuid, p_modules text[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- غير المدير يُرفض كالمعتاد، والمدير يُرفض إن كان للنظام صاحب غيره
  if not app.is_owner(auth.uid()) then
    perform app.require_permission(p_hotel_id, 'settings.hotel.manage');
  end if;
  if not app.can_manage_sections(p_hotel_id) then
    raise exception 'Only the system owner can turn sections on or off' using errcode = '42501';
  end if;
  if p_modules is null or cardinality(p_modules) = 0 then
    raise exception 'At least one module must be enabled' using errcode = '23514';
  end if;
  update public.hotels set enabled_modules = app.clean_keys(p_modules) where id = p_hotel_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- الصلاحية الفعلية: كما كانت، مطروحًا منها ما أُطفئ في الفندق
-- -----------------------------------------------------------------------------
create or replace function app.effective_permissions(p_hotel_id uuid, p_user_id uuid)
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  with member as (
    select h.enabled_modules, h.section_permissions || h.feature_permissions as off
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
    and not (g.code = any (mb.off))
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
      and not (p_permission = any (h.section_permissions))
      and not (p_permission = any (h.feature_permissions))
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

revoke all on function app.can_manage_sections(uuid) from public, anon, authenticated;
revoke all on function app.guard_hotel_sections() from public, anon, authenticated;
do $$
declare f text;
begin
  foreach f in array array[
    'public.can_manage_sections(uuid)',
    'public.save_hotel_sections(uuid, text[], text[], text[])',
    'public.save_hotel_features(uuid, text[], text[])',
    'public.set_hotel_modules(uuid, text[])'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
