-- =============================================================================
-- اختبارات المرفقات: الإرفاق والقراءة بالصلاحيات، الحجم والنوع، المحتوى المحمي، الحذف والتدقيق،
-- وعزل الفنادق
-- =============================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\o /dev/null

-- الاختبارات السابقة قد تترك التسجيل بالدعوة فقط؛ مستخدمو الاختبار يُضافون مباشرة
delete from app.system_settings where key = 'signup_mode';

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000003001', 'gm30@hotel.test'),
  ('00000000-0000-0000-0000-000000003002', 'hk30@hotel.test'),
  ('00000000-0000-0000-0000-000000003003', 'other30@hotel.test'),
  ('00000000-0000-0000-0000-000000003004', 'cash30@hotel.test');

create or replace function pg_temp.expect_error(p_sql text, p_contains text)
returns void language plpgsql as $$
begin
  begin execute p_sql;
  exception when others then
    if position(p_contains in sqlerrm) = 0 then raise exception 'Expected "%", got "%"', p_contains, sqlerrm; end if;
    return;
  end;
  raise exception 'Expected error "%", but succeeded: %', p_contains, p_sql;
end $$;
create or replace function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), false);
  if p_user is null then reset role; else set role authenticated; end if;
end $$;
create or replace function pg_temp.check(p_ok boolean, p_msg text) returns void language plpgsql as $$
begin if not coalesce(p_ok, false) then raise exception 'Check failed: %', p_msg; end if; end $$;

select pg_temp.act_as('00000000-0000-0000-0000-000000003001');
create temp table h30 as select public.create_hotel('فندق المرفقات', 'SA', 'SAR') as id;
create temp table ids (k text primary key, v uuid);
grant all on h30, ids to authenticated;
select public.add_hotel_member((select id from h30), 'hk30@hotel.test', array[(select id from public.roles where is_system and code = 'housekeeping')]);
select public.add_hotel_member((select id from h30), 'cash30@hotel.test', array[(select id from public.roles where is_system and code = 'cashier')]);
insert into ids select 'je', public.save_journal_entry((select id from h30), current_date, 'إيجار',
  jsonb_build_array(jsonb_build_object('account_id', (select id from public.chart_of_accounts where hotel_id = (select id from h30) and code = '5208'), 'debit', 100),
                    jsonb_build_object('account_id', (select id from public.chart_of_accounts where hotel_id = (select id from h30) and code = '1101'), 'credit', 100)),
  null, null, 1, null, true);

-- "Hello PDF" بترميز base64
insert into ids select 'a1', public.add_attachment((select id from h30), 'journal_entry', (select v from ids where k = 'je'), 'عقد الإيجار.pdf', 'application/pdf', 'SGVsbG8gUERG');
select pg_temp.check((select size_bytes from public.attachments where id = (select v from ids where k = 'a1')) = 9, 'size from decoded bytes');
select pg_temp.check((select content_base64 from public.attachment_content((select v from ids where k = 'a1'))) = 'SGVsbG8gUERG', 'content round trip');
select pg_temp.check((select count(*) from public.audit_logs where table_name = 'attachments') = 1, 'upload audited');

-- التحقق
select pg_temp.expect_error($q$ select public.add_attachment((select id from h30), 'journal_entry', gen_random_uuid(), 'x.pdf', 'application/pdf', 'SGVsbG8=') $q$, 'Document not found');
select pg_temp.expect_error($q$ select public.add_attachment((select id from h30), 'journal_entry', (select v from ids where k = 'je'), 'x.exe', 'application/x-msdownload', 'SGVsbG8=') $q$, 'mime_type');
select pg_temp.expect_error($q$ select public.add_attachment((select id from h30), 'journal_entry', (select v from ids where k = 'je'), 'x.pdf', 'application/pdf', '') $q$, 'empty');
select pg_temp.expect_error($q$ select public.add_attachment((select id from h30), 'journal_entry', (select v from ids where k = 'je'), 'x.pdf', 'application/pdf', '%%%') $q$, 'could not be read');
select pg_temp.expect_error($q$ select public.add_attachment((select id from h30), 'journal_entry', (select v from ids where k = 'je'), 'big.pdf', 'application/pdf',
  encode(convert_to(repeat('a', 3145729), 'UTF8'), 'base64')) $q$, 'larger than 3 MB');

-- المحتوى غير مقروء مباشرة حتى لصاحب الصلاحية
select pg_temp.expect_error($q$ select content from public.attachment_contents $q$, 'permission denied');

-- الكاشير لا يرى القيود فلا يرى مرفقاتها، والإشراف الداخلي كذلك
select pg_temp.act_as('00000000-0000-0000-0000-000000003004');
select pg_temp.check((select count(*) from public.attachments where hotel_id = (select id from h30)) = 0, 'cashier cannot list journal attachments');
select pg_temp.expect_error($q$ select * from public.attachment_content((select v from ids where k = 'a1')) $q$, 'Attachment not found');
select pg_temp.expect_error($q$ select public.add_attachment((select id from h30), 'journal_entry', (select v from ids where k = 'je'), 'x.pdf', 'application/pdf', 'SGVsbG8=') $q$, 'Permission denied');
select pg_temp.act_as('00000000-0000-0000-0000-000000003002');
select pg_temp.expect_error($q$ select public.delete_attachment((select v from ids where k = 'a1')) $q$, 'Attachment not found');

-- فندق آخر لا يرى شيئًا
select pg_temp.act_as('00000000-0000-0000-0000-000000003003');
select public.create_hotel('فندق آخر', 'SA', 'SAR');
select pg_temp.check((select count(*) from public.attachments) = 0, 'isolated between hotels');
select pg_temp.expect_error($q$ select * from public.attachment_content((select v from ids where k = 'a1')) $q$, 'Attachment not found');

-- الحذف المباشر بلا أثر، والحذف عبر الدالة يمسح المحتوى ويُسجَّل
select pg_temp.act_as('00000000-0000-0000-0000-000000003001');
delete from public.attachments where id = (select v from ids where k = 'a1');
select pg_temp.check((select count(*) from public.attachments where id = (select v from ids where k = 'a1')) = 1, 'direct delete has no effect');
select public.delete_attachment((select v from ids where k = 'a1'));
select pg_temp.act_as(null);
select pg_temp.check((select count(*) from public.attachment_contents) = 0, 'content removed');
select pg_temp.check((select count(*) from public.audit_logs where table_name = 'attachments') = 2, 'delete audited');

\o
select 'attachments tests passed';
