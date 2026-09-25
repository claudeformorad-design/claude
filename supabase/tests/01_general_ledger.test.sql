-- =============================================================================
-- اختبارات قاعدة البيانات للمرحلة 1: الصلاحيات، دليل الحسابات، القيد المزدوج
-- تُشغّل عبر: npm run test:db
-- =============================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\o /dev/null

-- مستخدمون تجريبيون
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'gm@hotel.test',       '{"full_name":"المدير العام"}'),
  ('00000000-0000-0000-0000-0000000000a2', 'auditor@hotel.test',  '{}'),
  ('00000000-0000-0000-0000-0000000000a3', 'outsider@other.test', '{}'),
  ('00000000-0000-0000-0000-0000000000a4', 'acct@hotel.test',     '{}'),
  ('00000000-0000-0000-0000-0000000000a5', 'clerk@hotel.test',    '{}');

-- أداة مساعدة: توقع فشل عبارة SQL برسالة تحتوي نصًا معينًا
create or replace function pg_temp.expect_error(p_sql text, p_contains text)
returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if position(p_contains in sqlerrm) = 0 then
      raise exception 'Expected error containing "%", got "%"', p_contains, sqlerrm;
    end if;
    return;
  end;
  raise exception 'Expected error containing "%", but statement succeeded: %', p_contains, p_sql;
end $$;
grant execute on function pg_temp.expect_error(text, text) to authenticated;

create or replace function pg_temp.act_as(p_user uuid)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), false);
  if p_user is null then reset role; else set role authenticated; end if;
end $$;

-- -----------------------------------------------------------------------------
-- 1) إنشاء فندق مع البيانات الافتراضية
-- -----------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');

create temp table ctx as
select public.create_hotel('فندق الاختبار', 'SA', 'SAR', 'Test Hotel', 1::smallint, 'Asia/Riyadh', true) as hotel_id;
grant select on ctx to authenticated;

do $$
declare h uuid := (select hotel_id from ctx);
begin
  assert (select count(*) from public.departments where hotel_id = h) = 11, 'default departments';
  assert (select count(*) from public.chart_of_accounts where hotel_id = h) > 60, 'default COA';
  assert (select count(*) from public.accounting_periods where hotel_id = h) = 12, '12 periods';
  assert (select count(*) from public.my_permissions(h)) = (select count(*) from public.permissions), 'GM has all permissions';
  assert (select level from public.chart_of_accounts where hotel_id = h and code = '1101') = 3, 'account level computed';
end $$;

-- أعضاء إضافيون (بواسطة المدير العام)
insert into public.hotel_members (hotel_id, user_id, role_id)
select (select hotel_id from ctx), '00000000-0000-0000-0000-0000000000a2', id from public.roles where is_system and code = 'auditor';
insert into public.hotel_members (hotel_id, user_id, role_id)
select (select hotel_id from ctx), '00000000-0000-0000-0000-0000000000a4', id from public.roles where is_system and code = 'accountant';

-- دور مخصص: كاتب قيود (إنشاء بدون ترحيل)
insert into public.roles (hotel_id, code, name_ar, name_en)
select hotel_id, 'journal_clerk', 'كاتب قيود', 'Journal Clerk' from ctx;
insert into public.role_permissions (role_id, permission_code)
select r.id, p from public.roles r, unnest(array['gl.journal.view', 'gl.journal.create', 'coa.accounts.view']) p
where r.code = 'journal_clerk';
insert into public.hotel_members (hotel_id, user_id, role_id)
select (select hotel_id from ctx), '00000000-0000-0000-0000-0000000000a5', id from public.roles where code = 'journal_clerk';

-- لا يمكن تعديل صلاحيات الأدوار النظامية
select pg_temp.expect_error($q$
  insert into public.role_permissions (role_id, permission_code)
  select id, 'audit.logs.view' from public.roles where is_system and code = 'cashier'
$q$, 'System roles cannot be modified');

-- -----------------------------------------------------------------------------
-- 2) سلامة شجرة الحسابات
-- -----------------------------------------------------------------------------
select pg_temp.expect_error($q$
  insert into public.chart_of_accounts (hotel_id, code, name_ar, account_type, account_subtype, parent_id)
  select hotel_id, '1199', 'حساب مصروف تحت الأصول', 'expense', 'operating_expense',
         (select id from public.chart_of_accounts where code = '11' and hotel_id = ctx.hotel_id) from ctx
$q$, 'must match parent type');

