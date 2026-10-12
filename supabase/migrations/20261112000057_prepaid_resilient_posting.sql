-- =============================================================================
-- ترحيل أقساط المصروفات المقدمة بلا توقف كامل: إن تعذّر قسط (فترة مقفلة، لا سنة مالية لتاريخه، حساب أُوقف)
-- يتوقف ذلك الجدول عند قسطه ويُذكر السبب، وتُرحَّل أقساط الجداول الأخرى كما هي.
-- النتيجة: {"posted": عدد القيود، "failed": [{"name", "date", "error"}]}
-- =============================================================================

drop function if exists public.post_due_prepaid_expenses(uuid);

create function public.post_due_prepaid_expenses(p_hotel_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_today    date := app.today_for_hotel(p_hotel_id);
  v_decimals integer;
  v_p        public.prepaid_expenses%rowtype;
  v_date     date;
  v_amount   numeric;
  v_entry    uuid;
  v_count    integer := 0;
  v_failed   jsonb := '[]'::jsonb;
begin
  perform app.require_permission(p_hotel_id, 'gl.journal.create');
  perform app.require_permission(p_hotel_id, 'gl.journal.post');
  perform pg_advisory_xact_lock(hashtext('nazeel.prepaid.' || p_hotel_id::text));
  select c.decimals into v_decimals from public.hotels h join public.currencies c on c.code = h.base_currency where h.id = p_hotel_id;
  for v_p in select * from public.prepaid_expenses where hotel_id = p_hotel_id and status = 'active' order by start_date, name for update loop
    loop
      exit when v_p.posted_months >= v_p.months;
      v_date := app.prepaid_month_end(v_p.start_date, v_p.posted_months);
      exit when v_date > v_today;
      v_amount := app.prepaid_installment(v_p, coalesce(v_decimals, 2));
      begin
        v_entry := app.post_system_entry(p_hotel_id, v_date,
          'إطفاء مصروف مقدم / Prepaid amortization — ' || v_p.name || ' (' || (v_p.posted_months + 1) || '/' || v_p.months || ')',
          'prepaid', v_p.id, 'PRE ' || left(v_p.name, 40) || ' #' || (v_p.posted_months + 1)::text,
          jsonb_build_array(
            jsonb_build_object('account_id', v_p.expense_account_id, 'department_id', v_p.department_id, 'debit', v_amount),
            jsonb_build_object('account_id', v_p.prepaid_account_id, 'credit', v_amount)));
        perform set_config('app.system_posting', 'on', true);
        update public.prepaid_expenses
           set posted_months = v_p.posted_months + 1, amortized_amount = v_p.amortized_amount + v_amount, last_entry_id = v_entry,
               status = case when v_p.posted_months + 1 >= v_p.months then 'completed' else status end
         where id = v_p.id;
        perform set_config('app.system_posting', 'off', true);
      exception when others then
        -- الأقساط بالتتابع: لا يُرحَّل ما بعد القسط المتعذر من نفس الجدول
        v_failed := v_failed || jsonb_build_object('name', v_p.name, 'date', v_date, 'error', sqlerrm);
        perform set_config('app.system_posting', 'off', true);
        exit;
      end;
      v_p.posted_months := v_p.posted_months + 1;
      v_p.amortized_amount := v_p.amortized_amount + v_amount;
      v_count := v_count + 1;
    end loop;
  end loop;
  return jsonb_build_object('posted', v_count, 'failed', v_failed);
end;
$$;

revoke all on function public.post_due_prepaid_expenses(uuid) from public, anon;
grant execute on function public.post_due_prepaid_expenses(uuid) to authenticated;
