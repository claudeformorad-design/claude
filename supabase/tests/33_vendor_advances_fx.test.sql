-- =============================================================================
-- اختبارات عربون الموردين وإعادة تقييم العملات وميزان المراجعة بالعملات
-- =============================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\o /dev/null

delete from app.system_settings where key = 'signup_mode';

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000003301', 'gm33@hotel.test'),
  ('00000000-0000-0000-0000-000000003302', 'hk33@hotel.test');

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

select pg_temp.act_as('00000000-0000-0000-0000-000000003301');
create temp table h33 as select public.create_hotel('فندق العربون', 'SA', 'SAR') as id;
create temp table ids (k text primary key, v uuid);
grant all on h33, ids to authenticated;
select public.add_hotel_member((select id from h33), 'hk33@hotel.test', array[(select id from public.roles where is_system and code = 'housekeeping')]);
create or replace function pg_temp.v(p_k text) returns uuid language sql as $$ select v from ids where k = p_k $$;
create or replace function pg_temp.acc(p_code text) returns uuid language sql as $$
  select id from public.chart_of_accounts where hotel_id = (select id from h33) and code = p_code;
$$;
insert into ids select 'pm_' || lower(code), id from public.payment_methods where hotel_id = (select id from h33);
insert into public.vendors (hotel_id, code, name_ar) select id, 'V1', 'مورد الأثاث' from h33;
insert into public.vendors (hotel_id, code, name_ar) select id, 'V2', 'مورد آخر' from h33;
insert into ids select 'v_' || lower(code), id from public.vendors where hotel_id = (select id from h33);

-- عربون 1000 للمورد قبل الفاتورة
select pg_temp.expect_error($q$ select public.pay_vendor_advance((select id from h33), pg_temp.v('v_v1'), pg_temp.v('pm_bank'), 0) $q$, 'valid advance amount');
insert into ids select 'adv_pay', public.pay_vendor_advance((select id from h33), pg_temp.v('v_v1'), pg_temp.v('pm_bank'), 1000, p_reference => 'TRX-9');
insert into ids select 'adv', id from public.vendor_advances where payment_id = pg_temp.v('adv_pay');
select pg_temp.check(pg_temp.gl((select id from h33), 'vendor_advances') = 1000, 'advance asset 1000');
select pg_temp.check(pg_temp.gl((select id from h33), 'bank') = -1000, 'bank paid');
select pg_temp.check(pg_temp.gl((select id from h33), 'ap_control') = 0, 'no AP yet');

-- الفاتورة 1500 ثم تطبيق العربون عليها
insert into ids select 'bill', public.create_vendor_bill((select id from h33), pg_temp.v('v_v1'),
  jsonb_build_array(jsonb_build_object('description', 'كراسي', 'account_id', pg_temp.acc('5208'), 'quantity', 1, 'unit_price', 1500)));
insert into ids select 'bill2', public.create_vendor_bill((select id from h33), pg_temp.v('v_v2'),
  jsonb_build_array(jsonb_build_object('description', 'أخرى', 'account_id', pg_temp.acc('5208'), 'quantity', 1, 'unit_price', 100)));
select pg_temp.expect_error($q$ select public.apply_vendor_advance(pg_temp.v('adv'), pg_temp.v('bill2'), 100) $q$, 'Bill not found for this vendor');
select pg_temp.expect_error($q$ select public.apply_vendor_advance(pg_temp.v('adv'), pg_temp.v('bill'), 1200) $q$, 'within the advance balance');
select public.apply_vendor_advance(pg_temp.v('adv'), pg_temp.v('bill'), 600);
select pg_temp.check((select amount_paid from public.vendor_bills where id = pg_temp.v('bill')) = 600, 'bill reduced by 600');
select pg_temp.check((select status from public.vendor_bills where id = pg_temp.v('bill')) = 'partially_paid', 'bill partially settled');
select pg_temp.check(pg_temp.gl((select id from h33), 'vendor_advances') = 400, 'advance left 400');
select pg_temp.check(pg_temp.gl((select id from h33), 'ap_control') = -1000, 'AP 1000 left (900 + other vendor 100)');
-- لا يُلغى سند عربون مطبَّق جزئيًا
select pg_temp.expect_error($q$ select public.void_payment_voucher(pg_temp.v('adv_pay'), 'خطأ') $q$, 'already applied');
select public.apply_vendor_advance(pg_temp.v('adv'), pg_temp.v('bill'), 400);
select pg_temp.check((select status from public.vendor_advances where id = pg_temp.v('adv')) = 'applied', 'advance fully applied');
select pg_temp.expect_error($q$ select public.apply_vendor_advance(pg_temp.v('adv'), pg_temp.v('bill'), 1) $q$, 'fully applied or cancelled');

-- عربون ثانٍ يُلغى قبل تطبيقه
insert into ids select 'adv2_pay', public.pay_vendor_advance((select id from h33), pg_temp.v('v_v2'), pg_temp.v('pm_cash'), 50);
select public.void_payment_voucher(pg_temp.v('adv2_pay'), 'تراجع');
select pg_temp.check((select status from public.vendor_advances where payment_id = pg_temp.v('adv2_pay')) = 'voided', 'unapplied advance voided');
select pg_temp.check(pg_temp.gl((select id from h33), 'vendor_advances') = 0, 'advance account clear');

