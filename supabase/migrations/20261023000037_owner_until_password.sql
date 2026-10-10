-- =============================================================================
-- زر «ابدأ» يبقى متاحًا حتى يضع صاحب النظام كلمة مرور:
-- قبلها يستطيع أي جهاز يفتح النظام الدخول كصاحب النظام بنفس حسابه وبياناته (مفيد إذا خرج جهازه)،
-- وبعد أن يختار كلمة مرور يُغلق الزر نهائيًا ويصبح الدخول باسم admin وكلمته.
-- =============================================================================

create or replace function public.system_has_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
           select 1 from public.users_profiles p
           where p.id::text = coalesce(app.setting('owner_user'), '') and p.password_chosen
         )
      or exists (select 1 from auth.users u where lower(u.email) = lower(coalesce(app.setting('owner_email'), '')));
$$;

create or replace function public.claim_owner()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext('nazeel.claim_owner'));
  if public.system_has_owner() then
    raise exception 'The system already has an owner' using errcode = '42501';
  end if;
  -- صاحب النظام موجود ولم يضع كلمة مرور بعد: دخول جديد لنفس الحساب
  select u.id into v_id from auth.users u where u.id::text = coalesce(app.setting('owner_user'), '');
  if v_id is null then
    v_id := app.new_account('admin@' || app.staff_domain(), 'مدير النظام');
    insert into app.system_settings (key, value) values ('owner_user', v_id::text)
    on conflict (key) do update set value = excluded.value;
  end if;
  insert into app.system_settings (key, value) values ('signup_mode', 'invite')
  on conflict (key) do update set value = excluded.value;
  return app.issue_login(v_id);
end;
$$;

revoke all on function public.system_has_owner() from public;
revoke all on function public.claim_owner() from public;
grant execute on function public.system_has_owner() to anon, authenticated;
grant execute on function public.claim_owner() to anon, authenticated;
