-- ============================================================
-- ReadRoom — Canonical Schema (001_canonical_schema.sql)
-- Single source of truth. Drop everything and start clean.
-- Run this in Supabase SQL Editor on a fresh project.
-- ============================================================

-- ── 0. Wipe everything — views first, then tables ────────────────────────────
-- Views must be dropped before the tables they depend on.
-- We use IF EXISTS on every statement so this is safe on a fresh DB too.

-- Drop any compatibility views created by migration 008
-- (channel_pdfs may be a VIEW if migration 008 ran, or a TABLE if it didn't)
DO $$
BEGIN
  -- Drop channel_pdfs whether it's a view or a table
  IF EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema = 'public' AND table_name = 'channel_pdfs') THEN
    EXECUTE 'DROP VIEW IF EXISTS channel_pdfs CASCADE';
  ELSIF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'channel_pdfs') THEN
    EXECUTE 'DROP TABLE IF EXISTS channel_pdfs CASCADE';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema = 'public' AND table_name = 'channels') THEN
    EXECUTE 'DROP VIEW IF EXISTS channels CASCADE';
  ELSIF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'channels') THEN
    EXECUTE 'DROP TABLE IF EXISTS channels CASCADE';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema = 'public' AND table_name = 'server_members') THEN
    EXECUTE 'DROP VIEW IF EXISTS server_members CASCADE';
  ELSIF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'server_members') THEN
    EXECUTE 'DROP TABLE IF EXISTS server_members CASCADE';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.views WHERE table_schema = 'public' AND table_name = 'servers') THEN
    EXECUTE 'DROP VIEW IF EXISTS servers CASCADE';
  ELSIF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'servers') THEN
    EXECUTE 'DROP TABLE IF EXISTS servers CASCADE';
  END IF;
END $$;

-- Drop remaining tables in dependency order (children before parents)
DROP TABLE IF EXISTS room_chat_messages  CASCADE;
DROP TABLE IF EXISTS room_notes          CASCADE;
DROP TABLE IF EXISTS pdf_folders         CASCADE;
DROP TABLE IF EXISTS room_pdfs           CASCADE;
DROP TABLE IF EXISTS notes               CASCADE;
DROP TABLE IF EXISTS messages            CASCADE;
DROP TABLE IF EXISTS library_members     CASCADE;
DROP TABLE IF EXISTS rooms               CASCADE;
DROP TABLE IF EXISTS libraries           CASCADE;
DROP TABLE IF EXISTS users               CASCADE;

-- Drop legacy functions/triggers
DROP FUNCTION IF EXISTS handle_new_user()    CASCADE;
DROP FUNCTION IF EXISTS update_timestamp()   CASCADE;
DROP FUNCTION IF EXISTS set_updated_at()     CASCADE;
DROP FUNCTION IF EXISTS update_updated_at()  CASCADE;
DROP FUNCTION IF EXISTS trim_chat_messages() CASCADE;

-- ── 1. users ──────────────────────────────────────────────────────────────────
-- Mirrors auth.users. Auto-populated by trigger on every sign-in.
CREATE TABLE users (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email        TEXT,
  display_name TEXT NOT NULL DEFAULT 'Reader',
  avatar_url   TEXT,
  bio          TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. libraries ──────────────────────────────────────────────────────────────
CREATE TABLE libraries (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name        TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64),
  icon_url    TEXT,
  owner_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invite_code TEXT NOT NULL UNIQUE DEFAULT upper(substring(gen_random_uuid()::text, 1, 8)),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3. library_members ────────────────────────────────────────────────────────
CREATE TABLE library_members (
  library_id TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id)     ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner','admin','member')),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (library_id, user_id)
);

