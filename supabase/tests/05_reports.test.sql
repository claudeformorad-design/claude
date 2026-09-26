-- =============================================================================
-- اختبارات المرحلة 5: إحصاءات الغرف، التدفق النقدي، النقدية اليومية، الاتجاه الشهري
-- =============================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\o /dev/null

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000e1', 'gm5@hotel.test'),
  ('00000000-0000-0000-0000-0000000000e2', 'cashier5@hotel.test');

create or replace function pg_temp.act_as(p_user uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_user::text, ''), false);
  if p_user is null then reset role; else set role authenticated; end if;
end $$;

select pg_temp.act_as('00000000-0000-0000-0000-0000000000e1');
create temp table h5 as select public.create_hotel('فندق المرحلة 5', 'SA', 'SAR') as id;
create temp table ids (k text primary key, v uuid);
grant all on h5, ids to authenticated;
update public.hotels set total_rooms = 10 where id = (select id from h5);
insert into public.hotel_members (hotel_id, user_id) select id, '00000000-0000-0000-0000-0000000000e2' from h5;
insert into public.user_hotel_roles (hotel_id, user_id, role_id)
select (select id from h5), '00000000-0000-0000-0000-0000000000e2', id from public.roles where is_system and code = 'cashier';

insert into ids select lower(code), id from public.charge_codes where hotel_id = (select id from h5);
insert into ids select 'pm_' || lower(code), id from public.payment_methods where hotel_id = (select id from h5);
insert into ids select 'acc_' || code, id from public.chart_of_accounts where hotel_id = (select id from h5);

-- يومان: اليوم الأول 3 ليالٍ بـ 400، اليوم الثاني ليلتان بـ 500 ثم إلغاء ليلة وخصم 100
insert into ids select 'f', public.open_folio((select id from h5), 'مجموعة');
select public.post_folio_charge((select v from ids where k = 'f'), (select v from ids where k = 'room'), 400, 3, current_date - 1);
select public.post_folio_charge((select v from ids where k = 'f'), (select v from ids where k = 'room'), 500, 2, current_date);
insert into ids select 'c3', public.post_folio_charge((select v from ids where k = 'f'), (select v from ids where k = 'room'), 500, 1, current_date);
select public.void_folio_transaction((select v from ids where k = 'c3'), 'ليلة مكررة', current_date);
select public.post_folio_allowance((select v from ids where k = 'f'),
  (select id from public.folio_transactions where folio_id = (select v from ids where k = 'f') and quantity = 2), 100, 'خصم', current_date);
select public.post_folio_charge((select v from ids where k = 'f'), (select v from ids where k = 'food'), 300, 1, current_date);
select public.post_folio_payment((select v from ids where k = 'f'), (select v from ids where k = 'pm_cash'), 1000, current_date);
select public.post_folio_payment((select v from ids where k = 'f'), (select v from ids where k = 'pm_card'), 500, current_date);

do $$
declare h uuid := (select id from h5);
begin
  assert (select room_nights from public.room_statistics(h, current_date - 1, current_date) where business_date = current_date - 1) = 3, 'day 1 nights';
  assert (select room_nights from public.room_statistics(h, current_date - 1, current_date) where business_date = current_date) = 2, 'day 2 nights net of void';
  assert (select room_revenue from public.room_statistics(h, current_date - 1, current_date) where business_date = current_date) = 900, 'day 2 revenue net of allowance';
  assert (select sum(rooms_available) from public.room_statistics(h, current_date - 1, current_date)) = 20, 'available room nights';
end $$;

-- رأس مال نقدًا + شراء أصل من البنك + سداد رواتب ⇒ تصنيف التدفقات
select public.save_journal_entry((select id from h5), current_date, 'رأس مال',
  jsonb_build_array(jsonb_build_object('account_id', (select v from ids where k = 'acc_1103'), 'debit', 50000),
                    jsonb_build_object('account_id', (select v from ids where k = 'acc_3101'), 'credit', 50000)), null, null, 1, null, true);
select public.register_fixed_asset((select id from h5), 'سيارة', 'سيارات', (select v from ids where k = 'acc_1204'), 20000, 60, current_date,
  0, null, null, (select v from ids where k = 'acc_1103'));
select public.create_payment_voucher((select id from h5), 'disbursement', 'account', (select v from ids where k = 'pm_bank'), 3000,
  'كهرباء', current_date, p_counter_account_id => (select v from ids where k = 'acc_5204'));

do $$
declare h uuid := (select id from h5);
begin
  assert (select sum(amount) from public.cash_flow_lines(h, current_date - 1, current_date) where activity = 'financing') = 50000, 'financing';
  assert (select sum(amount) from public.cash_flow_lines(h, current_date - 1, current_date) where activity = 'investing') = -20000, 'investing';
  -- التشغيلي = دفعة نقدية من الفوليو 1000 − كهرباء 3000 (البطاقة في حساب تحصيل منفصل)
  assert (select sum(amount) from public.cash_flow_lines(h, current_date - 1, current_date) where activity = 'operating') = -2000, 'operating';
  -- التدفقات = تغير النقد حرفيًا
  assert (select sum(amount) from public.cash_flow_lines(h, current_date - 1, current_date))
         = public.cash_balance(h, current_date) - public.cash_balance(h, current_date - 2), 'flows equal cash change';
  assert (select receipts from public.daily_cash_report(h, current_date) where source = 'folio' and payment_method_id = (select v from ids where k = 'pm_cash')) = 1000, 'daily cash';
  assert (select payments from public.daily_cash_report(h, current_date) where source = 'voucher') = 3000, 'daily disbursements';
  assert (select revenue from public.monthly_pnl(h, current_date - 1, current_date) limit 1) > 0, 'monthly pnl';
end $$;

-- الكاشير يرى النقدية اليومية فقط وليس القوائم المالية
select pg_temp.act_as('00000000-0000-0000-0000-0000000000e2');
do $$
begin
  assert (select count(*) from public.daily_cash_report((select id from h5), current_date)) > 0, 'cashier sees daily cash';
  begin
    perform public.monthly_pnl((select id from h5), current_date, current_date);
    raise exception 'cashier should not see P&L';
  exception when others then
    if sqlerrm not like 'Permission denied%' then raise; end if;
  end;
end $$;


-- ثابت عام: كل حسابات المراقبة تطابق دفاترها الفرعية وميزان المراجعة متوازن لكل فندق في هذا الاختبار
select pg_temp.act_as(null);
do $$
declare r record;
begin
  for r in select h.id, h.name_ar, x.* from public.hotels h cross join lateral public.ledger_reconciliation(h.id) x loop
    assert r.difference = 0, format('reconciliation %s (%s): gl %s, subledger %s, reconciling %s',
      r.control, r.name_ar, r.gl_balance, r.subledger_balance, r.reconciling_items);
  end loop;
  -- أوصاف القيود والحركات الآلية عربية فقط
  assert not exists (select 1 from public.journal_entries where description ~ '[ء-ي] / [A-Z][a-z]+')
     and not exists (select 1 from public.folio_transactions where description ~ '[ء-ي] / [A-Z][a-z]+'),
    'system-generated descriptions are Arabic only';
end $$;

\o
\echo '  ✓ room statistics, cash flow, daily cash and trend tests passed'
