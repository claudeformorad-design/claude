-- =============================================================================
-- اختبارات القيود الدورية: الحفظ والتحقق، الترحيل حتى اليوم مع اللحاق بالفائت، عدد المرات،
-- نهاية الشهر بلا انزياح، الإيقاف، والصلاحيات
-- =============================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\o /dev/null

-- الاختبارات السابقة قد تترك التسجيل بالدعوة فقط؛ مستخدمو الاختبار يُضافون مباشرة
delete from app.system_settings where key = 'signup_mode';

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000002501', 'gm25@hotel.test'),
  ('00000000-0000-0000-0000-000000002502', 'aud25@hotel.test');

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

select pg_temp.act_as('00000000-0000-0000-0000-000000002501');
create temp table h25 as select public.create_hotel('فندق الدوري', 'SA', 'SAR') as id;
create temp table ids (k text primary key, v uuid);
grant all on h25, ids to authenticated;
create or replace function pg_temp.acc(p_code text) returns uuid language sql as $$
  select id from public.chart_of_accounts where hotel_id = (select id from h25) and code = p_code;
$$;
-- سنة سابقة مفتوحة حتى لا يعتمد الاختبار على شهر تشغيله
select public.create_fiscal_year((select id from h25), (date_trunc('year', current_date) - interval '1 year')::date);
select public.add_hotel_member((select id from h25), 'aud25@hotel.test', array[(select id from public.roles where is_system and code = 'auditor')]);

-- غير متوازن، حساب رئيسي، حساب مراقبة: كلها مرفوضة
select pg_temp.expect_error($q$ select public.save_recurring_entry((select id from h25), null, 'x', 'x',
  jsonb_build_array(jsonb_build_object('account_id', pg_temp.acc('5301'), 'debit', 100), jsonb_build_object('account_id', pg_temp.acc('1101'), 'credit', 90)),
  'monthly', current_date) $q$, 'not balanced');
select pg_temp.expect_error($q$ select public.save_recurring_entry((select id from h25), null, 'x', 'x',
  jsonb_build_array(jsonb_build_object('account_id', pg_temp.acc('53'), 'debit', 100), jsonb_build_object('account_id', pg_temp.acc('1101'), 'credit', 100)),
  'monthly', current_date) $q$, 'not postable');
select pg_temp.expect_error($q$ select public.save_recurring_entry((select id from h25), null, 'x', 'x',
  jsonb_build_array(jsonb_build_object('account_id', pg_temp.acc('5301'), 'debit', 100), jsonb_build_object('account_id', pg_temp.acc('1110'), 'credit', 100)),
  'monthly', current_date) $q$, 'control account');

-- إيجار شهري بدأ قبل شهرين: ترحيل يلحق ثلاثة أشهر (قبل شهرين، الشهر الماضي، هذا الشهر)
insert into ids select 'rent', public.save_recurring_entry((select id from h25), null, 'الإيجار', 'إيجار المبنى',
  jsonb_build_array(jsonb_build_object('account_id', pg_temp.acc('5301'), 'debit', 5000), jsonb_build_object('account_id', pg_temp.acc('1103'), 'credit', 5000)),
  'monthly', (date_trunc('month', current_date) - interval '2 month')::date);
-- مصروف مقدم يُوزّع 3 مرات فقط بدأ قبل 5 أشهر
insert into ids select 'prepaid', public.save_recurring_entry((select id from h25), null, 'التأمين', 'توزيع التأمين المدفوع مقدمًا',
  jsonb_build_array(jsonb_build_object('account_id', pg_temp.acc('5302'), 'debit', 1000), jsonb_build_object('account_id', pg_temp.acc('1130'), 'credit', 1000)),
  'monthly', (date_trunc('month', current_date) - interval '5 month')::date, null, 3);
-- نموذج مستقبلي لا يُرحَّل الآن
insert into ids select 'future', public.save_recurring_entry((select id from h25), null, 'مستقبلي', 'مستقبلي',
  jsonb_build_array(jsonb_build_object('account_id', pg_temp.acc('5301'), 'debit', 1), jsonb_build_object('account_id', pg_temp.acc('1103'), 'credit', 1)),
  'yearly', (current_date + 10));

select pg_temp.check((select due_count from public.recurring_entries_due((select id from h25)) where id = (select v from ids where k = 'rent')) = 3, 'rent due 3');
select pg_temp.check((select due_count from public.recurring_entries_due((select id from h25)) where id = (select v from ids where k = 'prepaid')) = 3, 'prepaid due 3');

-- المدقق لا يرحّل
select pg_temp.act_as('00000000-0000-0000-0000-000000002502');
select pg_temp.expect_error($q$ select public.post_due_recurring_entries((select id from h25)) $q$, 'Permission denied');
select pg_temp.act_as('00000000-0000-0000-0000-000000002501');

select pg_temp.check(public.post_due_recurring_entries((select id from h25)) = 6, 'six entries posted');
select pg_temp.check(public.post_due_recurring_entries((select id from h25)) = 0, 'second run posts nothing');
select pg_temp.check((select count(*) from public.journal_entries where hotel_id = (select id from h25) and status = 'posted' and reference like 'REC %') = 6, 'six posted entries');
select pg_temp.check((select posted_count from public.recurring_entries where id = (select v from ids where k = 'prepaid')) = 3, 'prepaid stops at 3');
select pg_temp.check((select coalesce(sum(l.debit), 0) from public.journal_entry_lines l join public.journal_entries j on j.id = l.journal_entry_id
  where j.hotel_id = (select id from h25) and l.account_id = pg_temp.acc('5302')) = 3000, 'insurance expense 3000');

-- لا انزياح بعد نهاية الشهر: 31 يناير ثم 28 فبراير ثم 31 مارس
select pg_temp.check(app.recurring_date('2026-01-31', 'monthly', 1) = '2026-02-28' and app.recurring_date('2026-01-31', 'monthly', 2) = '2026-03-31', 'month end anchor');

-- الإيقاف والحذف
select public.set_recurring_entry_active((select v from ids where k = 'rent'), false);
select pg_temp.check((select not is_active from public.recurring_entries where id = (select v from ids where k = 'rent')), 'paused');
select public.delete_recurring_entry((select v from ids where k = 'future'));
select pg_temp.check((select count(*) from public.recurring_entries where hotel_id = (select id from h25)) = 2, 'deleted');

-- من قيد مرحّل
insert into ids select 'je', public.save_journal_entry((select id from h25), current_date, 'اشتراك الإنترنت',
  jsonb_build_array(jsonb_build_object('account_id', pg_temp.acc('5206'), 'debit', 300), jsonb_build_object('account_id', pg_temp.acc('1103'), 'credit', 300)), null, null, 1, null, true);
insert into ids select 'from_je', public.recurring_from_entry((select v from ids where k = 'je'), 'الإنترنت', 'monthly', (current_date + 30), null, 12);
select pg_temp.check((select jsonb_array_length(lines) from public.recurring_entries where id = (select v from ids where k = 'from_je')) = 2, 'copied lines');

select pg_temp.act_as(null);
\o
select 'recurring entries tests passed';
