-- =============================================================================
-- الفوترة الإلكترونية (هيئة الزكاة والضريبة والجمارك، المرحلة الأولى):
--   كل فاتورة وإشعار دائن يُختم عند اعتماد العملية (آخر المعاملة) بسجل واحد في zatca_documents:
--   معرّف فريد UUID، وعدّاد متسلسل ICV على مستوى الفندق، ونوع الفاتورة (ضريبية للمنشآت عند وجود رقم
--   ضريبي للمشتري، ومبسطة لغيرها)، ووقت الإصدار، والإجمالي والضريبة، وبصمة SHA-256 تشمل بصمة المستند
--   السابق (PIH) فتصبح سلسلة: أي تعديل على مستند سابق يكسر كل ما بعده.
--   رمز QR (الحقول 1 إلى 5) يُبنى في التطبيق من هذا السجل وبيانات الفندق.
--   المرحلة الثانية (الربط بمنصة فاتورة وختم التشفير بشهادة الهيئة) تحتاج تسجيل المنشأة في البوابة.
-- =============================================================================

create table public.zatca_documents (
  id            uuid primary key default gen_random_uuid(),
  hotel_id      uuid not null references public.hotels(id) on delete cascade,
  doc_kind      text not null check (doc_kind in ('invoice', 'credit_note')),
  doc_id        uuid not null unique,
  doc_number    text not null,
  icv           bigint not null check (icv > 0),
  uuid          uuid not null default gen_random_uuid() unique,
  invoice_type  text not null check (invoice_type in ('standard', 'simplified')),
  seller_vat    text not null default '',
  buyer_vat     text,
  issued_at     timestamptz not null,
  total         numeric(19, 4) not null,
  tax_total     numeric(19, 4) not null,
  pih           text not null,
  hash          text not null,
  created_at    timestamptz not null default now(),
  unique (hotel_id, icv)
);
create index zatca_documents_hotel_idx on public.zatca_documents (hotel_id, icv desc);

alter table public.zatca_documents enable row level security;
create policy zatca_documents_read on public.zatca_documents for select to authenticated
  using (hotel_id in (select app.permitted_hotels('invoices.view')));
-- لا كتابة مباشرة: الختم من المشغلات فقط
create trigger zatca_documents_system_only before insert or update or delete on public.zatca_documents
  for each row execute function app.system_write_only();

-- بصمة أول مستند في السلسلة حسب مواصفات الهيئة: SHA-256 للرقم 0 بترميز base64
create or replace function app.zatca_initial_pih() returns text language sql immutable as $$
  select 'NWZlY2ViNjZmZmM4NmYzOGQ5NTI3ODZjNmQ2OTZjNzljMmRiYzIzOWRkNGU5MWI0NjcyOWQ3M2EyN2ZiNTdlOQ=='::text;
$$;