-- إعادة تقييم: صندوق دولار على حساب خاص؛ 100 دولار دخلت بسعر 3.75 والسعر اليوم 3.80
insert into public.chart_of_accounts (hotel_id, code, name_ar, account_type, account_subtype, is_postable, parent_id)
select h33.id, '1109', 'صندوق الدولار', 'asset', 'current_asset', true, (select parent_id from public.chart_of_accounts c where c.hotel_id = h33.id and system_key = 'cash') from h33;
insert into public.payment_methods (hotel_id, code, name_ar, kind, account_id, currency_code)
select id, 'USD', 'نقدًا دولار', 'cash', pg_temp.acc('1109'), 'USD' from h33;
insert into public.payment_methods (hotel_id, code, name_ar, kind, account_id, currency_code)
select id, 'EUR', 'نقدًا يورو', 'cash', pg_temp.acc('1101'), 'EUR' from h33;
insert into ids select 'pm_usd', id from public.payment_methods where hotel_id = (select id from h33) and code = 'USD';
insert into ids select 'pm_eur', id from public.payment_methods where hotel_id = (select id from h33) and code = 'EUR';
select public.set_exchange_rate((select id from h33), 'USD', 3.75, current_date - 1);
select public.create_fund_transfer((select id from h33), pg_temp.v('pm_cash'), 375, pg_temp.v('pm_usd'), 100, null, current_date - 1);
select public.set_exchange_rate((select id from h33), 'USD', 3.80, current_date);
select public.set_exchange_rate((select id from h33), 'EUR', 4.10, current_date);

select pg_temp.check((select book_balance from public.fx_revaluation_preview((select id from h33)) where currency_code = 'USD') = 375, 'book 375');
select pg_temp.check((select shared from public.fx_revaluation_preview((select id from h33)) where currency_code = 'EUR'), 'euro shares the main cash account');
select pg_temp.expect_error($q$ select public.post_fx_revaluation((select id from h33), jsonb_build_array(jsonb_build_object('payment_method_id', pg_temp.v('pm_eur'), 'foreign_balance', 10))) $q$, 'shared with another currency');
select pg_temp.expect_error($q$ select public.post_fx_revaluation((select id from h33), '[]'::jsonb) $q$, 'at least one currency account');
insert into ids select 'reval', public.post_fx_revaluation((select id from h33), jsonb_build_array(jsonb_build_object('payment_method_id', pg_temp.v('pm_usd'), 'foreign_balance', 100)));
select pg_temp.check(pg_temp.gl((select id from h33), 'fx_gain') = -5, 'gain 5 (100 x 0.05)');
select pg_temp.check((select coalesce(sum(l.debit - l.credit), 0) from public.journal_entry_lines l where l.account_id = pg_temp.acc('1109')) = 380, 'USD box at 380');
select pg_temp.check((select source::text from public.journal_entries where id = (select journal_entry_id from public.fx_revaluations where id = pg_temp.v('reval'))) = 'fx_revaluation', 'entry source');
select pg_temp.expect_error($q$ select public.post_fx_revaluation((select id from h33), jsonb_build_array(jsonb_build_object('payment_method_id', pg_temp.v('pm_usd'), 'foreign_balance', 100))) $q$, 'nothing to post');
-- رصيد فعلي أقل (عجز 10 دولار): خسارة 38
select public.post_fx_revaluation((select id from h33), jsonb_build_array(jsonb_build_object('payment_method_id', pg_temp.v('pm_usd'), 'foreign_balance', 90)));
select pg_temp.check(pg_temp.gl((select id from h33), 'fx_loss') = 38, 'loss 38');

-- ميزان المراجعة بالعملات: قيد يدوي بالدولار
select public.save_journal_entry((select id from h33), current_date, 'مصروف بالدولار',
  jsonb_build_array(jsonb_build_object('account_id', pg_temp.acc('5208'), 'debit', 20),
                    jsonb_build_object('account_id', pg_temp.acc('1109'), 'credit', 20)), null, 'USD', 3.80, null, true);
select pg_temp.check((select debit from public.currency_trial_balance((select id from h33), current_date - 30, current_date) where account_id = pg_temp.acc('5208')) = 20, 'USD 20 movement');
select pg_temp.check((select base_debit from public.currency_trial_balance((select id from h33), current_date - 30, current_date) where account_id = pg_temp.acc('5208')) = 76, 'base 76');

-- الصلاحيات
select pg_temp.act_as('00000000-0000-0000-0000-000000003302');
select pg_temp.expect_error($q$ select public.pay_vendor_advance((select id from h33), (select v from ids where k = 'v_v1'), (select v from ids where k = 'pm_bank'), 10) $q$, 'Permission denied');
select pg_temp.expect_error($q$ select * from public.fx_revaluation_preview((select id from h33)) $q$, 'Permission denied');
select pg_temp.act_as(null);

-- الدفاتر الفرعية تطابق الأستاذ
do $$
declare r record;
begin
  for r in select x.* from public.ledger_reconciliation((select id from h33)) x loop
    if r.difference <> 0 then raise exception 'Reconciliation difference for %: %', r.control, r.difference; end if;
  end loop;
end $$;

\o
select 'vendor advances and fx tests passed';
