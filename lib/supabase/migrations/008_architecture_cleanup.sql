-- ============================================================
-- Migration 008: Architecture Cleanup & Feature Additions
-- Canonical names:
--   servers         -> libraries
--   server_members  -> library_members
--   channels        -> rooms
--   room_chat_messages -> messages
--
-- Safety notes:
-- - This migration preserves existing chat rows by migrating them into messages.
-- - Run after migrations 002-007.
-- - It is intended for a maintenance window because table/column renames can
--   briefly block concurrent writes.
-- - If Supabase Realtime publication statements fail due permissions, enable
--   Realtime for users/messages/rooms/channel_pdfs in the dashboard.
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1. Canonical table names ────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.servers'::regclass AND relkind = 'v') THEN
    DROP VIEW public.servers;
  END IF;
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.server_members'::regclass AND relkind = 'v') THEN
    DROP VIEW public.server_members;
  END IF;
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid = 'public.channels'::regclass AND relkind = 'v') THEN
    DROP VIEW public.channels;
  END IF;
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

DO $$
BEGIN
  IF to_regclass('public.libraries') IS NULL AND to_regclass('public.servers') IS NOT NULL THEN
    ALTER TABLE public.servers RENAME TO libraries;
  END IF;

  IF to_regclass('public.library_members') IS NULL AND to_regclass('public.server_members') IS NOT NULL THEN
    ALTER TABLE public.server_members RENAME TO library_members;
  END IF;

  IF to_regclass('public.channels') IS NOT NULL AND to_regclass('public.rooms') IS NOT NULL THEN
    ALTER TABLE public.rooms RENAME TO legacy_rooms;
  END IF;

  IF to_regclass('public.channels') IS NOT NULL THEN
    ALTER TABLE public.channels RENAME TO rooms;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'library_members' AND column_name = 'server_id'
  ) THEN
    ALTER TABLE public.library_members RENAME COLUMN server_id TO library_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'rooms' AND column_name = 'server_id'
  ) THEN
    ALTER TABLE public.rooms RENAME COLUMN server_id TO library_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'channel_pdfs' AND column_name = 'channel_id'
  ) THEN
    ALTER TABLE public.channel_pdfs RENAME COLUMN channel_id TO room_id;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS channel_pdfs (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  room_id       TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  drive_id      TEXT NOT NULL,
  filename      TEXT NOT NULL,
  thumbnail_url TEXT,
  storage_path  TEXT,
  mime_type     TEXT DEFAULT 'application/pdf',
  size_bytes    BIGINT,
  uploader_id   UUID REFERENCES users(id) ON DELETE SET NULL,
  position      INT DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE channel_pdfs ADD COLUMN IF NOT EXISTS storage_path TEXT;
ALTER TABLE channel_pdfs ADD COLUMN IF NOT EXISTS mime_type TEXT DEFAULT 'application/pdf';
ALTER TABLE channel_pdfs ADD COLUMN IF NOT EXISTS size_bytes BIGINT;
ALTER TABLE channel_pdfs ADD COLUMN IF NOT EXISTS uploader_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE rooms ADD COLUMN IF NOT EXISTS current_pdf_id TEXT REFERENCES channel_pdfs(id) ON DELETE SET NULL;

-- ── 2. Persistent messages ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id         TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  sender_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  sender_name     TEXT NOT NULL DEFAULT 'Reader',
  avatar_color    TEXT NOT NULL DEFAULT '#6366f1',
  avatar_url      TEXT,
  content         TEXT NOT NULL CHECK (char_length(content) <= 2000),
  attachment_url  TEXT,
  attachment_type TEXT,
  deleted         BOOLEAN NOT NULL DEFAULT FALSE,
  edited_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF to_regclass('public.room_chat_messages') IS NOT NULL THEN
    INSERT INTO messages (
      room_id,
      sender_id,
      sender_name,
      avatar_color,
      content,
      created_at
    )
    SELECT
      room_id,
      CASE
        WHEN split_part(user_id, '_', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          THEN split_part(user_id, '_', 1)::uuid
        ELSE NULL
      END,
      COALESCE(NULLIF(user_name, ''), 'Reader'),
      COALESCE(NULLIF(avatar_color, ''), '#6366f1'),
      content,
      COALESCE(created_at, NOW())
    FROM room_chat_messages
    ON CONFLICT DO NOTHING;

    DROP TABLE room_chat_messages CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_messages_room_created ON messages(room_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id);

ALTER TABLE messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members can read messages" ON messages;
CREATE POLICY "members can read messages" ON messages
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM rooms r
    JOIN library_members lm ON lm.library_id = r.library_id
    WHERE r.id = messages.room_id
      AND lm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "members can insert messages" ON messages;
CREATE POLICY "members can insert messages" ON messages
FOR INSERT WITH CHECK (
  sender_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM rooms r
    JOIN library_members lm ON lm.library_id = r.library_id
    WHERE r.id = messages.room_id
      AND lm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "sender can update own messages" ON messages;
CREATE POLICY "sender can update own messages" ON messages
FOR UPDATE USING (sender_id = auth.uid())
WITH CHECK (sender_id = auth.uid());

-- ── 3. Notes ───────────────────────────────────────────────────────────────
ALTER TABLE IF EXISTS room_notes RENAME TO notes;

-- ── 4. Centralized user profiles ───────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT UNIQUE;

ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users can read own profile" ON users;
DROP POLICY IF EXISTS "authenticated users can read profiles" ON users;
CREATE POLICY "authenticated users can read profiles" ON users
FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "users can update own profile" ON users;
CREATE POLICY "users can update own profile" ON users
FOR UPDATE USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

-- ── 5. Folder support for PDFs ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pdf_folders (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  parent_id   TEXT REFERENCES pdf_folders(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (char_length(name) <= 128),
  position    INT NOT NULL DEFAULT 0,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pdf_folders_not_self_parent CHECK (parent_id IS NULL OR parent_id <> id)
);

CREATE INDEX IF NOT EXISTS idx_pdf_folders_room ON pdf_folders(room_id);
CREATE INDEX IF NOT EXISTS idx_pdf_folders_parent ON pdf_folders(parent_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pdf_folders_room_parent_name
  ON pdf_folders(room_id, COALESCE(parent_id, ''), lower(name));

ALTER TABLE pdf_folders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members can read folders" ON pdf_folders;
CREATE POLICY "members can read folders" ON pdf_folders
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM rooms r
    JOIN library_members lm ON lm.library_id = r.library_id
    WHERE r.id = pdf_folders.room_id
      AND lm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "members can manage folders" ON pdf_folders;
CREATE POLICY "members can manage folders" ON pdf_folders
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM rooms r
    JOIN library_members lm ON lm.library_id = r.library_id
    WHERE r.id = pdf_folders.room_id
      AND lm.user_id = auth.uid()
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM rooms r
    JOIN library_members lm ON lm.library_id = r.library_id
    WHERE r.id = pdf_folders.room_id
      AND lm.user_id = auth.uid()
  )
);

ALTER TABLE channel_pdfs ADD COLUMN IF NOT EXISTS folder_id TEXT REFERENCES pdf_folders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_channel_pdfs_folder ON channel_pdfs(folder_id);

-- ── 6. RLS policies for renamed tables ─────────────────────────────────────
CREATE OR REPLACE FUNCTION is_library_member(target_library_id TEXT, target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM library_members
    WHERE library_id = target_library_id
      AND user_id = target_user_id
  );
$$;

CREATE OR REPLACE FUNCTION library_member_role(target_library_id TEXT, target_user_id UUID)
RETURNS TEXT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM library_members
  WHERE library_id = target_library_id
    AND user_id = target_user_id
  LIMIT 1;
$$;

ALTER TABLE libraries ENABLE ROW LEVEL SECURITY;
ALTER TABLE library_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE channel_pdfs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Members can see their servers" ON libraries;
DROP POLICY IF EXISTS "members can read their libraries" ON libraries;
CREATE POLICY "members can read their libraries" ON libraries
FOR SELECT USING (
  is_library_member(libraries.id, auth.uid())
);

DROP POLICY IF EXISTS "authenticated users can create libraries" ON libraries;
CREATE POLICY "authenticated users can create libraries" ON libraries
FOR INSERT WITH CHECK (owner_id = auth.uid());

DROP POLICY IF EXISTS "Owners and admins can update their servers" ON libraries;
DROP POLICY IF EXISTS "owners and admins can update libraries" ON libraries;
CREATE POLICY "owners and admins can update libraries" ON libraries
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM library_members
    WHERE library_id = libraries.id AND user_id = auth.uid() AND role IN ('owner', 'admin')
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM library_members
    WHERE library_id = libraries.id AND user_id = auth.uid() AND role IN ('owner', 'admin')
  )
);

DROP POLICY IF EXISTS "members can read library members" ON library_members;
CREATE POLICY "members can read library members" ON library_members
FOR SELECT USING (
  is_library_member(library_members.library_id, auth.uid())
);

DROP POLICY IF EXISTS "users can join libraries through api" ON library_members;
CREATE POLICY "users can join libraries through api" ON library_members
FOR INSERT WITH CHECK (
  user_id = auth.uid()
  AND role IN ('owner', 'admin', 'member')
);

DROP POLICY IF EXISTS "Members can see channels in their servers" ON rooms;
DROP POLICY IF EXISTS "members can read rooms in their libraries" ON rooms;
CREATE POLICY "members can read rooms in their libraries" ON rooms
FOR SELECT USING (
  is_library_member(rooms.library_id, auth.uid())
);

DROP POLICY IF EXISTS "admins can create rooms" ON rooms;
CREATE POLICY "admins can create rooms" ON rooms
FOR INSERT WITH CHECK (
  library_member_role(rooms.library_id, auth.uid()) IN ('owner', 'admin')
);

DROP POLICY IF EXISTS "Members can update channels in their servers" ON rooms;
DROP POLICY IF EXISTS "members can update rooms" ON rooms;
CREATE POLICY "members can update rooms" ON rooms
FOR UPDATE USING (
  is_library_member(rooms.library_id, auth.uid())
) WITH CHECK (
  is_library_member(rooms.library_id, auth.uid())
);

DROP POLICY IF EXISTS "Members can see channel PDFs in their servers" ON channel_pdfs;
DROP POLICY IF EXISTS "members can read pdfs" ON channel_pdfs;
CREATE POLICY "members can read pdfs" ON channel_pdfs
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM rooms r
    JOIN library_members lm ON lm.library_id = r.library_id
    WHERE r.id = channel_pdfs.room_id AND lm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Members can insert PDFs to their channels" ON channel_pdfs;
DROP POLICY IF EXISTS "members can insert pdfs" ON channel_pdfs;
CREATE POLICY "members can insert pdfs" ON channel_pdfs
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM rooms r
    JOIN library_members lm ON lm.library_id = r.library_id
    WHERE r.id = channel_pdfs.room_id AND lm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Members can update PDFs in their channels" ON channel_pdfs;
DROP POLICY IF EXISTS "members can update pdfs" ON channel_pdfs;
CREATE POLICY "members can update pdfs" ON channel_pdfs
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM rooms r
    JOIN library_members lm ON lm.library_id = r.library_id
    WHERE r.id = channel_pdfs.room_id AND lm.user_id = auth.uid()
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM rooms r
    JOIN library_members lm ON lm.library_id = r.library_id
    WHERE r.id = channel_pdfs.room_id AND lm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Members can delete PDFs from their channels" ON channel_pdfs;
DROP POLICY IF EXISTS "members can delete pdfs" ON channel_pdfs;
CREATE POLICY "members can delete pdfs" ON channel_pdfs
FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM rooms r
    JOIN library_members lm ON lm.library_id = r.library_id
    WHERE r.id = channel_pdfs.room_id
      AND lm.user_id = auth.uid()
      AND lm.role IN ('owner', 'admin', 'member')
  )
);