select pg_temp.expect_error($q$
  insert into public.chart_of_accounts (hotel_id, code, name_ar, account_type, account_subtype, parent_id)
  select hotel_id, '110101', 'فرعي تحت حساب تفصيلي', 'asset', 'current_asset',
         (select id from public.chart_of_accounts where code = '1101' and hotel_id = ctx.hotel_id) from ctx
$q$, 'is postable');

select pg_temp.expect_error($q$
  insert into public.chart_of_accounts (hotel_id, code, name_ar, account_type, account_subtype)
  select hotel_id, '9', 'تصنيف خاطئ', 'asset', 'operating_revenue' from ctx
$q$, 'coa_subtype_matches_type');

-- -----------------------------------------------------------------------------
-- 3) القيد المزدوج: إنشاء وترحيل قيد متوازن
-- -----------------------------------------------------------------------------
create temp table acc as
select code, id from public.chart_of_accounts where hotel_id = (select hotel_id from ctx);
grant select on acc to authenticated;

create temp table je as
select public.save_journal_entry(
  (select hotel_id from ctx), current_date, 'إيداع رأس المال',
  jsonb_build_array(
    jsonb_build_object('account_id', (select id from acc where code = '1103'), 'debit', 100000, 'credit', 0),
    jsonb_build_object('account_id', (select id from acc where code = '3101'), 'debit', 0, 'credit', 100000)
  ),
  'CAP-001', null, 1, null, true
) as id;
grant select on je to authenticated;

do $$
declare v public.journal_entries%rowtype;
begin
  select * into v from public.journal_entries where id = (select id from je);
  assert v.status = 'posted', 'entry posted';
  assert v.entry_number = 'JV-' || extract(year from current_date) || '-000001', 'first sequence number: ' || v.entry_number;
  assert v.posted_by = '00000000-0000-0000-0000-0000000000a1', 'posted_by recorded';
  assert v.created_by = '00000000-0000-0000-0000-0000000000a1', 'created_by recorded';
end $$;

-- قيد غير متوازن يُرفض عند الترحيل
select pg_temp.expect_error(format($q$
  select public.save_journal_entry(%L, current_date, 'غير متوازن',
    jsonb_build_array(
      jsonb_build_object('account_id', %L, 'debit', 500),
      jsonb_build_object('account_id', %L, 'credit', 400)
    ), null, null, 1, null, true)
$q$, (select hotel_id from ctx), (select id from acc where code = '1101'), (select id from acc where code = '4101')),
'not balanced');

-- قيد بسطر واحد يُرفض
select pg_temp.expect_error(format($q$
  select public.save_journal_entry(%L, current_date, 'سطر واحد',
    jsonb_build_array(jsonb_build_object('account_id', %L, 'debit', 500)), null, null, 1, null, true)
$q$, (select hotel_id from ctx), (select id from acc where code = '1101')),
'at least two lines');

-- سطر مدين ودائن معًا يُرفض
select pg_temp.expect_error(format($q$
  select public.save_journal_entry(%L, current_date, 'سطر مزدوج',
    jsonb_build_array(
      jsonb_build_object('account_id', %L, 'debit', 10, 'credit', 10),
      jsonb_build_object('account_id', %L, 'credit', 10)
    ), null, null, 1, null, false)
$q$, (select hotel_id from ctx), (select id from acc where code = '1101'), (select id from acc where code = '4101')),
'jel_one_side');

-- الترحيل على حساب تجميعي يُرفض
select pg_temp.expect_error(format($q$
  select public.save_journal_entry(%L, current_date, 'حساب رئيسي',
    jsonb_build_array(
      jsonb_build_object('account_id', %L, 'debit', 10),
      jsonb_build_object('account_id', %L, 'credit', 10)
    ), null, null, 1, null, false)
$q$, (select hotel_id from ctx), (select id from acc where code = '11'), (select id from acc where code = '4101')),
'header account');

-- لا يوجد فترة محاسبية للتاريخ
select pg_temp.expect_error(format($q$
  select public.save_journal_entry(%L, date '1999-01-01', 'خارج الفترات',
    jsonb_build_array(
      jsonb_build_object('account_id', %L, 'debit', 10),
      jsonb_build_object('account_id', %L, 'credit', 10)
    ), null, null, 1, null, false)
$q$, (select hotel_id from ctx), (select id from acc where code = '1101'), (select id from acc where code = '4101')),
'No accounting period');

