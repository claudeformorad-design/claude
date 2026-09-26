-- قياس زمن استعلامات التقارير ولوحة التحكم بصلاحيات مستخدم عادي (مع RLS)
\set ON_ERROR_STOP 1
\timing on
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000aaaa', false);
create temp table hh as select id from public.hotels limit 1;
grant select on hh to authenticated;
set role authenticated;
\echo '--- trial balance (gl_account_activity)'
select count(*) from public.gl_account_activity((select id from hh), date_trunc('year', current_date)::date, date_trunc('month', current_date)::date, current_date);
\echo '--- monthly_pnl 6m'
select count(*) from public.monthly_pnl((select id from hh), (current_date - 180), current_date);
\echo '--- room_statistics 6m'
select count(*) from public.room_statistics((select id from hh), (current_date - 180), current_date);
\echo '--- department_profitability month'
select count(*) from public.department_profitability((select id from hh), date_trunc('month', current_date)::date, current_date);
\echo '--- ledger_reconciliation'
select control, difference from public.ledger_reconciliation((select id from hh));
\echo '--- cash_balance'
select public.cash_balance((select id from hh), current_date);
\echo '--- aging receivable'
select count(*) from public.aging_report((select id from hh), 'receivable', current_date);
\echo '--- customer_balances (customers page)'
select count(*) from public.customer_balances where hotel_id = (select id from hh);
\echo '--- journal list 300 + totals'
select count(*) from (select id from public.journal_entries where hotel_id = (select id from hh) order by entry_date desc, entry_number desc limit 300) j
  join public.journal_entry_totals t on t.journal_entry_id = j.id;
\echo '--- folio list (all) + balances'
select count(*) from (select id from public.guest_folios where hotel_id = (select id from hh) order by created_at desc limit 300) f join public.folio_balances b on b.folio_id = f.id;
\echo '--- invoices list'
select count(*) from (select id from public.invoices where hotel_id = (select id from hh) order by issue_date desc limit 300) i;
\echo '--- audit log view 200'
select count(*) from (select * from public.audit_logs where hotel_id = (select id from hh) order by occurred_at desc limit 200) a;
\echo '--- ledger lines of bank account'
select count(*) from public.journal_entry_lines l join public.journal_entries j on j.id = l.journal_entry_id
 where l.hotel_id = (select id from hh) and l.account_id = (select id from public.chart_of_accounts where hotel_id = (select id from hh) and code = '1103') and j.status = 'posted';
\echo '--- tax_return year'
select count(*) from public.tax_return((select id from hh), date_trunc('year', current_date)::date, current_date);
