-- =============================================================================
-- اختبارات المساعد الذكي: كل مستخدم يرى محادثاته ومحفوظاته وتعليماته فقط، حتى داخل نفس الفندق،
-- والرسالة الجديدة ترفع محادثتها، وحذف المحادثة يحذف رسائلها ويُبقي المحفوظ منها
-- =============================================================================
\set ON_ERROR_STOP 1
\pset tuples_only on
\o /dev/null

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000001501', 'gm15@hotel.test'),
  ('00000000-0000-0000-0000-000000001502', 'clerk15@hotel.test'),
  ('00000000-0000-0000-0000-000000001503', 'outsider15@hotel.test');

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
create or replace function pg_temp.check(p_ok boolean, p_what text) returns void language plpgsql as $$
begin
  if not coalesce(p_ok, false) then raise exception 'Check failed: %', p_what; end if;
end $$;

select pg_temp.act_as('00000000-0000-0000-0000-000000001501');
create temp table h15 as select public.create_hotel('فندق المساعد', 'YE', 'YER') as id;
create temp table ids (k text primary key, v uuid);
grant all on h15, ids to authenticated;
select pg_temp.act_as(null);
insert into public.hotel_members (hotel_id, user_id) select id, '00000000-0000-0000-0000-000000001502' from h15;

-- المدير ينشئ محادثة ورسالتين وإجابة محفوظة وتعليمات
select pg_temp.act_as('00000000-0000-0000-0000-000000001501');
with c as (insert into public.assistant_conversations (hotel_id, title) select id, 'وضع الفندق اليوم' from h15 returning id)
insert into ids select 'conv', id from c;
update public.assistant_conversations set updated_at = now() - interval '1 day' where id = (select v from ids where k = 'conv');
insert into public.assistant_messages (conversation_id, role, content)
  select v, 'user', 'ما وضع الفندق اليوم؟' from ids where k = 'conv';
insert into public.assistant_messages (conversation_id, role, content)
  select v, 'assistant', 'الإشغال 44%' from ids where k = 'conv';
insert into public.assistant_saved (hotel_id, conversation_id, question, content)
  select h15.id, ids.v, 'ما وضع الفندق اليوم؟', 'الإشغال 44%' from h15, ids where ids.k = 'conv';
insert into public.assistant_settings (hotel_id, instructions, open_mode) select id, 'اختصر', 'panel' from h15;
update public.assistant_settings set instructions = 'اختصر الإجابات', open_mode = 'page';

select pg_temp.check((select updated_at > now() - interval '1 minute' from public.assistant_conversations), 'new message moves the conversation up');
select pg_temp.check((select user_id = '00000000-0000-0000-0000-000000001501' from public.assistant_conversations), 'owner defaults to the signed in user');
select pg_temp.check((select count(*) = 2 from public.assistant_messages), 'owner reads the messages');

-- زميل في نفس الفندق لا يرى شيئًا ولا يكتب في محادثة غيره ولا ينتحل مالكها
select pg_temp.act_as('00000000-0000-0000-0000-000000001502');
select pg_temp.check((select count(*) = 0 from public.assistant_conversations), 'colleague sees no conversations');
select pg_temp.check((select count(*) = 0 from public.assistant_messages), 'colleague sees no messages');
select pg_temp.check((select count(*) = 0 from public.assistant_saved), 'colleague sees no saved answers');
select pg_temp.check((select count(*) = 0 from public.assistant_settings), 'colleague sees no instructions');
select pg_temp.expect_error(format(
  $q$insert into public.assistant_messages (conversation_id, role, content) values (%L, 'user', 'x')$q$,
  (select v from ids where k = 'conv')), 'row-level security');
select pg_temp.expect_error(format(
  $q$insert into public.assistant_conversations (hotel_id, user_id, title) values (%L, '00000000-0000-0000-0000-000000001501', 'x')$q$,
  (select id from h15)), 'row-level security');
update public.assistant_conversations set title = 'مخترق';
delete from public.assistant_conversations;
-- ويملك محادثاته الخاصة
insert into public.assistant_conversations (hotel_id, title) select id, 'محادثة الموظف' from h15;
select pg_temp.check((select count(*) = 1 from public.assistant_conversations), 'colleague has own conversation');

-- من خارج الفندق لا يستطيع إنشاء محادثة فيه
select pg_temp.act_as('00000000-0000-0000-0000-000000001503');
select pg_temp.expect_error(format(
  $q$insert into public.assistant_conversations (hotel_id, title) values (%L, 'x')$q$, (select id from h15)), 'row-level security');

-- محادثة المدير لم تتغير، وحذفها يحذف رسائلها ويُبقي المحفوظ
select pg_temp.act_as('00000000-0000-0000-0000-000000001501');
select pg_temp.check((select title = 'وضع الفندق اليوم' from public.assistant_conversations), 'colleague could not rename it');
select pg_temp.expect_error($q$insert into public.assistant_messages (conversation_id, role, content)
  select v, 'system', 'x' from ids where k = 'conv'$q$, 'check constraint');
delete from public.assistant_conversations;
select pg_temp.check((select count(*) = 0 from public.assistant_messages), 'messages deleted with the conversation');
select pg_temp.check((select count(*) = 1 and bool_and(conversation_id is null) from public.assistant_saved), 'saved answer kept');
select pg_temp.check((select instructions = 'اختصر الإجابات' and open_mode = 'page' from public.assistant_settings), 'instructions kept');

select pg_temp.act_as(null);
\o
select 'assistant tests passed';
