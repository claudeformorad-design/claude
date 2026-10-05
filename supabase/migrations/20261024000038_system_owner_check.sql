-- =============================================================================
-- هل المستخدم الحالي صاحب النظام؟ الواجهة تُظهر بها ما يخص المالك وحده
-- (فورمات النظام ومفتاح المساعد الذكي)، والحماية الفعلية تبقى في الدوال نفسها.
-- =============================================================================

create or replace function public.is_system_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select app.is_owner(auth.uid());
$$;

revoke all on function public.is_system_owner() from public, anon;
grant execute on function public.is_system_owner() to authenticated;