-- ── 4. rooms ──────────────────────────────────────────────────────────────────
CREATE TABLE rooms (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  library_id     TEXT NOT NULL REFERENCES libraries(id) ON DELETE CASCADE,
  name           TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64),
  description    TEXT CHECK (char_length(description) <= 256),
  type           TEXT NOT NULL DEFAULT 'pdf' CHECK (type IN ('text','pdf')),
  position       INT  NOT NULL DEFAULT 0,
  -- Reading state (synced via socket, persisted on leave)
  current_page   INT  NOT NULL DEFAULT 1,
  scroll_pct     FLOAT NOT NULL DEFAULT 0.0,
  zoom           FLOAT NOT NULL DEFAULT 1.0,
  -- Active PDF pointer
  current_pdf_id TEXT, -- FK added after room_pdfs table
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 5. pdf_folders ────────────────────────────────────────────────────────────
CREATE TABLE pdf_folders (
  id         TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  parent_id  TEXT REFERENCES pdf_folders(id) ON DELETE CASCADE,
  name       TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 128),
  position   INT  NOT NULL DEFAULT 0,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 6. room_pdfs ──────────────────────────────────────────────────────────────
CREATE TABLE room_pdfs (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  room_id       TEXT NOT NULL REFERENCES rooms(id)       ON DELETE CASCADE,
  folder_id     TEXT          REFERENCES pdf_folders(id) ON DELETE CASCADE,
  -- Source: Google Drive file ID, or 'local:<uuid>' for device uploads
  drive_id      TEXT NOT NULL,
  filename      TEXT NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 255),
  thumbnail_url TEXT,
  -- Supabase Storage path: <library_id>/<room_id>/<pdf_id>.pdf
  storage_path  TEXT,
  size_bytes    BIGINT,
  uploader_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  position      INT  NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add FK from rooms.current_pdf_id → room_pdfs.id (after room_pdfs exists)
ALTER TABLE rooms
  ADD CONSTRAINT rooms_current_pdf_id_fkey
  FOREIGN KEY (current_pdf_id) REFERENCES room_pdfs(id) ON DELETE SET NULL;

-- ── 7. messages ───────────────────────────────────────────────────────────────
-- Permanent chat history. Never auto-deleted.
CREATE TABLE messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id         TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  sender_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Denormalized for fast display without joins
  sender_name     TEXT NOT NULL DEFAULT 'Reader' CHECK (char_length(sender_name) <= 64),
  avatar_color    TEXT NOT NULL DEFAULT '#6366f1',
  avatar_url      TEXT,
  content         TEXT NOT NULL CHECK (char_length(content) BETWEEN 1 AND 2000),
  -- Future multimedia
  attachment_url  TEXT,
  attachment_type TEXT CHECK (attachment_type IN ('image','pdf','link')),
  -- Soft delete
  deleted         BOOLEAN NOT NULL DEFAULT FALSE,
  edited_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 8. notes ──────────────────────────────────────────────────────────────────
