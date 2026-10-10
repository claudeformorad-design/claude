-- =============================================================================
-- اختبارات الفوترة الإلكترونية: ختم كل فاتورة وإشعار دائن بعدّاد متصل وسلسلة بصمات،
-- نوع الفاتورة حسب الرقم الضريبي للمشتري، ومنع الكتابة المباشرة، وكشف أي تلاعب لاحق
-- =============================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\o /dev/null

insert into auth.users (id, email) values ('00000000-0000-0000-0000-000000002401', 'gm24@hotel.test');

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

select pg_temp.act_as('00000000-0000-0000-0000-000000002401');
create temp table h24 as select public.create_hotel('فندق الفوترة', 'SA', 'SAR') as id;
create temp table ids (k text primary key, v uuid);
grant all on h24, ids to authenticated;
update public.hotels set tax_number = '300000000000003' where id = (select id from h24);
insert into public.tax_rates (hotel_id, code, name_ar, kind, rate, account_id)
select id, 'VAT', 'ضريبة القيمة المضافة', 'vat', 15, (select a.id from public.chart_of_accounts a where a.hotel_id = h24.id and a.system_key = 'vat_output') from h24;
insert into public.charge_code_taxes (hotel_id, charge_code_id, tax_rate_id)
select (select id from h24), c.id, (select id from public.tax_rates where hotel_id = (select id from h24) and code = 'VAT')
from public.charge_codes c where c.hotel_id = (select id from h24) and c.code = 'EVENTS';
insert into public.customers (hotel_id, code, name_ar, allow_credit, tax_number) select id, 'B2B', 'شركة مسجلة', true, '311111111111113' from h24;
insert into public.customers (hotel_id, code, name_ar, allow_credit) select id, 'B2C', 'جهة بلا رقم', true from h24;

create or replace function pg_temp.inv(p_cust text, p_price numeric) returns uuid language sql as $$
  select public.create_direct_invoice((select id from h24),
    (select id from public.customers where hotel_id = (select id from h24) and code = p_cust),
    jsonb_build_array(jsonb_build_object('charge_code_id', (select id from public.charge_codes where hotel_id = (select id from h24) and code = 'EVENTS'), 'unit_price', p_price)));
$$;
insert into ids select 'i1', pg_temp.inv('B2B', 1000);
insert into ids select 'i2', pg_temp.inv('B2C', 200);
insert into ids select 'cn', public.create_credit_note((select v from ids where k = 'i1'), 115, 'خصم');
-- الملف كله معاملة واحدة هنا، فنطلق الختم المؤجل كما يحدث عند اعتماد كل عملية في التطبيق
set constraints all immediate;

-- ثلاثة مستندات مختومة بعدّاد 1، 2، 3 وسلسلة متصلة
select pg_temp.check((select count(*) from public.zatca_documents where hotel_id = (select id from h24)) = 3, 'three sealed documents');
select pg_temp.check((select string_agg(icv::text, ',' order by icv) from public.zatca_documents where hotel_id = (select id from h24)) = '1,2,3', 'icv 1,2,3');
select pg_temp.check((select pih from public.zatca_documents where hotel_id = (select id from h24) and icv = 1) = app.zatca_initial_pih(), 'first pih is the standard seed');
select pg_temp.check((select d2.pih = d1.hash from public.zatca_documents d1, public.zatca_documents d2
  where d1.hotel_id = (select id from h24) and d2.hotel_id = d1.hotel_id and d1.icv = 1 and d2.icv = 2), 'chain links');
select pg_temp.check((select invoice_type from public.zatca_documents where doc_id = (select v from ids where k = 'i1')) = 'standard', 'b2b is standard');
select pg_temp.check((select invoice_type from public.zatca_documents where doc_id = (select v from ids where k = 'i2')) = 'simplified', 'b2c is simplified');
select pg_temp.check((select total from public.zatca_documents where doc_id = (select v from ids where k = 'i1')) = 1150, 'sealed final total with tax');
select pg_temp.check((select tax_total from public.zatca_documents where doc_id = (select v from ids where k = 'i1')) = 150, 'sealed tax');
select pg_temp.check((select seller_vat from public.zatca_documents where doc_id = (select v from ids where k = 'i1')) = '300000000000003', 'seller vat stored');
select pg_temp.check((select doc_kind from public.zatca_documents where doc_id = (select v from ids where k = 'cn')) = 'credit_note', 'credit note sealed');

-- السلسلة سليمة
select pg_temp.check((select count(*) from public.zatca_verify_chain((select id from h24))) = 0, 'chain verifies');

-- لا كتابة مباشرة على السجل
update public.zatca_documents set total = 1 where hotel_id = (select id from h24);
delete from public.zatca_documents where hotel_id = (select id from h24);
select pg_temp.check((select count(*) from public.zatca_documents where hotel_id = (select id from h24) and total <> 1) = 3, 'users cannot change or delete sealed records');
-- ولا حتى دالة بصلاحيات المالك بلا علَم الترحيل النظامي
select pg_temp.act_as(null);
select pg_temp.expect_error($q$ update public.zatca_documents set total = 1 where hotel_id = (select id from h24) $q$, 'maintained by the system');
select pg_temp.act_as('00000000-0000-0000-0000-000000002401');

-- تلاعب بقاعدة البيانات مباشرة يُكشف
select pg_temp.act_as(null);
alter table public.zatca_documents disable trigger user;
update public.zatca_documents set total = 999 where doc_id = (select v from ids where k = 'i2');
alter table public.zatca_documents enable trigger user;
select pg_temp.act_as('00000000-0000-0000-0000-000000002401');
select pg_temp.check((select count(*) from public.zatca_verify_chain((select id from h24)) where icv = 2) = 1, 'tampering detected');

select pg_temp.act_as(null);
\o
select 'zatca tests passed';
