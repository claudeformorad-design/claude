-- =============================================================================
-- كشف حساب العميل: المبالغ المحوّلة للآجل على فوليوهات مفتوحة لم تصدر فاتورتها بعد.
-- تظهر في ذيل الكشف لأنها التزام على العميل لم يدخل دفتره بعد.
-- =============================================================================

create or replace function public.customer_pending_city_ledger(p_customer_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hotel uuid;
begin
  select hotel_id into v_hotel from public.customers where id = p_customer_id;
  if v_hotel is null then raise exception 'Customer not found'; end if;
  perform app.require_permission(v_hotel, 'customers.view');
  return coalesce((
    select sum(t.total_amount * t.direction)
    from public.folio_transactions t
    join public.payment_methods m on m.id = t.payment_method_id and m.kind = 'city_ledger'
    join public.guest_folios f on f.id = t.folio_id and f.status = 'open'
    where t.customer_id = p_customer_id and t.txn_type = 'payment'
  ), 0);
end;
$$;

revoke all on function public.customer_pending_city_ledger(uuid) from public;
grant execute on function public.customer_pending_city_ledger(uuid) to authenticated;
