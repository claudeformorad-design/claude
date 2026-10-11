-- =============================================================================
-- نصوص رسائل واتساب: لكل فندق نص خاص لكل رسالة (تأكيد الحجز، التذكير بالوصول، إيصال الدفعة،
-- الشكر بعد المغادرة، التذكير بالرصيد). النص الافتراضي في التطبيق، وهنا ما يغيّره الفندق فقط.
-- الإرسال نفسه من جهاز الموظف عبر رابط واتساب (لا يُرسل شيء من الخادم).
-- =============================================================================

create table public.message_templates (
  hotel_id    uuid not null references public.hotels(id) on delete cascade,
  key         text not null check (key in ('reservation_confirm', 'arrival_reminder', 'payment_receipt', 'checkout_thanks', 'balance_reminder')),
  body        text not null check (length(trim(body)) between 1 and 2000),
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id),
  primary key (hotel_id, key)
);
alter table public.message_templates enable row level security;
create policy message_templates_read on public.message_templates for select to authenticated
  using (hotel_id in (select app.member_hotels()));
create trigger audit_message_templates after insert or update or delete on public.message_templates
  for each row execute function app.audit_trigger();

-- نص فارغ يعيد الرسالة لنصها الافتراضي
create or replace function public.save_message_template(p_hotel_id uuid, p_key text, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.require_permission(p_hotel_id, 'settings.hotel.manage');
  if p_key not in ('reservation_confirm', 'arrival_reminder', 'payment_receipt', 'checkout_thanks', 'balance_reminder') then
    raise exception 'Unknown message template' using errcode = '22023';
  end if;
  if length(trim(coalesce(p_body, ''))) = 0 then
    delete from public.message_templates where hotel_id = p_hotel_id and key = p_key;
    return;
  end if;
  if length(trim(p_body)) > 2000 then
    raise exception 'The message is longer than 2000 characters' using errcode = '22023';
  end if;
  insert into public.message_templates (hotel_id, key, body, updated_by)
  values (p_hotel_id, p_key, trim(p_body), auth.uid())
  on conflict (hotel_id, key) do update set body = excluded.body, updated_at = now(), updated_by = excluded.updated_by;
end;
$$;

revoke all on function public.save_message_template(uuid, text, text) from public, anon;
grant execute on function public.save_message_template(uuid, text, text) to authenticated;
