-- =============================================================================
-- إدارة الموظفين من صفحة كل موظف:
--  1) إيقاف الدخول وإعادته بزر واحد (يُخرج الموظف من أجهزته فورًا ويلغي روابطه غير المستخدمة)
--  2) حذف الموظف من الفندق: تسقط أدواره وصلاحياته وروابطه وجلساته، وإن لم يبق له فندق آخر
--     يُغلق حسابه نهائيًا (كلمة مرور عشوائية لا يعرفها أحد). يبقى اسمه على المستندات السابقة للتدقيق.
--  3) حالة رابط الدخول لكل موظف: هل دخل من قبل، ومتى ينتهي رابطه غير المستخدم
-- =============================================================================

create or replace function public.set_staff_active(p_hotel_id uuid, p_user_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.assert_can_manage_account(p_hotel_id, p_user_id);
  update public.hotel_members set is_active = coalesce(p_active, true)
   where hotel_id = p_hotel_id and user_id = p_user_id;
  if not coalesce(p_active, true) then
    delete from auth.sessions where user_id = p_user_id;
    delete from app.access_links where user_id = p_user_id and hotel_id = p_hotel_id and used_at is null;
  end if;
end;
$$;

create or replace function public.remove_staff_member(p_hotel_id uuid, p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_closed boolean := false;
begin
  perform app.assert_can_manage_account(p_hotel_id, p_user_id);
  -- الأدوار والاستثناءات مرتبطة بالعضوية فتُحذف معها
  delete from public.hotel_members where hotel_id = p_hotel_id and user_id = p_user_id;
  delete from app.access_links where user_id = p_user_id and hotel_id = p_hotel_id;
  delete from auth.sessions where user_id = p_user_id;
  if not exists (select 1 from public.hotel_members where user_id = p_user_id) then
    delete from app.access_links where user_id = p_user_id;
    delete from app.temp_passwords where user_id = p_user_id;
    update auth.users
       set encrypted_password = extensions.crypt(encode(extensions.gen_random_bytes(32), 'hex'), extensions.gen_salt('bf', 10)),
           updated_at = now()
     where id = p_user_id;
    update public.users_profiles set is_active = false, default_hotel_id = null where id = p_user_id;
    v_closed := true;
  end if;
  return v_closed;
end;
$$;

-- حالة الدخول لموظفي الفندق: joined = دخل مرة على الأقل (برابط أو بكلمة مرور اختارها)،
-- link_expires_at = نهاية آخر رابط لم يُستخدم ولم ينته بعد
create or replace function public.staff_link_status(p_hotel_id uuid)
returns table (user_id uuid, joined boolean, link_expires_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_permission(p_hotel_id, 'settings.users.manage');
  return query
  select m.user_id,
         exists (select 1 from app.access_links l where l.user_id = m.user_id and l.used_at is not null)
           or coalesce(p.password_chosen, false),
         (select max(l.expires_at) from app.access_links l
           where l.user_id = m.user_id and l.hotel_id = p_hotel_id and l.used_at is null and l.expires_at > now())
  from public.hotel_members m
  left join public.users_profiles p on p.id = m.user_id
  where m.hotel_id = p_hotel_id;
end;
$$;

do $$
declare
  f text;
begin
  foreach f in array array[
    'public.set_staff_active(uuid, uuid, boolean)',
    'public.remove_staff_member(uuid, uuid)',
    'public.staff_link_status(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