-- ── 7. Storage policies updated to canonical membership table ──────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('room-pdfs', 'room-pdfs', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Room members can read shared PDFs" ON storage.objects;
CREATE POLICY "Room members can read shared PDFs" ON storage.objects
FOR SELECT USING (
  bucket_id = 'room-pdfs'
  AND EXISTS (
    SELECT 1 FROM library_members
    WHERE library_members.library_id = (storage.foldername(name))[1]
      AND library_members.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Room members can upload shared PDFs" ON storage.objects;
CREATE POLICY "Room members can upload shared PDFs" ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'room-pdfs'
  AND EXISTS (
    SELECT 1 FROM library_members
    WHERE library_members.library_id = (storage.foldername(name))[1]
      AND library_members.user_id = auth.uid()
      AND library_members.role IN ('owner', 'admin', 'member')
  )
);

DROP POLICY IF EXISTS "Room admins can remove shared PDFs" ON storage.objects;
CREATE POLICY "Room admins can remove shared PDFs" ON storage.objects
FOR DELETE USING (
  bucket_id = 'room-pdfs'
  AND EXISTS (
    SELECT 1 FROM library_members
    WHERE library_members.library_id = (storage.foldername(name))[1]
      AND library_members.user_id = auth.uid()
      AND library_members.role IN ('owner', 'admin')
  )
);

-- ── 8. Indexes / triggers ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_library_members_user ON library_members(user_id);
CREATE INDEX IF NOT EXISTS idx_library_members_library ON library_members(library_id);
CREATE INDEX IF NOT EXISTS idx_rooms_library ON rooms(library_id);
CREATE INDEX IF NOT EXISTS idx_channel_pdfs_room ON channel_pdfs(room_id);

CREATE OR REPLACE FUNCTION update_timestamp()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_pdf_folders_timestamp ON pdf_folders;
CREATE TRIGGER update_pdf_folders_timestamp
  BEFORE UPDATE ON pdf_folders
  FOR EACH ROW EXECUTE FUNCTION update_timestamp();

-- ── 9. Realtime publication, guarded for reruns ────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE messages;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'users'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE users;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'rooms'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE rooms;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'channel_pdfs'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE channel_pdfs;
    END IF;
  END IF;
END $$;

-- ── 10. Backward-compat read views ─────────────────────────────────────────
-- New writes should use canonical tables. These views are only for transition.
DROP VIEW IF EXISTS servers;
DROP VIEW IF EXISTS server_members;
DROP VIEW IF EXISTS channels;

CREATE VIEW servers AS
SELECT
  libraries.*,
  libraries.id AS server_id
FROM libraries;

CREATE VIEW server_members AS
SELECT
  library_members.*,
  library_members.library_id AS server_id
FROM library_members;

CREATE VIEW channels AS
SELECT
  rooms.*,
  rooms.library_id AS server_id,
  rooms.id AS channel_id
FROM rooms;
