-- الفورمات: طبقة الـAPI (pg_safeupdate) ترفض DELETE بلا WHERE، فيُكتب الشرط صراحةً
create or replace function public.factory_reset(p_confirm text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_owner  uuid := auth.uid();
  v_tables text;
begin
  if v_owner is null or not app.is_owner(v_owner) then
    raise exception 'Only the system owner can format the system' using errcode = '42501';
  end if;
  if coalesce(trim(p_confirm), '') <> 'فورمات' then
    raise exception 'Type the confirmation word to format the system' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtext('nazeel.factory_reset'));

  -- 1) كل جداول الفنادق (ما عدا الأدوار: فيها الأدوار الأساسية المشتركة) دفعة واحدة
  select string_agg(format('%I.%I', n.nspname, c.relname), ', ')
    into v_tables
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  join pg_attribute a on a.attrelid = c.oid and a.attname = 'hotel_id' and not a.attisdropped
  where c.relkind in ('r', 'p') and n.nspname in ('public', 'app') and not (n.nspname = 'public' and c.relname = 'roles');
  execute 'truncate table public.assistant_messages, ' || v_tables;

  -- 2) الأدوار الخاصة بالفنادق، ثم الفنادق نفسها
  update public.users_profiles set default_hotel_id = null where default_hotel_id is not null;
  delete from public.role_permissions where role_id in (select id from public.roles where hotel_id is not null);
  delete from public.roles where hotel_id is not null;
  -- سطور التدقيق التي كتبها حذف الأدوار تمنع ربطها بفندق محذوف، فتُمسح قبل حذف الفنادق وبعده
  truncate table public.audit_logs;
  -- تريغر التدقيق على الفنادق يكتب سطرًا يشير للفندق المحذوف، فيُوقف لحظة الحذف فقط
  alter table public.hotels disable trigger user;
  delete from public.hotels where true;
  alter table public.hotels enable trigger user;
  truncate table public.audit_logs, app.temp_passwords;

  -- 3) الحسابات: يبقى صاحب النظام وحده
  update public.users_profiles set updated_by = null where updated_by is not null;
  delete from public.users_profiles where id <> v_owner;
  delete from auth.users where id <> v_owner;
  update public.users_profiles set is_active = true where id = v_owner;
end;
$$;
