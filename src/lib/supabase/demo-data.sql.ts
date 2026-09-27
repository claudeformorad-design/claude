/**
 * بيانات تجريبية مؤقتة لوضع التجربة (6 أشهر حتى اليوم) — تمر كلها عبر دوال النظام الحقيقية
 * (فتح فوليو، رسوم، دفعات، مغادرة وفوترة، فواتير آجلة، سندات قبض وصرف، فواتير موردين، رواتب)
 * بصلاحيات المستخدم نفسه، فتبقى كل الأرصدة مطابقة لدفاترها الفرعية وميزان المراجعة متوازنًا.
 * القيم عشوائية لكن ثابتة (setseed) حتى تتكرر نفس الصورة في كل مرة.
 * وإن كان قسم إدارة الفندق مفعّلًا: غرف ووحدات بالساعة وأسعار ومواسم وحجوزات الأسابيع القادمة.
 */
export const DEMO_DATA_SQL = /* sql */ `
do $demo$
declare
  h        uuid := current_setting('demo.hotel_id')::uuid;
  v_today  date := app.today_for_hotel(current_setting('demo.hotel_id')::uuid);
  v_first  date := (date_trunc('month', app.today_for_hotel(current_setting('demo.hotel_id')::uuid)) - interval '5 months')::date;
  fy_month int;
  m_start  date; m_end date; m_idx int := 0; d date;
  c_room uuid; c_food uuid; c_bev uuid; c_spa uuid; c_laundry uuid; c_events uuid; c_minibar uuid; c_parking uuid;
  pm_cash uuid; pm_card uuid; pm_bank uuid;
  a_capital uuid; a_card uuid; a_salaries uuid;
  a_food_cost uuid; a_bev_cost uuid; a_elec uuid; a_water uuid; a_net uuid; a_clean uuid; a_maint uuid; a_ota uuid; a_rent uuid;
  dept_rooms uuid; dept_fnb uuid; dept_hk uuid; dept_admin uuid; dept_maint uuid; dept_spa uuid;
  v_food_vendor uuid; v_util_vendor uuid; v_serv_vendor uuid;
  v_cust uuid[] := '{}'; v_c uuid;
  v_folio uuid; v_rooms int; v_nights int; v_arr date; v_dep date; v_rate numeric; v_bal numeric; v_guests int;
  v_bill uuid; v_inv uuid; v_amt numeric; v_room_rev numeric; v_fnb_rev numeric; v_card_total numeric;
  i int; k int;
  guest_names text[] := array['محمد العتيبي','سارة القحطاني','عبدالله الشمري','نورة الدوسري','خالد الحربي','ريم الزهراني','فهد المطيري',
    'هيفاء الغامدي','سلطان العنزي','لمى السبيعي','ماجد الرشيدي','أمل الشهري','تركي البقمي','جود العمري','ناصر الجهني','دانة الخالدي'];
  groups text[] := array['وفد شركة الأفق','مجموعة رحلات الواحة','وفد مؤتمر التقنية','فريق نادي النصر','مجموعة سياحية أوروبية','وفد وزارة الصحة'];
  base_occ numeric[] := array[0.46, 0.52, 0.49, 0.58, 0.63, 0.70];
begin
  perform setseed(0.42);

  select coalesce(fiscal_year_start_month, 1) into fy_month from public.hotels where id = h;
  update public.hotels set total_rooms = 40 where id = h and coalesce(total_rooms, 0) = 0;

  -- فترات محاسبية لكل الأشهر الستة (سنة مالية سابقة عند الحاجة)
  d := v_first;
  while d <= v_today loop
    if not exists (select 1 from public.accounting_periods where hotel_id = h and d between start_date and end_date) then
      perform public.create_fiscal_year(h, make_date(case when extract(month from d)::int >= fy_month then extract(year from d)::int
                                                          else extract(year from d)::int - 1 end, fy_month, 1));
    end if;
    d := (d + interval '1 month')::date;
  end loop;

  select id into c_room from public.charge_codes where hotel_id = h and code = 'ROOM';
  select id into c_food from public.charge_codes where hotel_id = h and code = 'FOOD';
  select id into c_bev from public.charge_codes where hotel_id = h and code = 'BEV';
  select id into c_spa from public.charge_codes where hotel_id = h and code = 'SPA';
  select id into c_laundry from public.charge_codes where hotel_id = h and code = 'LAUNDRY';
  select id into c_events from public.charge_codes where hotel_id = h and code = 'EVENTS';
  select id into c_minibar from public.charge_codes where hotel_id = h and code = 'MINIBAR';
  select id into c_parking from public.charge_codes where hotel_id = h and code = 'PARKING';
  select id into pm_cash from public.payment_methods where hotel_id = h and code = 'CASH';
  select id into pm_card from public.payment_methods where hotel_id = h and code = 'CARD';
  select id into pm_bank from public.payment_methods where hotel_id = h and code = 'BANK';
  select id into a_capital from public.chart_of_accounts where hotel_id = h and code = '3101';
  select id into a_card from public.chart_of_accounts where hotel_id = h and code = '1104';
  select id into a_salaries from public.chart_of_accounts where hotel_id = h and code = '2103';
  select id into a_food_cost from public.chart_of_accounts where hotel_id = h and code = '5101';
  select id into a_bev_cost from public.chart_of_accounts where hotel_id = h and code = '5102';
  select id into a_elec from public.chart_of_accounts where hotel_id = h and code = '5204';
  select id into a_water from public.chart_of_accounts where hotel_id = h and code = '5205';
  select id into a_net from public.chart_of_accounts where hotel_id = h and code = '5206';
  select id into a_clean from public.chart_of_accounts where hotel_id = h and code = '5207';
  select id into a_maint from public.chart_of_accounts where hotel_id = h and code = '5208';
  select id into a_ota from public.chart_of_accounts where hotel_id = h and code = '5209';
  select id into a_rent from public.chart_of_accounts where hotel_id = h and code = '5301';
  select id into dept_rooms from public.departments where hotel_id = h and code = 'ROOMS';
  select id into dept_fnb from public.departments where hotel_id = h and code = 'FNB';
  select id into dept_hk from public.departments where hotel_id = h and code = 'HK';
  select id into dept_admin from public.departments where hotel_id = h and code = 'ADMIN';
  select id into dept_maint from public.departments where hotel_id = h and code = 'MAINT';
  select id into dept_spa from public.departments where hotel_id = h and code = 'SPA';

  -- موردون وعملاء آجل (بأكواد مميزة حتى لا تتعارض مع بيانات المستخدم)
  insert into public.vendors (hotel_id, code, name_ar, payment_terms_days) values (h, 'DEMO-FOOD', 'شركة المراعي للأغذية', 30) returning id into v_food_vendor;
  insert into public.vendors (hotel_id, code, name_ar, payment_terms_days) values (h, 'DEMO-UTIL', 'الشركة السعودية للكهرباء', 15) returning id into v_util_vendor;
  insert into public.vendors (hotel_id, code, name_ar, payment_terms_days) values (h, 'DEMO-SERV', 'مؤسسة الخدمات الفنية', 30) returning id into v_serv_vendor;
  for i in 1..3 loop
    insert into public.customers (hotel_id, code, name_ar, customer_type, allow_credit, credit_limit, payment_terms_days)
    values (h, 'DEMO-C' || i, (array['شركة أرامكو للخدمات','البنك الأهلي','شركة الاتصالات'])[i], 'company', true, 500000, 30)
    returning id into v_c;
    v_cust := v_cust || v_c;
  end loop;

  -- رأس المال الافتتاحي في البنك
  perform public.create_payment_voucher(h, 'receipt', 'account', pm_bank, 250000, 'إيداع رأس المال', v_first,
    p_counter_account_id => a_capital, p_party_name => 'الشركاء');

  m_start := v_first;
  while m_start <= v_today loop
    m_idx := m_idx + 1;
    m_end := least((m_start + interval '1 month - 1 day')::date, v_today);
    v_room_rev := 0; v_fnb_rev := 0; v_card_total := 0;

    -- ضيوف ومجموعات: ليالٍ مباعة ≈ الإشغال المستهدف × 40 غرفة × أيام الشهر
    k := greatest(1, round(base_occ[m_idx] * 40 * (m_end - m_start + 1) / 11)::int);
    for i in 1..k loop
      v_arr := m_start + floor(random()::numeric * greatest(1, (m_end - m_start - 1)))::int;
      v_nights := 1 + floor(random()::numeric * 4)::int;
      v_dep := least(v_arr + v_nights, v_today);
      v_nights := greatest(1, v_dep - v_arr);
      if random()::numeric < 0.22 then
        v_rooms := 6 + floor(random()::numeric * 10)::int;
        v_rate := 380 + floor(random()::numeric * 6) * 10;
        v_folio := public.open_folio(h, groups[1 + floor(random()::numeric * array_length(groups, 1))::int], 'guest', null, null, null, v_arr, v_dep);
      else
        v_rooms := 1;
        v_rate := 420 + floor(random()::numeric * 14) * 10;
        v_folio := public.open_folio(h, guest_names[1 + floor(random()::numeric * array_length(guest_names, 1))::int], 'guest', null,
          (100 + floor(random()::numeric * 40)::int + 1)::text, null, v_arr, v_dep);
      end if;
      v_guests := v_rooms * v_nights;
      perform public.post_folio_charge(v_folio, c_room, v_rate, v_guests, v_arr);
      v_room_rev := v_room_rev + v_rate * v_guests;
      v_amt := round((35 + random()::numeric * 55) * v_guests);
      perform public.post_folio_charge(v_folio, c_food, v_amt, 1, least(v_arr + 1, v_dep));
      v_fnb_rev := v_fnb_rev + v_amt;
      if random()::numeric < 0.6 then
        v_amt := round((12 + random()::numeric * 25) * v_guests);
        perform public.post_folio_charge(v_folio, c_bev, v_amt, 1, least(v_arr + 1, v_dep));
        v_fnb_rev := v_fnb_rev + v_amt;
      end if;
      if random()::numeric < 0.25 then perform public.post_folio_charge(v_folio, c_spa, 250 + floor(random()::numeric * 5) * 50, 1, v_arr); end if;
      if random()::numeric < 0.35 then perform public.post_folio_charge(v_folio, c_laundry, 40 + floor(random()::numeric * 6) * 15, 1, v_arr); end if;
      if random()::numeric < 0.30 then perform public.post_folio_charge(v_folio, c_minibar, 25 + floor(random()::numeric * 6) * 10, 1, v_arr); end if;
      if random()::numeric < 0.20 then perform public.post_folio_charge(v_folio, c_parking, 30, v_nights, v_arr); end if;

      -- المقيمون حاليًا يبقون بفوليو مفتوح؛ الباقون يسددون ويغادرون (فاتورة ضريبية)
      if v_dep >= v_today and random()::numeric < 0.8 then
        if random()::numeric < 0.5 then
          select balance into v_bal from public.folio_balances where folio_id = v_folio;
          perform public.post_folio_payment(v_folio, pm_card, round(v_bal * 0.4, 2), v_arr);
          v_card_total := v_card_total + round(v_bal * 0.4, 2);
        end if;
        continue;
      end if;
      select balance into v_bal from public.folio_balances where folio_id = v_folio;
      if random()::numeric < 0.65 then
        perform public.post_folio_payment(v_folio, pm_card, v_bal, v_dep);
        v_card_total := v_card_total + v_bal;
      elsif random()::numeric < 0.5 then
        perform public.post_folio_payment(v_folio, pm_cash, v_bal, v_dep);
      else
        perform public.post_folio_payment(v_folio, pm_bank, v_bal, v_dep);
      end if;
      perform public.checkout_folio(v_folio, v_dep);
    end loop;

    -- تسوية مدفوعات البطاقات إلى البنك
    if v_card_total > 0 then
      perform public.create_payment_voucher(h, 'receipt', 'account', pm_bank, round(v_card_total * 0.97, 2), 'تسوية مدفوعات البطاقات', m_end,
        p_counter_account_id => a_card, p_party_name => 'بنك التسوية');
    end if;

    -- مناسبات وقاعات: فواتير آجلة لعملاء الشركات (بعضها يُحصَّل)
    for i in 1..(1 + floor(random()::numeric * 2)::int) loop
      v_c := v_cust[1 + floor(random()::numeric * 3)::int];
      v_inv := public.create_direct_invoice(h, v_c,
        jsonb_build_array(jsonb_build_object('charge_code_id', c_events, 'unit_price', 2500 + floor(random()::numeric * 10) * 500, 'quantity', 1 + floor(random()::numeric * 2)::int,
          'description', 'حجز قاعة ومؤتمرات')),
        m_start + floor(random()::numeric * greatest(1, m_end - m_start))::int);
      -- أعمار ذمم واقعية: أشهر محصّلة، وشهر محصّل جزئيًا، وأحدث شهرين قائمان
      if m_idx in (1, 2, 4) or (m_idx = 3 and i = 1) then
        select amount_due - amount_paid into v_amt from public.invoices where id = v_inv;
        if m_idx = 3 then v_amt := round(v_amt / 2, 2); end if;
        perform public.create_payment_voucher(h, 'receipt', 'customer', pm_bank, v_amt, 'تحصيل فاتورة', least(m_end + 20, v_today),
          p_customer_id => v_c, p_allocations => jsonb_build_array(jsonb_build_object('invoice_id', v_inv, 'amount', v_amt)));
      end if;
    end loop;

    -- مشتريات ومصروفات الشهر
    v_bill := public.create_vendor_bill(h, v_food_vendor, jsonb_build_array(
      jsonb_build_object('description', 'مواد غذائية', 'account_id', a_food_cost, 'department_id', dept_fnb, 'quantity', 1, 'unit_price', round(v_fnb_rev * 0.30)),
      jsonb_build_object('description', 'مشروبات', 'account_id', a_bev_cost, 'department_id', dept_fnb, 'quantity', 1, 'unit_price', round(v_fnb_rev * 0.06))),
      p_bill_date => m_start + 3, p_vendor_invoice_no => 'MR-' || to_char(m_start, 'YYMM'));
    if m_end < date_trunc('month', v_today)::date then
      perform public.pay_vendor(h, v_food_vendor, pm_bank, jsonb_build_array(jsonb_build_object('bill_id', v_bill,
        'amount', (select total from public.vendor_bills where id = v_bill))), least(m_end + 25, v_today));
    end if;
    v_bill := public.create_vendor_bill(h, v_util_vendor, jsonb_build_array(
      jsonb_build_object('description', 'كهرباء', 'account_id', a_elec, 'department_id', dept_admin, 'quantity', 1, 'unit_price', 9000 + round(random()::numeric * 4000)),
      jsonb_build_object('description', 'مياه', 'account_id', a_water, 'department_id', dept_admin, 'quantity', 1, 'unit_price', 1800 + round(random()::numeric * 900))),
      p_bill_date => m_start + 5, p_vendor_invoice_no => 'SEC-' || to_char(m_start, 'YYMM'));
    if m_end < date_trunc('month', v_today)::date then
      perform public.pay_vendor(h, v_util_vendor, pm_bank, jsonb_build_array(jsonb_build_object('bill_id', v_bill,
        'amount', (select total from public.vendor_bills where id = v_bill))), least(m_start + 18, v_today));
    end if;
    v_bill := public.create_vendor_bill(h, v_serv_vendor, jsonb_build_array(
      jsonb_build_object('description', 'صيانة دورية', 'account_id', a_maint, 'department_id', dept_maint, 'quantity', 1, 'unit_price', 3500 + round(random()::numeric * 3000)),
      jsonb_build_object('description', 'مستلزمات نظافة', 'account_id', a_clean, 'department_id', dept_hk, 'quantity', 1, 'unit_price', 2200 + round(random()::numeric * 1200)),
      jsonb_build_object('description', 'إنترنت واتصالات', 'account_id', a_net, 'department_id', dept_admin, 'quantity', 1, 'unit_price', 1500),
      jsonb_build_object('description', 'عمولات حجز إلكتروني', 'account_id', a_ota, 'department_id', dept_rooms, 'quantity', 1, 'unit_price', round(v_room_rev * 0.08))),
      p_bill_date => m_start + 10, p_vendor_invoice_no => 'TS-' || to_char(m_start, 'YYMM'));
    if m_end < (date_trunc('month', v_today) - interval '1 month')::date then
      perform public.pay_vendor(h, v_serv_vendor, pm_bank, jsonb_build_array(jsonb_build_object('bill_id', v_bill,
        'amount', (select total from public.vendor_bills where id = v_bill))), least(m_end + 30, v_today));
    end if;
    perform public.create_payment_voucher(h, 'disbursement', 'account', pm_bank, 25000, 'إيجار المبنى', m_start,
      p_counter_account_id => a_rent, p_department_id => dept_admin, p_party_name => 'المالك');

    -- الرواتب (للأشهر المكتملة) وصرفها
    if m_end < date_trunc('month', v_today)::date then
      perform public.post_payroll(h, m_start, jsonb_build_array(
        jsonb_build_object('employee_name', 'فريق الاستقبال', 'department_id', dept_rooms, 'basic', 18000, 'allowances', 4500, 'deductions', 0, 'insurance_employee', 1620, 'insurance_employer', 2160),
        jsonb_build_object('employee_name', 'فريق المطعم', 'department_id', dept_fnb, 'basic', 22000, 'allowances', 5000, 'deductions', 0, 'insurance_employee', 1980, 'insurance_employer', 2640),
        jsonb_build_object('employee_name', 'الإشراف الداخلي', 'department_id', dept_hk, 'basic', 14000, 'allowances', 3000, 'deductions', 0, 'insurance_employee', 1260, 'insurance_employer', 1680),
        jsonb_build_object('employee_name', 'الإدارة', 'department_id', dept_admin, 'basic', 20000, 'allowances', 6000, 'deductions', 0, 'insurance_employee', 1800, 'insurance_employer', 2400),
        jsonb_build_object('employee_name', 'السبا', 'department_id', dept_spa, 'basic', 7000, 'allowances', 1500, 'deductions', 0, 'insurance_employee', 630, 'insurance_employer', 840)));
      perform public.create_payment_voucher(h, 'disbursement', 'account', pm_bank, 81000 + 20000 - 7290, 'صرف رواتب ' || to_char(m_start, 'YYYY-MM'),
        least(m_end + 2, v_today), p_counter_account_id => a_salaries, p_party_name => 'الموظفون');
    end if;

    m_start := (m_start + interval '1 month')::date;
  end loop;
end
$demo$;

-- =============================================================================
-- قسم إدارة الفندق (إن كان مفعّلًا): غرف وأنواع ووحدات بالساعة، مواسم وعروض،
-- وحجوزات الأسابيع القادمة عبر دوال الحجز الحقيقية (السعة والتداخل والأسعار تُفحص كالمعتاد)
-- =============================================================================
do $pms$
declare
  h        uuid := current_setting('demo.hotel_id')::uuid;
  v_today  date := app.today_for_hotel(current_setting('demo.hotel_id')::uuid);
  f1 uuid; f2 uuid; f3 uuid; f0 uuid;
  t_sgl uuid; t_dbl uuid; t_ste uuid; t_fam uuid; t_hall uuid; t_pool uuid;
  c_room uuid; c_events uuid; c_spa uuid; v_cust uuid;
  g uuid[] := '{}'; v_g uuid; v_t uuid; v_r uuid; v_room uuid; v_arr date; v_n int; i int; v_types uuid[];
  v_ts timestamp; v_name text; v_pm uuid;
  names text[] := array['محمد العتيبي','سارة القحطاني','عبدالله الشمري','نورة الدوسري','خالد الحربي','ريم الزهراني','فهد المطيري',
    'هيفاء الغامدي','سلطان العنزي','لمى السبيعي','ماجد الرشيدي','أمل الشهري','تركي البقمي','جود العمري','ناصر الجهني','دانة الخالدي',
    'أحمد باوزير','مريم الحضرمي','يوسف العولقي','هدى المقطري'];
begin
  if not coalesce((select 'pms' = any (enabled_modules) from public.hotels where id = h), false)
     or exists (select 1 from public.room_types where hotel_id = h) then
    return;
  end if;
  perform setseed(0.24);
  select id into c_room from public.charge_codes where hotel_id = h and code = 'ROOM';
  select id into c_events from public.charge_codes where hotel_id = h and code = 'EVENTS';
  select id into c_spa from public.charge_codes where hotel_id = h and code = 'SPA';

  insert into public.floors (hotel_id, name, sort_order) values (h, 'الطابق الأرضي', 0) returning id into f0;
  insert into public.floors (hotel_id, name, sort_order) values (h, 'الطابق الأول', 1) returning id into f1;
  insert into public.floors (hotel_id, name, sort_order) values (h, 'الطابق الثاني', 2) returning id into f2;
  insert into public.floors (hotel_id, name, sort_order) values (h, 'الطابق الثالث', 3) returning id into f3;

  insert into public.room_types (hotel_id, code, name_ar, base_rate, weekend_rate, max_adults, max_children, charge_code_id, sort_order)
    values (h, 'SGL', 'غرفة مفردة', 320, 360, 1, 0, c_room, 1) returning id into t_sgl;
  insert into public.room_types (hotel_id, code, name_ar, base_rate, weekend_rate, max_adults, max_children, overbooking_limit, charge_code_id, sort_order)
    values (h, 'DBL', 'غرفة مزدوجة', 420, 480, 2, 1, 1, c_room, 2) returning id into t_dbl;
  insert into public.room_types (hotel_id, code, name_ar, base_rate, weekend_rate, max_adults, max_children, charge_code_id, sort_order)
    values (h, 'FAM', 'غرفة عائلية', 560, 620, 4, 3, c_room, 3) returning id into t_fam;
  insert into public.room_types (hotel_id, code, name_ar, base_rate, weekend_rate, max_adults, max_children, charge_code_id, sort_order)
    values (h, 'STE', 'جناح تنفيذي', 850, 950, 3, 2, c_room, 4) returning id into t_ste;
  insert into public.room_types (hotel_id, code, name_ar, booking_mode, base_rate, min_hours, max_adults, charge_code_id, sort_order)
    values (h, 'HALL', 'قاعة مناسبات', 'hourly', 300, 3, 200, c_events, 5) returning id into t_hall;
  insert into public.room_types (hotel_id, code, name_ar, booking_mode, base_rate, min_hours, max_adults, charge_code_id, sort_order)
    values (h, 'POOL', 'المسبح الخاص', 'hourly', 150, 1, 20, c_spa, 6) returning id into t_pool;

  perform public.create_rooms_bulk(h, t_sgl, 101, 110, f1);
  perform public.create_rooms_bulk(h, t_dbl, 201, 218, f2);
  perform public.create_rooms_bulk(h, t_fam, 301, 304, f3);
  perform public.create_rooms_bulk(h, t_ste, 305, 312, f3);
  insert into public.rooms (hotel_id, room_number, room_type_id, floor_id, sort_order) values
    (h, 'قاعة الماسة', t_hall, f0, 1), (h, 'قاعة اللؤلؤة', t_hall, f0, 2), (h, 'المسبح', t_pool, f0, 3);

  -- الأسعار: موسم قريب بأسعار محددة وموسم لاحق بنسبة، وعرض لحظة أخيرة للمزدوجة
  insert into public.rate_seasons (hotel_id, name, date_from, date_to, adjust_pct)
    values (h, 'موسم الإجازة', v_today + 12, v_today + 30, 15) returning id into v_r;
  insert into public.rate_season_prices (season_id, hotel_id, room_type_id, nightly_rate, weekend_rate) values
    (v_r, h, t_dbl, 520, 590), (v_r, h, t_ste, 1100, 1250);
  insert into public.rate_seasons (hotel_id, name, date_from, date_to, adjust_pct)
    values (h, 'الموسم الهادئ', v_today + 45, v_today + 75, -10);
  insert into public.last_minute_rules (hotel_id, name, room_type_id, days_before, discount_pct)
    values (h, 'عرض الليلة', t_dbl, 1, 15);

  select id into v_cust from public.customers where hotel_id = h and is_active order by code limit 1;
  for i in 1 .. array_length(names, 1) loop
    insert into public.guests (hotel_id, full_name, phone, nationality, id_type, id_number)
    values (h, names[i], '77' || (1000000 + floor(random() * 8999999)::int)::text, case when i > 16 then 'يمني' else 'سعودي' end,
            'national_id', (1000000000 + floor(random() * 899999999)::bigint)::text)
    returning id into v_g;
    g := g || v_g;
  end loop;

  -- حجوزات الأسابيع الستة القادمة: إشغال أعلى قريبًا، وتخصيص غرف للوصول خلال أسبوع
  v_types := array[t_sgl, t_dbl, t_dbl, t_dbl, t_fam, t_ste, t_sgl, t_dbl];
  for i in 1 .. 150 loop
    v_arr := v_today + floor(power(random(), 1.5) * 42)::int;
    v_n := 1 + floor(random() * 4)::int;
    v_t := v_types[1 + floor(random() * array_length(v_types, 1))::int];
    begin
      v_r := public.create_reservation(
        p_hotel_id => h, p_guest_id => g[1 + floor(random() * array_length(g, 1))::int], p_room_type_id => v_t,
        p_arrival_date => v_arr, p_departure_date => v_arr + v_n, p_adults => 1::smallint,
        p_status => case when random() < 0.12 then 'tentative' else 'confirmed' end::public.reservation_status,
        p_source => (array['direct','phone','booking_com','website','agent','walk_in'])[1 + floor(random() * 6)::int]::public.reservation_source,
        p_tentative_until => v_today + floor(random() * 3)::int);
      if v_arr <= v_today + 7 and random() < 0.85 then
        select r.id into v_room from public.rooms r
         where r.room_type_id = v_t and r.service_status = 'in_service'
           and not exists (select 1 from public.reservations x where x.room_id = r.id and x.status in ('tentative', 'confirmed', 'checked_in')
                             and x.period && tsrange(v_arr::timestamp, (v_arr + v_n)::timestamp))
         order by random() limit 1;
        if v_room is not null then perform public.assign_reservation_room(v_r, v_room); end if;
      end if;
    exception when exclusion_violation then null; -- اكتمل النوع في تلك الليالي
    end;
  end loop;

  -- إقامة طويلة لشركة بسعر شهري (شهران) في غرفة محددة
  begin
    select r.id into v_room from public.rooms r where r.hotel_id = h and r.room_number = '218';
    perform public.create_reservation(p_hotel_id => h, p_guest_id => g[19], p_room_type_id => t_dbl,
      p_arrival_date => v_today + 1, p_departure_date => v_today + 61, p_room_id => v_room, p_customer_id => v_cust,
      p_source => 'corporate', p_pricing => 'monthly', p_fixed_rate => 9500, p_rate_reason => 'عقد إقامة مهندسي الشركة',
      p_special_requests => 'تنظيف يومي، فاتورة شهرية للشركة');
  exception when exclusion_violation then null;
  end;

  -- حجز متكرر: كل خميس لليلتين لمدة شهرين
  perform public.create_reservation_series(p_hotel_id => h, p_guest_id => g[11], p_room_type_id => t_sgl,
    p_weekday => 4::smallint, p_start_date => v_today + 1, p_end_date => v_today + 60, p_nights => 2::smallint,
    p_source => 'phone', p_notes => 'نزيل دائم نهاية كل أسبوع');

  -- مجموعة: وفد مؤتمر لخمس غرف
  begin
    perform public.create_group_reservation(p_hotel_id => h, p_name => 'وفد مؤتمر الطاقة', p_guest_id => g[3],
      p_room_type_id => t_dbl, p_arrival_date => v_today + 20, p_departure_date => v_today + 23, p_rooms => 5::smallint,
      p_customer_id => v_cust, p_source => 'corporate');
  exception when exclusion_violation then null;
  end;

  -- القاعات والمسبح بالساعة
  for i in 0 .. 13 loop
    if random() < 0.55 then
      v_ts := (v_today + i) + time '18:00';
      -- الاختيار العشوائي قبل الاستعلام (وإلا يُعاد random() لكل صف)
      v_name := (array['قاعة الماسة', 'قاعة اللؤلؤة'])[1 + floor(random() * 2)::int];
      select id into v_room from public.rooms where hotel_id = h and room_number = v_name;
      begin
        perform public.create_reservation(p_hotel_id => h, p_guest_id => g[1 + floor(random() * 20)::int], p_room_type_id => t_hall,
          p_room_id => v_room,
          p_starts_at => v_ts, p_ends_at => v_ts + interval '4 hours', p_adults => 120::smallint, p_source => 'phone',
          p_notes => (array['حفل زفاف','حفل تخرج','اجتماع شركة','عشاء عمل'])[1 + floor(random() * 4)::int]);
      exception when exclusion_violation then null;
      end;
    end if;
    if random() < 0.4 then
      v_ts := (v_today + i) + time '16:00';
      begin
        perform public.create_reservation(p_hotel_id => h, p_guest_id => g[1 + floor(random() * 20)::int], p_room_type_id => t_pool,
          p_room_id => (select id from public.rooms where hotel_id = h and room_number = 'المسبح'),
          p_starts_at => v_ts, p_ends_at => v_ts + interval '2 hours', p_adults => 6::smallint, p_source => 'walk_in');
      exception when exclusion_violation then null;
      end;
    end if;
  end loop;

  -- عدم حضور وإلغاء لليوم
  begin
    v_r := public.create_reservation(p_hotel_id => h, p_guest_id => g[7], p_room_type_id => t_sgl,
      p_arrival_date => v_today, p_departure_date => v_today + 2);
    perform public.mark_reservation_no_show(v_r, 'لم يحضر ولم يرد على الاتصال');
    v_r := public.create_reservation(p_hotel_id => h, p_guest_id => g[9], p_room_type_id => t_fam,
      p_arrival_date => v_today + 5, p_departure_date => v_today + 8);
    perform public.cancel_reservation(v_r, 'تغيّر موعد السفر');
  exception when exclusion_violation then null;
  end;

  -- قائمة الانتظار: طلب على الجناح في أزحم ليلة
  perform public.add_waitlist_entry(p_hotel_id => h, p_room_type_id => t_ste,
    p_arrival_date => (select d::date from generate_series(v_today + 1, v_today + 14, interval '1 day') d
                        order by (select count(*) from public.reservations x where x.room_type_id = t_ste and x.status in ('tentative','confirmed')
                                   and d::date >= x.arrival_date and d::date < x.departure_date) desc limit 1),
    p_departure_date => (select d::date + 2 from generate_series(v_today + 1, v_today + 14, interval '1 day') d
                        order by (select count(*) from public.reservations x where x.room_type_id = t_ste and x.status in ('tentative','confirmed')
                                   and d::date >= x.arrival_date and d::date < x.departure_date) desc limit 1),
    p_guest_name => 'م. عادل السقاف', p_phone => '777123456', p_adults => 2::smallint, p_notes => 'يفضّل إطلالة على البحر');

  -- التسكين: وصول اليوم ممن خُصصت لهم غرف — يُفتح فوليو الحجز في المحاسبة وتُرحَّل ليلة اليوم
  select id into v_pm from public.payment_methods where hotel_id = h and code = 'CARD';
  for v_r in select id from public.reservations where hotel_id = h and booking_mode = 'nightly' and arrival_date = v_today
               and status in ('tentative', 'confirmed') and room_id is not null order by created_at limit 6 loop
    perform public.check_in_reservation(v_r);
    perform public.post_reservation_charges(v_r);
  end loop;
  -- عربون مقدم على بعض الحجوزات القادمة
  if v_pm is not null then
    for v_r in select id from public.reservations where hotel_id = h and status = 'confirmed' and arrival_date > v_today
                 order by arrival_date, created_at limit 5 loop
      perform public.record_reservation_deposit(v_r, v_pm, 200, 'حوالة مسبقة');
    end loop;
  end if;

  -- حالة الغرف: بعضها يحتاج تنظيف وواحدة خارج الخدمة
  update public.rooms set housekeeping_status = 'dirty' where hotel_id = h and room_number in ('103', '205', '207', '302', '309');
  perform public.set_room_status((select id from public.rooms where hotel_id = h and room_number = '212'), null, 'out_of_service', 'صيانة التكييف');
end
$pms$;
`;