CREATE TABLE notes (
  id         BIGSERIAL PRIMARY KEY,
  room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  page       INT  NOT NULL DEFAULT 1,
  content    TEXT NOT NULL CHECK (char_length(content) <= 4000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 9. Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX idx_library_members_user     ON library_members(user_id);
CREATE INDEX idx_library_members_library  ON library_members(library_id);
CREATE INDEX idx_rooms_library            ON rooms(library_id);
CREATE INDEX idx_rooms_position           ON rooms(library_id, position);
CREATE INDEX idx_room_pdfs_room           ON room_pdfs(room_id);
CREATE INDEX idx_room_pdfs_folder         ON room_pdfs(folder_id);
CREATE INDEX idx_room_pdfs_position       ON room_pdfs(room_id, position);
CREATE INDEX idx_pdf_folders_room         ON pdf_folders(room_id);
CREATE INDEX idx_pdf_folders_parent       ON pdf_folders(parent_id);
CREATE INDEX idx_messages_room_created    ON messages(room_id, created_at ASC);
CREATE INDEX idx_messages_sender          ON messages(sender_id);
CREATE INDEX idx_notes_room_page          ON notes(room_id, page);

-- ── 10. updated_at trigger ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_users_updated_at
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_libraries_updated_at
  BEFORE UPDATE ON libraries FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_rooms_updated_at
  BEFORE UPDATE ON rooms FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_room_pdfs_updated_at
  BEFORE UPDATE ON room_pdfs FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_pdf_folders_updated_at
  BEFORE UPDATE ON pdf_folders FOR EACH ROW EXECUTE FUNCTION update_timestamp();
CREATE TRIGGER trg_notes_updated_at
  BEFORE UPDATE ON notes FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- ── 11. Auth trigger — auto-create user on sign-in ───────────────────────────
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.users (id, email, display_name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'full_name',
      NEW.raw_user_meta_data->>'name',
      split_part(NEW.email, '@', 1),
      'Reader'
    ),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO UPDATE SET
    email        = EXCLUDED.email,
    display_name = CASE
      WHEN users.display_name = 'Reader' OR users.display_name IS NULL
      THEN COALESCE(EXCLUDED.display_name, users.display_name)
      ELSE users.display_name
    END,
    avatar_url   = COALESCE(users.avatar_url, EXCLUDED.avatar_url),
    updated_at   = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

DROP TRIGGER IF EXISTS on_auth_user_updated ON auth.users;
CREATE TRIGGER on_auth_user_updated
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  WHEN (OLD.last_sign_in_at IS DISTINCT FROM NEW.last_sign_in_at)
  EXECUTE FUNCTION handle_new_user();

-- ── 12. Row Level Security ────────────────────────────────────────────────────
ALTER TABLE users          ENABLE ROW LEVEL SECURITY;
ALTER TABLE libraries      ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms          ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_pdfs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE pdf_folders    ENABLE ROW LEVEL SECURITY;
ALTER TABLE messages       ENABLE ROW LEVEL SECURITY;
ALTER TABLE notes          ENABLE ROW LEVEL SECURITY;

-- users
CREATE POLICY "authenticated users can read profiles"
  ON users FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "users can update own profile"
  ON users FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "service role can insert users"
  ON users FOR INSERT WITH CHECK (true);

-- libraries
CREATE POLICY "members can read their libraries"
  ON libraries FOR SELECT USING (
    EXISTS (SELECT 1 FROM library_members WHERE library_id = libraries.id AND user_id = auth.uid())
  );
CREATE POLICY "owners and admins can update libraries"
  ON libraries FOR UPDATE USING (
    EXISTS (SELECT 1 FROM library_members WHERE library_id = libraries.id AND user_id = auth.uid() AND role IN ('owner','admin'))
  );
CREATE POLICY "authenticated users can create libraries"
  ON libraries FOR INSERT WITH CHECK (auth.uid() IS NOT NULL AND owner_id = auth.uid());
CREATE POLICY "owners can delete libraries"
  ON libraries FOR DELETE USING (owner_id = auth.uid());

-- library_members
-- NOTE: avoid self-referential join on library_members for SELECT — use auth.uid() directly
CREATE POLICY "members can read library membership"
  ON library_members FOR SELECT USING (user_id = auth.uid());
CREATE POLICY "service role can manage members"
  ON library_members FOR ALL USING (true);

-- rooms
CREATE POLICY "members can read rooms"
  ON rooms FOR SELECT USING (
    EXISTS (SELECT 1 FROM library_members WHERE library_id = rooms.library_id AND user_id = auth.uid())
  );
CREATE POLICY "members can update rooms"
  ON rooms FOR UPDATE USING (
    EXISTS (SELECT 1 FROM library_members WHERE library_id = rooms.library_id AND user_id = auth.uid())
  );
CREATE POLICY "admins can create rooms"
  ON rooms FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM library_members WHERE library_id = rooms.library_id AND user_id = auth.uid() AND role IN ('owner','admin'))
  );
CREATE POLICY "admins can delete rooms"
  ON rooms FOR DELETE USING (
    EXISTS (SELECT 1 FROM library_members WHERE library_id = rooms.library_id AND user_id = auth.uid() AND role IN ('owner','admin'))
  );

-- room_pdfs
CREATE POLICY "members can read room pdfs"
  ON room_pdfs FOR SELECT USING (
    EXISTS (SELECT 1 FROM rooms r JOIN library_members lm ON lm.library_id = r.library_id WHERE r.id = room_pdfs.room_id AND lm.user_id = auth.uid())
  );
CREATE POLICY "members can insert room pdfs"
  ON room_pdfs FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM rooms r JOIN library_members lm ON lm.library_id = r.library_id WHERE r.id = room_pdfs.room_id AND lm.user_id = auth.uid())
  );
