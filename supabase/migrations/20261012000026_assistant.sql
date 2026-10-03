-- =============================================================================
-- المساعد الذكي: محادثات كل مستخدم ورسائلها، والإجابات المحفوظة، وتعليماته الخاصة.
-- كل صف يخص مستخدمًا واحدًا في فندق واحد، ولا يراه غيره ولا حتى المدير العام.
-- لا تُسجَّل في سجل التدقيق لأنها محادثات شخصية لا تغيّر بيانات الفندق.
-- =============================================================================

create table public.assistant_conversations (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index assistant_conversations_owner_idx on public.assistant_conversations (hotel_id, user_id, updated_at desc);

create table public.assistant_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.assistant_conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (char_length(content) <= 40000),
  is_error boolean not null default false,
  created_at timestamptz not null default clock_timestamp()
);
create index assistant_messages_conversation_idx on public.assistant_messages (conversation_id, created_at);

create table public.assistant_saved (
  id uuid primary key default gen_random_uuid(),
  hotel_id uuid not null references public.hotels (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  conversation_id uuid references public.assistant_conversations (id) on delete set null,
  question text not null default '' check (char_length(question) <= 8000),
  content text not null check (char_length(content) between 1 and 40000),
  created_at timestamptz not null default now()
);
create index assistant_saved_owner_idx on public.assistant_saved (hotel_id, user_id, created_at desc);

create table public.assistant_settings (
  hotel_id uuid not null references public.hotels (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  instructions text not null default '' check (char_length(instructions) <= 2000),
  open_mode text not null default 'panel' check (open_mode in ('panel', 'page')),
  updated_at timestamptz not null default now(),
  primary key (hotel_id, user_id)
);

-- أي رسالة جديدة ترفع المحادثة لأعلى القائمة
create or replace function app.touch_assistant_conversation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.assistant_conversations set updated_at = now() where id = new.conversation_id;
  return new;
end;
$$;
create trigger assistant_messages_touch after insert on public.assistant_messages
  for each row execute function app.touch_assistant_conversation();
create or replace function app.touch_assistant_settings()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger assistant_settings_updated before update on public.assistant_settings
  for each row execute function app.touch_assistant_settings();

alter table public.assistant_conversations enable row level security;
alter table public.assistant_messages enable row level security;
alter table public.assistant_saved enable row level security;
alter table public.assistant_settings enable row level security;

create policy assistant_conversations_own on public.assistant_conversations for all to authenticated
  using (user_id = (select auth.uid()) and hotel_id in (select app.member_hotels()))
  with check (user_id = (select auth.uid()) and hotel_id in (select app.member_hotels()));
create policy assistant_messages_own on public.assistant_messages for all to authenticated
  using (exists (select 1 from public.assistant_conversations c where c.id = conversation_id and c.user_id = (select auth.uid()) and c.hotel_id in (select app.member_hotels())))
  with check (exists (select 1 from public.assistant_conversations c where c.id = conversation_id and c.user_id = (select auth.uid()) and c.hotel_id in (select app.member_hotels())));
create policy assistant_saved_own on public.assistant_saved for all to authenticated
  using (user_id = (select auth.uid()) and hotel_id in (select app.member_hotels()))
  with check (user_id = (select auth.uid()) and hotel_id in (select app.member_hotels()));
create policy assistant_settings_own on public.assistant_settings for all to authenticated
  using (user_id = (select auth.uid()) and hotel_id in (select app.member_hotels()))
  with check (user_id = (select auth.uid()) and hotel_id in (select app.member_hotels()));

revoke execute on all functions in schema app from public, anon;