-- -----------------------------------------------------------------------------
-- 4) عدم قابلية تعديل/حذف القيد المرحّل
-- -----------------------------------------------------------------------------
select pg_temp.expect_error($q$ update public.journal_entries set description = 'تلاعب' where id = (select id from je) $q$, 'immutable');
-- سياسة RLS تحجب المرحّل عن الحذف أصلًا؛ والتريغر يمنعه حتى لسياق النظام
delete from public.journal_entries where id = (select id from je);
do $$ begin assert (select count(*) from public.journal_entries where id = (select id from je)) = 1, 'posted entry survives delete'; end $$;
select pg_temp.act_as(null);
select pg_temp.expect_error($q$ delete from public.journal_entries where id = (select id from je) $q$, 'cannot be deleted');
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_error($q$ update public.journal_entry_lines set debit = 1 where journal_entry_id = (select id from je) and debit > 0 $q$, 'cannot be modified');
select pg_temp.expect_error($q$ delete from public.journal_entry_lines where journal_entry_id = (select id from je) $q$, 'cannot be deleted');

-- العملة الأساسية لا تتغير بعد وجود قيود مرحّلة
select pg_temp.expect_error($q$ update public.hotels set base_currency = 'USD' where id = (select hotel_id from ctx) $q$, 'Base currency');

-- الحساب الذي عليه حركات لا يتحول إلى تجميعي
select pg_temp.expect_error($q$ update public.chart_of_accounts set is_postable = false where id = (select id from acc where code = '1103') $q$, 'has journal lines');

-- -----------------------------------------------------------------------------
-- 5) عكس القيد
-- -----------------------------------------------------------------------------
create temp table rev as select public.reverse_journal_entry((select id from je), null, null) as id;
grant select on rev to authenticated;

do $$
declare
  v_orig public.journal_entries%rowtype;
  v_rev  public.journal_entries%rowtype;
begin
  select * into v_orig from public.journal_entries where id = (select id from je);
  select * into v_rev from public.journal_entries where id = (select id from rev);
  assert v_orig.reversed_by_id = v_rev.id, 'original linked to reversal';
  assert v_rev.reversal_of_id = v_orig.id and v_rev.status = 'posted' and v_rev.source = 'reversal', 'reversal posted';
  assert (select debit from public.journal_entry_lines where journal_entry_id = v_rev.id and line_no = 1) = 0
     and (select credit from public.journal_entry_lines where journal_entry_id = v_rev.id and line_no = 1) = 100000,
     'reversal swaps debit and credit';
end $$;

select pg_temp.expect_error($q$ select public.reverse_journal_entry((select id from je)) $q$, 'already reversed');
select pg_temp.expect_error($q$ select public.reverse_journal_entry((select id from rev)) $q$, 'cannot itself be reversed');

-- -----------------------------------------------------------------------------
-- 6) عملة أجنبية: التوازن محفوظ بالعملة الأساسية
-- -----------------------------------------------------------------------------
create temp table fx as
select public.save_journal_entry(
  (select hotel_id from ctx), current_date, 'دفعة بالدولار',
  jsonb_build_array(
    jsonb_build_object('account_id', (select id from acc where code = '1103'), 'debit', 333.33),
    jsonb_build_object('account_id', (select id from acc where code = '4101'), 'credit', 111.11),
    jsonb_build_object('account_id', (select id from acc where code = '4102'), 'credit', 222.22)
  ),
  null, 'USD', 3.7512345678, null, true
) as id;

do $$
begin
  assert (select base_total_debit = base_total_credit and base_total_debit = 333.33 * 3.7512345678
          from public.journal_entry_totals where journal_entry_id = (select id from fx)), 'fx base balanced';
end $$;

-- -----------------------------------------------------------------------------
-- 7) الصلاحيات: المدقق (قراءة فقط) والمستخدم الخارجي
-- -----------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a2');
do $$
begin
  assert (select count(*) from public.journal_entries) = 3, 'auditor can read entries';
  assert (select count(*) from public.audit_logs) > 0, 'auditor can read audit log';
