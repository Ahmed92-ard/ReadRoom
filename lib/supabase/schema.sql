-- pdf-reading-room schema
-- Paste this entire file into Supabase SQL Editor and click Run

-- ── Users (mirrored from auth.users via handle_new_user trigger) ─────────────
create table if not exists public.users (
  id           uuid primary key references auth.users(id) on delete cascade,
  email        text,
  display_name text,
  avatar_url   text,
  google_sub   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.users enable row level security;

create policy "users can read own profile"
  on public.users for select
  using (auth.uid() = id);

create policy "users can update own profile"
  on public.users for update
  using (auth.uid() = id);

create policy "service role can insert users"
  on public.users for insert
  with check (true);

-- ── Rooms ────────────────────────────────────────────────────────────────────
create table if not exists rooms (
  id            text primary key default gen_random_uuid()::text,
  name          text not null,
  created_by    text not null,          -- user id
  pdf_drive_id  text,                   -- Google Drive file ID
  pdf_name      text,                   -- display name
  pdf_url       text,                   -- Drive CDN URL
  current_page  integer not null default 1,
  zoom          numeric not null default 1.0,
  scroll_pct    numeric not null default 0.0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ── Room notes (per page) ────────────────────────────────────────────────────
create table if not exists room_notes (
  id         bigserial primary key,
  room_id    text not null references rooms(id) on delete cascade,
  user_id    text not null,
  page       integer not null,
  content    text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists room_notes_room_page on room_notes(room_id, page);

-- ── Chat messages (last 200 kept via trigger) ────────────────────────────────
create table if not exists room_chat_messages (
  id         bigserial primary key,
  room_id    text not null references rooms(id) on delete cascade,
  user_id    text not null,
  user_name  text not null,
  content    text not null,
  created_at timestamptz not null default now()
);

create index if not exists room_chat_room_id on room_chat_messages(room_id, created_at desc);

-- Trim to last 200 messages per room on each insert
create or replace function trim_chat_messages()
returns trigger language plpgsql as $$
begin
  delete from room_chat_messages
  where room_id = NEW.room_id
    and id not in (
      select id from room_chat_messages
      where room_id = NEW.room_id
      order by created_at desc
      limit 200
    );
  return null;
end;
$$;

drop trigger if exists trg_trim_chat on room_chat_messages;
create trigger trg_trim_chat
  after insert on room_chat_messages
  for each row execute function trim_chat_messages();

-- ── Auto-update updated_at ───────────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger language plpgsql as $$
begin
  NEW.updated_at = now();
  return NEW;
end;
$$;

drop trigger if exists trg_rooms_updated_at on rooms;
create trigger trg_rooms_updated_at
  before update on rooms
  for each row execute function set_updated_at();

drop trigger if exists trg_notes_updated_at on room_notes;
create trigger trg_notes_updated_at
  before update on room_notes
  for each row execute function set_updated_at();

-- ── Row Level Security ───────────────────────────────────────────────────────
alter table rooms              enable row level security;
alter table room_notes         enable row level security;
alter table room_chat_messages enable row level security;

-- For now: open read/write for anyone with the anon key (tighten later with auth)
create policy "public read rooms"  on rooms              for select using (true);
create policy "public write rooms" on rooms              for all    using (true);

create policy "public read notes"  on room_notes         for select using (true);
create policy "public write notes" on room_notes         for all    using (true);

create policy "public read chat"   on room_chat_messages for select using (true);
create policy "public write chat"  on room_chat_messages for all    using (true);
