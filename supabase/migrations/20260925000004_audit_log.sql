-- =============================================================================
-- المرحلة 1 / الترحيل 4: سجل التدقيق (Audit Log) — من، متى، ماذا عدّل
-- السجل للإضافة فقط: لا تعديل ولا حذف (لا توجد سياسات كتابة، وتريغر يمنع التعديل)
-- =============================================================================

create table public.audit_logs (
  id              bigint generated always as identity primary key,
  hotel_id        uuid references public.hotels(id) on delete set null,
  table_name      text not null,
  record_id       text not null,
  action          text not null check (action in ('INSERT', 'UPDATE', 'DELETE')),
  old_data        jsonb,
  new_data        jsonb,
  changed_fields  text[],
  actor_id        uuid,
  occurred_at     timestamptz not null default now()
);

create index audit_logs_hotel_time_idx on public.audit_logs (hotel_id, occurred_at desc);
create index audit_logs_record_idx on public.audit_logs (table_name, record_id);

create or replace function app.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old     jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new     jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_row     jsonb := coalesce(v_new, v_old);
  v_hotel   uuid;
  v_changed text[];
begin
  v_hotel := case
    when tg_table_name = 'hotels' then (v_row ->> 'id')::uuid
    when tg_table_name = 'role_permissions' then
      (select r.hotel_id from public.roles r where r.id = (v_row ->> 'role_id')::uuid)
    else (v_row ->> 'hotel_id')::uuid
  end;

  if tg_op = 'UPDATE' then
    select array_agg(n.key order by n.key) into v_changed
    from jsonb_each(v_new) n
    where n.value is distinct from (v_old -> n.key)
      and n.key not in ('updated_at', 'updated_by');
    -- تجاهل التحديثات التي لم تغيّر شيئًا فعليًا
    if v_changed is null then
      return null;
    end if;
  end if;

  insert into public.audit_logs (hotel_id, table_name, record_id, action, old_data, new_data, changed_fields, actor_id)
  values (
    v_hotel, tg_table_name,
    coalesce(v_row ->> 'id', concat_ws(':', v_row ->> 'hotel_id', v_row ->> 'user_id', v_row ->> 'role_id', v_row ->> 'permission_code')),
    tg_op, v_old, v_new, v_changed, auth.uid()
  );
  return null;
end;
$$;

create or replace function app.audit_logs_immutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Audit log is append-only' using errcode = '42501';
end;
$$;

create trigger audit_logs_immutable before update or delete on public.audit_logs
  for each row execute function app.audit_logs_immutable();

-- ربط التدقيق بالجداول الحساسة
create trigger audit_hotels after insert or update or delete on public.hotels
  for each row execute function app.audit_trigger();
create trigger audit_hotel_members after insert or update or delete on public.hotel_members
  for each row execute function app.audit_trigger();
create trigger audit_roles after insert or update or delete on public.roles
  for each row execute function app.audit_trigger();
create trigger audit_departments after insert or update or delete on public.departments
  for each row execute function app.audit_trigger();
create trigger audit_exchange_rates after insert or update or delete on public.exchange_rates
  for each row execute function app.audit_trigger();
create trigger audit_chart_of_accounts after insert or update or delete on public.chart_of_accounts
  for each row execute function app.audit_trigger();
create trigger audit_fiscal_years after insert or update or delete on public.fiscal_years
  for each row execute function app.audit_trigger();
create trigger audit_accounting_periods after insert or update or delete on public.accounting_periods
  for each row execute function app.audit_trigger();
create trigger audit_journal_entries after insert or update or delete on public.journal_entries
  for each row execute function app.audit_trigger();
create trigger audit_journal_entry_lines after insert or update or delete on public.journal_entry_lines
  for each row execute function app.audit_trigger();
create trigger audit_role_permissions after insert or update or delete on public.role_permissions
  for each row execute function app.audit_trigger();