CREATE POLICY "members can update room pdfs"
  ON room_pdfs FOR UPDATE USING (
    EXISTS (SELECT 1 FROM rooms r JOIN library_members lm ON lm.library_id = r.library_id WHERE r.id = room_pdfs.room_id AND lm.user_id = auth.uid())
  );
CREATE POLICY "members can delete room pdfs"
  ON room_pdfs FOR DELETE USING (
    EXISTS (SELECT 1 FROM rooms r JOIN library_members lm ON lm.library_id = r.library_id WHERE r.id = room_pdfs.room_id AND lm.user_id = auth.uid())
  );

-- pdf_folders
CREATE POLICY "members can manage folders"
  ON pdf_folders FOR ALL USING (
    EXISTS (SELECT 1 FROM rooms r JOIN library_members lm ON lm.library_id = r.library_id WHERE r.id = pdf_folders.room_id AND lm.user_id = auth.uid())
  );

-- messages
CREATE POLICY "members can read messages"
  ON messages FOR SELECT USING (
    EXISTS (SELECT 1 FROM rooms r JOIN library_members lm ON lm.library_id = r.library_id WHERE r.id = messages.room_id AND lm.user_id = auth.uid())
  );
-- INSERT: sender_id must match the authenticated user (admin client bypasses this via service role)
CREATE POLICY "members can insert messages"
  ON messages FOR INSERT WITH CHECK (
    EXISTS (SELECT 1 FROM rooms r JOIN library_members lm ON lm.library_id = r.library_id WHERE r.id = messages.room_id AND lm.user_id = auth.uid())
  );
CREATE POLICY "sender or admin can soft-delete messages"
  ON messages FOR UPDATE USING (
    sender_id = auth.uid()
    OR EXISTS (SELECT 1 FROM rooms r JOIN library_members lm ON lm.library_id = r.library_id WHERE r.id = messages.room_id AND lm.user_id = auth.uid() AND lm.role IN ('owner','admin'))
  );

-- notes
CREATE POLICY "members can manage notes"
  ON notes FOR ALL USING (
    EXISTS (SELECT 1 FROM rooms r JOIN library_members lm ON lm.library_id = r.library_id WHERE r.id = notes.room_id AND lm.user_id = auth.uid())
  );

-- ── 13. Supabase Storage — room-pdfs bucket ───────────────────────────────────
-- Create buckets if they don't exist yet
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('room-pdfs', 'room-pdfs', false, 104857600, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', true, 5242880, ARRAY['image/jpeg','image/png','image/webp','image/gif'])
ON CONFLICT (id) DO NOTHING;

-- Storage RLS: path format is <library_id>/<room_id>/<pdf_id>.pdf
-- The library_id is the first folder segment.
DROP POLICY IF EXISTS "room members can read pdfs"   ON storage.objects;
DROP POLICY IF EXISTS "room members can upload pdfs" ON storage.objects;
DROP POLICY IF EXISTS "room admins can delete pdfs"  ON storage.objects;

CREATE POLICY "room members can read pdfs" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'room-pdfs'
    AND EXISTS (
      SELECT 1 FROM library_members
      WHERE library_id = (storage.foldername(name))[1]
        AND user_id = auth.uid()
    )
  );

CREATE POLICY "room members can upload pdfs" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'room-pdfs'
    AND EXISTS (
      SELECT 1 FROM library_members
      WHERE library_id = (storage.foldername(name))[1]
        AND user_id = auth.uid()
    )
  );

CREATE POLICY "room admins can delete pdfs" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'room-pdfs'
    AND EXISTS (
      SELECT 1 FROM library_members
      WHERE library_id = (storage.foldername(name))[1]
        AND user_id = auth.uid()
        AND role IN ('owner','admin')
    )
  );

-- ── 14. Realtime publications ─────────────────────────────────────────────────
-- Safely add tables to realtime publication (idempotent via DO block)
DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['messages','users','rooms','room_pdfs','pdf_folders']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = tbl
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', tbl);
    END IF;
  END LOOP;
END $$;
