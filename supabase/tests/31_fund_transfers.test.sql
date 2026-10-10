-- =============================================================================
-- اختبارات سند التحويل وتبديل العملة: إيداع النقدية في البنك، صرف الدولار بربح أو خسارة فرق عملة،
-- التحقق من الطرق والمبالغ، الإلغاء بعكس القيد، والصلاحيات
-- =============================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\o /dev/null

-- الاختبارات السابقة قد تترك التسجيل بالدعوة فقط؛ مستخدمو الاختبار يُضافون مباشرة
delete from app.system_settings where key = 'signup_mode';

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000003101', 'gm31@hotel.test'),
  ('00000000-0000-0000-0000-000000003102', 'hk31@hotel.test');

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
create or replace function pg_temp.gl(p_hotel uuid, p_key text) returns numeric language sql as $$
  select coalesce(sum(l.debit - l.credit), 0) from public.journal_entry_lines l
  join public.journal_entries j on j.id = l.journal_entry_id and j.status = 'posted'
  join public.chart_of_accounts a on a.id = l.account_id
  where l.hotel_id = p_hotel and a.system_key = p_key;
$$;

select pg_temp.act_as('00000000-0000-0000-0000-000000003101');
create temp table h31 as select public.create_hotel('فندق التحويلات', 'SA', 'SAR') as id;
create temp table ids (k text primary key, v uuid);
grant all on h31, ids to authenticated;
select public.add_hotel_member((select id from h31), 'hk31@hotel.test', array[(select id from public.roles where is_system and code = 'housekeeping')]);
-- صندوق دولار على حساب مستقل تحت الصندوق
insert into public.chart_of_accounts (hotel_id, code, name_ar, account_type, account_subtype, is_postable, parent_id)
select h31.id, '1109', 'صندوق الدولار', 'asset', 'current_asset', true, (select parent_id from public.chart_of_accounts c where c.hotel_id = h31.id and system_key = 'cash') from h31;
insert into public.payment_methods (hotel_id, code, name_ar, kind, account_id, currency_code)
select id, 'USD', 'نقدًا دولار', 'cash', (select c.id from public.chart_of_accounts c where c.hotel_id = h31.id and code = '1109'), 'USD' from h31;
insert into ids select 'pm_' || lower(code), id from public.payment_methods where hotel_id = (select id from h31);
create or replace function pg_temp.pm(p_k text) returns uuid language sql as $$ select v from ids where k = 'pm_' || p_k $$;
create or replace function pg_temp.acc(p_code text) returns numeric language sql as $$
  select coalesce(sum(l.debit - l.credit), 0) from public.journal_entry_lines l join public.chart_of_accounts a on a.id = l.account_id
  where l.hotel_id = (select id from h31) and a.code = p_code;
$$;

-- إيداع 5000 من الصندوق في البنك
insert into ids select 't1', public.create_fund_transfer((select id from h31), pg_temp.pm('cash'), 5000, pg_temp.pm('bank'), 5000, 'إيداع إيراد اليوم');
select pg_temp.check(pg_temp.gl((select id from h31), 'bank') = 5000 and pg_temp.gl((select id from h31), 'cash') = -5000, 'cash moved to bank');
select pg_temp.check((select transfer_number from public.fund_transfers where id = (select v from ids where k = 't1')) like 'TR-%', 'numbered');
select pg_temp.check((select source::text from public.journal_entries where id = (select journal_entry_id from public.fund_transfers where id = (select v from ids where k = 't1'))) = 'fund_transfer', 'entry source');

-- التحقق
select pg_temp.expect_error($q$ select public.create_fund_transfer((select id from h31), pg_temp.pm('cash'), 100, pg_temp.pm('bank'), 90) $q$, 'must be equal');
select pg_temp.expect_error($q$ select public.create_fund_transfer((select id from h31), pg_temp.pm('cash'), 100, pg_temp.pm('cash'), 100) $q$, 'two different methods');
select pg_temp.expect_error($q$ select public.create_fund_transfer((select id from h31), pg_temp.pm('cash'), 100, pg_temp.pm('credit'), 100) $q$, 'cash, bank or wallet');
select pg_temp.expect_error($q$ select public.create_fund_transfer((select id from h31), pg_temp.pm('cash'), 0, pg_temp.pm('bank'), 0) $q$, 'valid amounts');
select pg_temp.expect_error($q$ select public.create_fund_transfer((select id from h31), pg_temp.pm('usd'), 100, pg_temp.pm('cash'), 375) $q$, 'No exchange rate');

-- بيع 100 دولار (السعر المسجل 3.75 = 375) واستلام 376 ريالًا: ربح فرق عملة 1
select public.set_exchange_rate((select id from h31), 'USD', 3.75);
insert into ids select 't2', public.create_fund_transfer((select id from h31), pg_temp.pm('usd'), 100, pg_temp.pm('cash'), 376);
select pg_temp.check(pg_temp.acc('1109') = -375, 'USD box credited at book rate');
select pg_temp.check(pg_temp.gl((select id from h31), 'fx_gain') = -1, 'FX gain 1');
select pg_temp.check((select difference from public.fund_transfers where id = (select v from ids where k = 't2')) = 1, 'difference stored');
-- شراء 200 دولار بـ 752 ريالًا (القيمة 750): خسارة 2
insert into ids select 't3', public.create_fund_transfer((select id from h31), pg_temp.pm('cash'), 752, pg_temp.pm('usd'), 200);
select pg_temp.check(pg_temp.acc('1109') = 375, 'USD box debited 750');
select pg_temp.check(pg_temp.gl((select id from h31), 'fx_loss') = 2, 'FX loss 2');

-- الإلغاء يعكس القيد مرة واحدة
select pg_temp.expect_error($q$ select public.void_fund_transfer((select v from ids where k = 't3'), '') $q$, 'reason is required');
select public.void_fund_transfer((select v from ids where k = 't3'), 'سعر خاطئ');
select pg_temp.expect_error($q$ select public.void_fund_transfer((select v from ids where k = 't3'), 'مرة ثانية') $q$, 'already cancelled');
select pg_temp.check(pg_temp.gl((select id from h31), 'fx_loss') = 0 and pg_temp.acc('1109') = -375, 'voided transfer reversed');

-- الصلاحيات والكتابة المباشرة
select pg_temp.act_as('00000000-0000-0000-0000-000000003102');
select pg_temp.expect_error($q$ select public.create_fund_transfer((select id from h31), pg_temp.pm('cash'), 10, pg_temp.pm('bank'), 10) $q$, 'Permission denied');
select pg_temp.check((select count(*) from public.fund_transfers where hotel_id = (select id from h31)) = 0, 'housekeeping cannot read transfers');
select pg_temp.act_as('00000000-0000-0000-0000-000000003101');
update public.fund_transfers set from_amount = 1 where hotel_id = (select id from h31);
select pg_temp.check((select from_amount from public.fund_transfers where id = (select v from ids where k = 't1')) = 5000, 'direct update has no effect');

select pg_temp.act_as(null);
\o
select 'fund transfers tests passed';