-- ختم مستند: يُستدعى مرة واحدة لكل فاتورة أو إشعار دائن عند نهاية المعاملة
create or replace function app.zatca_seal(p_kind text, p_doc_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hotel   uuid;
  v_number  text;
  v_total   numeric;
  v_tax     numeric;
  v_buyer   text;
  v_issued  timestamptz;
  v_seller  text;
  v_icv     bigint;
  v_pih     text;
  v_uuid    uuid := gen_random_uuid();
  v_type    text;
  v_hash    text;
  v_prev    text := coalesce(current_setting('app.system_posting', true), 'off');
begin
  if exists (select 1 from public.zatca_documents where doc_id = p_doc_id) then
    return;
  end if;
  if p_kind = 'invoice' then
    select i.hotel_id, i.invoice_number, i.total, i.tax_total, nullif(trim(i.bill_to_tax_number), ''), i.created_at
      into v_hotel, v_number, v_total, v_tax, v_buyer, v_issued
    from public.invoices i where i.id = p_doc_id;
  else
    select c.hotel_id, c.credit_note_number, c.total, c.tax_amount, nullif(trim(i.bill_to_tax_number), ''), c.created_at
      into v_hotel, v_number, v_total, v_tax, v_buyer, v_issued
    from public.credit_notes c join public.invoices i on i.id = c.invoice_id where c.id = p_doc_id;
  end if;
  if v_hotel is null then
    return;
  end if;

  -- مستند واحد في كل لحظة لكل فندق، حتى يبقى العدّاد والسلسلة متصلين
  perform pg_advisory_xact_lock(hashtext('nazeel.zatca.' || v_hotel::text));
  select coalesce(h.tax_number, '') into v_seller from public.hotels h where h.id = v_hotel;
  select d.icv, d.hash into v_icv, v_pih from public.zatca_documents d where d.hotel_id = v_hotel order by d.icv desc limit 1;
  v_icv := coalesce(v_icv, 0) + 1;
  v_pih := coalesce(v_pih, app.zatca_initial_pih());
  v_type := case when v_buyer is not null then 'standard' else 'simplified' end;
  v_hash := encode(extensions.digest(concat_ws('|',
              p_kind, v_number, v_uuid::text, v_icv::text, v_type,
              to_char(v_issued at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
              v_seller, coalesce(v_buyer, ''), round(v_total, 2)::text, round(v_tax, 2)::text, v_pih), 'sha256'), 'base64');

  perform set_config('app.system_posting', 'on', true);
  insert into public.zatca_documents (hotel_id, doc_kind, doc_id, doc_number, icv, uuid, invoice_type, seller_vat, buyer_vat, issued_at, total, tax_total, pih, hash)
  values (v_hotel, p_kind, p_doc_id, v_number, v_icv, v_uuid, v_type, v_seller, v_buyer, v_issued, v_total, v_tax, v_pih, v_hash);
  perform set_config('app.system_posting', v_prev, true);
end;
$$;

create or replace function app.zatca_seal_trigger()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform app.zatca_seal(tg_argv[0], new.id);
  return null;
end;
$$;

-- مؤجل لنهاية المعاملة: يُختم المستند بإجمالياته النهائية بعد اكتمال بنوده
create constraint trigger invoices_zatca_seal after insert on public.invoices
  deferrable initially deferred for each row execute function app.zatca_seal_trigger('invoice');
create constraint trigger credit_notes_zatca_seal after insert on public.credit_notes
  deferrable initially deferred for each row execute function app.zatca_seal_trigger('credit_note');

-- التحقق من سلامة السلسلة: يعيد أول مستند انكسرت عنده (أو لا شيء إن كانت سليمة)
create or replace function public.zatca_verify_chain(p_hotel_id uuid)
returns table (icv bigint, doc_number text, problem text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform app.require_permission(p_hotel_id, 'invoices.view');
  return query
  with chain as (
    select d.*, lag(d.hash) over (order by d.icv) as prev_hash, lag(d.icv) over (order by d.icv) as prev_icv
    from public.zatca_documents d where d.hotel_id = p_hotel_id
  ),
  src as (
    select c.*, coalesce(i.total, cn.total) as cur_total, coalesce(i.tax_total, cn.tax_amount) as cur_tax,
           coalesce(i.invoice_number, cn.credit_note_number) as cur_number
    from chain c
    left join public.invoices i on c.doc_kind = 'invoice' and i.id = c.doc_id
    left join public.credit_notes cn on c.doc_kind = 'credit_note' and cn.id = c.doc_id
  )
  select s.icv, s.doc_number,
         case
           when s.icv <> coalesce(s.prev_icv, 0) + 1 then 'counter gap'
           when s.pih <> coalesce(s.prev_hash, app.zatca_initial_pih()) then 'previous hash mismatch'
           when s.cur_number is distinct from s.doc_number or round(s.cur_total, 2) <> round(s.total, 2) or round(s.cur_tax, 2) <> round(s.tax_total, 2) then 'document changed after sealing'
           when s.hash <> encode(extensions.digest(concat_ws('|', s.doc_kind, s.doc_number, s.uuid::text, s.icv::text, s.invoice_type,
                  to_char(s.issued_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), s.seller_vat, coalesce(s.buyer_vat, ''),
                  round(s.total, 2)::text, round(s.tax_total, 2)::text, s.pih), 'sha256'), 'base64') then 'hash mismatch'
         end
  from src s
  where s.icv <> coalesce(s.prev_icv, 0) + 1
     or s.pih <> coalesce(s.prev_hash, app.zatca_initial_pih())
     or s.cur_number is distinct from s.doc_number or round(s.cur_total, 2) <> round(s.total, 2) or round(s.cur_tax, 2) <> round(s.tax_total, 2)
     or s.hash <> encode(extensions.digest(concat_ws('|', s.doc_kind, s.doc_number, s.uuid::text, s.icv::text, s.invoice_type,
                  to_char(s.issued_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), s.seller_vat, coalesce(s.buyer_vat, ''),
                  round(s.total, 2)::text, round(s.tax_total, 2)::text, s.pih), 'sha256'), 'base64')
  order by s.icv;
end;
$$;

-- ختم المستندات الموجودة قبل هذا الترحيل بترتيب إنشائها
do $$
declare r record;
begin
  for r in
    select 'invoice' as k, i.id, i.created_at, i.invoice_number as n from public.invoices i
    union all
    select 'credit_note', c.id, c.created_at, c.credit_note_number from public.credit_notes c
    order by 3, 4
  loop
    perform app.zatca_seal(r.k, r.id);
  end loop;
end $$;

revoke all on function app.zatca_seal(text, uuid) from public, anon, authenticated;
revoke all on function public.zatca_verify_chain(uuid) from public, anon;
grant execute on function public.zatca_verify_chain(uuid) to authenticated;