end $$;
select pg_temp.expect_error(format($q$
  select public.save_journal_entry(%L, current_date, 'مدقق يحاول',
    jsonb_build_array(
      jsonb_build_object('account_id', %L, 'debit', 10),
      jsonb_build_object('account_id', %L, 'credit', 10)
    ))
$q$, (select hotel_id from ctx), (select id from acc where code = '1101'), (select id from acc where code = '4101')),
'Permission denied');
select pg_temp.expect_error($q$
  insert into public.chart_of_accounts (hotel_id, code, name_ar, account_type, account_subtype)
  select hotel_id, '6', 'x', 'asset', 'current_asset' from ctx
$q$, 'row-level security');

select pg_temp.act_as('00000000-0000-0000-0000-0000000000a3');
do $$
begin
  assert (select count(*) from public.hotels) = 0, 'outsider sees no hotels';
  assert (select count(*) from public.journal_entries) = 0, 'outsider sees no entries';
  assert (select count(*) from public.chart_of_accounts) = 0, 'outsider sees no accounts';
  assert (select count(*) from public.audit_logs) = 0, 'outsider sees no audit log';
end $$;

-- -----------------------------------------------------------------------------
-- 8) كاتب القيود: ينشئ مسودة لكن لا يستطيع الترحيل حتى بتعديل مباشر
-- -----------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a5');
create temp table draft as
select public.save_journal_entry(
  (select hotel_id from ctx), current_date, 'مسودة كاتب',
  jsonb_build_array(
    jsonb_build_object('account_id', (select id from acc where code = '1101'), 'debit', 50, 'department_id', null),
    jsonb_build_object('account_id', (select id from acc where code = '4101'), 'credit', 50)
  )
) as id;
grant select on draft to authenticated;
select pg_temp.expect_error($q$ update public.journal_entries set status = 'posted' where id = (select id from draft) $q$, 'Permission denied');
select pg_temp.expect_error($q$ select public.post_journal_entry((select id from draft)) $q$, 'Permission denied');
-- يستطيع تعديل مسودته وحذفها
update public.journal_entries set description = 'مسودة معدلة' where id = (select id from draft);

-- -----------------------------------------------------------------------------
-- 9) الفترات المقفلة
-- -----------------------------------------------------------------------------
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
update public.accounting_periods set status = 'closed'
 where hotel_id = (select hotel_id from ctx) and current_date between start_date and end_date;

-- المحاسب لا يملك استثناء الترحيل في فترة مقفلة
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a4');
select pg_temp.expect_error($q$ select public.post_journal_entry((select id from draft)) $q$, 'is closed');

-- المدير العام يملك الاستثناء
select pg_temp.act_as('00000000-0000-0000-0000-0000000000a1');
select public.post_journal_entry((select id from draft));

do $$
begin
  assert (select closed_by from public.accounting_periods
          where hotel_id = (select hotel_id from ctx) and current_date between start_date and end_date)
         = '00000000-0000-0000-0000-0000000000a1', 'closed_by recorded';
end $$;

-- -----------------------------------------------------------------------------
-- 10) بيانات ميزان المراجعة
-- -----------------------------------------------------------------------------
do $$
declare
  h uuid := (select hotel_id from ctx);
  fy date := (select start_date from public.fiscal_years where hotel_id = h);
  v_debit numeric; v_credit numeric;
begin
  select sum(period_debit), sum(period_credit) into v_debit, v_credit
  from public.gl_account_activity(h, fy, fy, current_date);
  assert v_debit = v_credit, 'trial balance totals equal';
  assert (select period_debit - period_credit from public.gl_account_activity(h, fy, fy, current_date)
          where account_id = (select id from acc where code = '1103')) = 333.33 * 3.7512345678,
         'bank balance after capital reversal = fx deposit only';
end $$;

-- -----------------------------------------------------------------------------
-- 11) سجل التدقيق للإضافة فقط
-- -----------------------------------------------------------------------------
select pg_temp.act_as(null);
select pg_temp.expect_error($q$ delete from public.audit_logs $q$, 'append-only');
do $$
begin
  assert (select count(*) from public.audit_logs where table_name = 'journal_entries' and action = 'UPDATE') > 0,
         'journal updates audited';
  assert (select actor_id from public.audit_logs where table_name = 'hotels' and action = 'INSERT' limit 1)
         = '00000000-0000-0000-0000-0000000000a1', 'audit actor recorded';
end $$;

\o
\echo '  ✓ general ledger tests passed'
