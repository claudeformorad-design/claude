-- =============================================================================
-- مرفقات المستندات: صورة فاتورة المورد، إيصال، عقد... تُرفق بالقيد أو السند أو فاتورة المورد أو فاتورة
-- العميل. البيانات الوصفية في جدول مقروء بالصلاحيات (ويُسجَّل في التدقيق)، والمحتوى في جدول منفصل
-- لا يُقرأ إلا عبر دالة تتحقق من صلاحية عرض المستند نفسه. الحد 3 ميجابايت للملف.
-- =============================================================================

create table public.attachments (
  id           uuid primary key default gen_random_uuid(),
  hotel_id     uuid not null references public.hotels(id) on delete cascade,
  entity_type  text not null check (entity_type in ('journal_entry', 'payment', 'vendor_bill', 'invoice')),
  entity_id    uuid not null,
  file_name    text not null check (length(trim(file_name)) between 1 and 200),
  mime_type    text not null check (mime_type in (
                 'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif',
                 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')),
  size_bytes   integer not null check (size_bytes between 1 and 3145728),
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id),
  unique (hotel_id, id)
);
create index attachments_entity_idx on public.attachments (hotel_id, entity_type, entity_id);

create table public.attachment_contents (
  attachment_id  uuid primary key references public.attachments(id) on delete cascade,
  hotel_id       uuid not null references public.hotels(id) on delete cascade,
  content        bytea not null
);
alter table public.attachment_contents enable row level security;
revoke all on public.attachment_contents from anon, authenticated;

create trigger attachments_system_only before insert or update on public.attachments
  for each row execute function app.system_write_only();
alter table public.attachments enable row level security;
create policy attachments_read on public.attachments for select to authenticated using (
     (entity_type = 'journal_entry' and hotel_id in (select app.permitted_hotels('gl.journal.view')))
  or (entity_type = 'payment'       and hotel_id in (select app.permitted_hotels('payments.view')))
  or (entity_type = 'vendor_bill'   and hotel_id in (select app.permitted_hotels('bills.view')))
  or (entity_type = 'invoice'       and hotel_id in (select app.permitted_hotels('invoices.view')))
);
create trigger audit_attachments after insert or update or delete on public.attachments
  for each row execute function app.audit_trigger();

-- صلاحية العرض أو الإرفاق لكل نوع مستند
create or replace function app.attachment_allowed(p_hotel_id uuid, p_entity_type text, p_write boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case p_entity_type
    when 'journal_entry' then app.has_permission(p_hotel_id, case when p_write then 'gl.journal.create' else 'gl.journal.view' end)
    when 'payment' then case when p_write then app.has_permission(p_hotel_id, 'payments.receipt') or app.has_permission(p_hotel_id, 'payments.disbursement')
                             else app.has_permission(p_hotel_id, 'payments.view') end
    when 'vendor_bill' then app.has_permission(p_hotel_id, case when p_write then 'bills.create' else 'bills.view' end)
    when 'invoice' then app.has_permission(p_hotel_id, case when p_write then 'invoices.create' else 'invoices.view' end)
    else false end;
$$;

create or replace function public.add_attachment(
  p_hotel_id uuid, p_entity_type text, p_entity_id uuid, p_file_name text, p_mime_type text, p_content_base64 text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bytes bytea;
  v_id    uuid;
begin
  if not app.attachment_allowed(p_hotel_id, p_entity_type, true) then
    raise exception 'Permission denied: you cannot attach files to this document' using errcode = '42501';
  end if;
  if not (case p_entity_type
      when 'journal_entry' then exists (select 1 from public.journal_entries where id = p_entity_id and hotel_id = p_hotel_id)
      when 'payment' then exists (select 1 from public.payments where id = p_entity_id and hotel_id = p_hotel_id)
      when 'vendor_bill' then exists (select 1 from public.vendor_bills where id = p_entity_id and hotel_id = p_hotel_id)
      when 'invoice' then exists (select 1 from public.invoices where id = p_entity_id and hotel_id = p_hotel_id)
      else false end) then
    raise exception 'Document not found' using errcode = 'P0002';
  end if;
  begin
    v_bytes := decode(coalesce(p_content_base64, ''), 'base64');
  exception when others then
    raise exception 'The file could not be read' using errcode = '22023';
  end;
  if octet_length(v_bytes) = 0 then
    raise exception 'The file is empty' using errcode = '22023';
  end if;
  if octet_length(v_bytes) > 3145728 then
    raise exception 'The file is larger than 3 MB' using errcode = '22023';
  end if;
  if (select count(*) from public.attachments where hotel_id = p_hotel_id and entity_type = p_entity_type and entity_id = p_entity_id) >= 20 then
    raise exception 'A document can have at most 20 attachments' using errcode = '23514';
  end if;

  perform set_config('app.system_posting', 'on', true);
  insert into public.attachments (hotel_id, entity_type, entity_id, file_name, mime_type, size_bytes, created_by)
  values (p_hotel_id, p_entity_type, p_entity_id, trim(p_file_name), p_mime_type, octet_length(v_bytes), auth.uid())
  returning id into v_id;
  insert into public.attachment_contents (attachment_id, hotel_id, content) values (v_id, p_hotel_id, v_bytes);
  perform set_config('app.system_posting', 'off', true);
  return v_id;
end;
$$;

create or replace function public.attachment_content(p_id uuid)
returns table (file_name text, mime_type text, content_base64 text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_a public.attachments%rowtype;
begin
  select * into v_a from public.attachments where id = p_id;
  if not found or not app.attachment_allowed(v_a.hotel_id, v_a.entity_type, false) then
    raise exception 'Attachment not found' using errcode = 'P0002';
  end if;
  return query
  select v_a.file_name, v_a.mime_type, translate(encode(c.content, 'base64'), E'\n', '')
  from public.attachment_contents c where c.attachment_id = p_id;
end;
$$;

-- الحذف لمن يملك الإرفاق على نوع المستند (ويبقى أثره في سجل التدقيق)
create or replace function public.delete_attachment(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a public.attachments%rowtype;
begin
  select * into v_a from public.attachments where id = p_id for update;
  if not found or not app.attachment_allowed(v_a.hotel_id, v_a.entity_type, false) then
    raise exception 'Attachment not found' using errcode = 'P0002';
  end if;
  if not app.attachment_allowed(v_a.hotel_id, v_a.entity_type, true) then
    raise exception 'Permission denied: you cannot attach files to this document' using errcode = '42501';
  end if;
  delete from public.attachments where id = p_id;
end;
$$;

do $$
declare f text;
begin
  foreach f in array array[
    'public.add_attachment(uuid, text, uuid, text, text, text)',
    'public.attachment_content(uuid)',
    'public.delete_attachment(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;
revoke all on function app.attachment_allowed(uuid, text, boolean) from public, anon;
