-- ============================================================
-- Migration 009: Backend / Storage Stabilization
--
-- Canonical runtime tables after this migration:
--   libraries
--   library_members
--   rooms
--   messages
--   notes
--   pdf_folders
--   room_pdfs
--
-- Storage:
--   room-pdfs bucket (private)
--   object path: <library_id>/<room_id>/<pdf_id>.pdf
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── 1. Canonical PDF metadata table ────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.room_pdfs') IS NULL AND to_regclass('public.channel_pdfs') IS NOT NULL THEN
    ALTER TABLE public.channel_pdfs RENAME TO room_pdfs;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.room_pdfs (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  room_id       TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  drive_id      TEXT NOT NULL,
  filename      TEXT NOT NULL,
  thumbnail_url TEXT,
  storage_path  TEXT,
  mime_type     TEXT DEFAULT 'application/pdf',
  size_bytes    BIGINT,
  uploader_id   UUID REFERENCES public.users(id) ON DELETE SET NULL,
  folder_id     TEXT,
  position      INT DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE public.room_pdfs ADD COLUMN IF NOT EXISTS room_id TEXT REFERENCES public.rooms(id) ON DELETE CASCADE;
ALTER TABLE public.room_pdfs ADD COLUMN IF NOT EXISTS drive_id TEXT NOT NULL DEFAULT ('local:' || gen_random_uuid()::text);
ALTER TABLE public.room_pdfs ADD COLUMN IF NOT EXISTS filename TEXT NOT NULL DEFAULT 'document.pdf';
ALTER TABLE public.room_pdfs ADD COLUMN IF NOT EXISTS thumbnail_url TEXT;
ALTER TABLE public.room_pdfs ADD COLUMN IF NOT EXISTS storage_path TEXT;
ALTER TABLE public.room_pdfs ADD COLUMN IF NOT EXISTS mime_type TEXT DEFAULT 'application/pdf';
ALTER TABLE public.room_pdfs ADD COLUMN IF NOT EXISTS size_bytes BIGINT;
ALTER TABLE public.room_pdfs ADD COLUMN IF NOT EXISTS uploader_id UUID REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE public.room_pdfs ADD COLUMN IF NOT EXISTS folder_id TEXT;
ALTER TABLE public.room_pdfs ADD COLUMN IF NOT EXISTS position INT DEFAULT 0;
ALTER TABLE public.room_pdfs ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();
ALTER TABLE public.room_pdfs ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- If migration 005 ran after 008 on a damaged DB, repair channel_id -> room_id.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'room_pdfs' AND column_name = 'channel_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'room_pdfs' AND column_name = 'room_id'
  ) THEN
    ALTER TABLE public.room_pdfs RENAME COLUMN channel_id TO room_id;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.pdf_folders (
  id          TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  room_id     TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  parent_id   TEXT REFERENCES public.pdf_folders(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (char_length(name) <= 128),
  position    INT NOT NULL DEFAULT 0,
  created_by  UUID REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pdf_folders_not_self_parent CHECK (parent_id IS NULL OR parent_id <> id)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'room_pdfs_folder_id_fkey'
  ) THEN
    ALTER TABLE public.room_pdfs
      ADD CONSTRAINT room_pdfs_folder_id_fkey
      FOREIGN KEY (folder_id) REFERENCES public.pdf_folders(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'rooms' AND column_name = 'current_pdf_id'
  ) THEN
    ALTER TABLE public.rooms ADD COLUMN current_pdf_id TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'rooms_current_pdf_id_fkey'
  ) THEN
    ALTER TABLE public.rooms
      ADD CONSTRAINT rooms_current_pdf_id_fkey
      FOREIGN KEY (current_pdf_id) REFERENCES public.room_pdfs(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_room_pdfs_room ON public.room_pdfs(room_id);
CREATE INDEX IF NOT EXISTS idx_room_pdfs_folder ON public.room_pdfs(folder_id);
CREATE INDEX IF NOT EXISTS idx_room_pdfs_room_position ON public.room_pdfs(room_id, folder_id, position);
CREATE INDEX IF NOT EXISTS idx_pdf_folders_room ON public.pdf_folders(room_id);
CREATE INDEX IF NOT EXISTS idx_pdf_folders_parent ON public.pdf_folders(parent_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pdf_folders_room_parent_name
  ON public.pdf_folders(room_id, COALESCE(parent_id, ''), lower(name));

CREATE OR REPLACE FUNCTION public.update_timestamp()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_room_pdfs_timestamp ON public.room_pdfs;
CREATE TRIGGER update_room_pdfs_timestamp
  BEFORE UPDATE ON public.room_pdfs
  FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();

DROP TRIGGER IF EXISTS update_pdf_folders_timestamp ON public.pdf_folders;
CREATE TRIGGER update_pdf_folders_timestamp
  BEFORE UPDATE ON public.pdf_folders
  FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();

-- Backward-compatible read view for stale deployments. New code uses room_pdfs.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'channel_pdfs' AND c.relkind = 'v'
  ) THEN
    DROP VIEW public.channel_pdfs;
  END IF;

  IF to_regclass('public.channel_pdfs') IS NULL THEN
    CREATE VIEW public.channel_pdfs
    WITH (security_invoker = true)
    AS SELECT * FROM public.room_pdfs;
  END IF;
END $$;

-- Keep legacy read views security-invoker so they cannot bypass table RLS.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'servers' AND c.relkind = 'v'
  ) THEN
    DROP VIEW public.servers;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'server_members' AND c.relkind = 'v'
  ) THEN
    DROP VIEW public.server_members;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'channels' AND c.relkind = 'v'
  ) THEN
    DROP VIEW public.channels;
  END IF;

  IF to_regclass('public.servers') IS NULL THEN
    CREATE VIEW public.servers
    WITH (security_invoker = true)
    AS SELECT libraries.*, libraries.id AS server_id FROM public.libraries;
  END IF;
  IF to_regclass('public.server_members') IS NULL THEN
    CREATE VIEW public.server_members
    WITH (security_invoker = true)
    AS SELECT library_members.*, library_members.library_id AS server_id FROM public.library_members;
  END IF;
  IF to_regclass('public.channels') IS NULL THEN
    CREATE VIEW public.channels
    WITH (security_invoker = true)
    AS SELECT rooms.*, rooms.library_id AS server_id, rooms.id AS channel_id FROM public.rooms;
  END IF;
END $$;

-- ── 2. Notes canonicalization ──────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('public.notes') IS NULL AND to_regclass('public.room_notes') IS NOT NULL THEN
    ALTER TABLE public.room_notes RENAME TO notes;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.notes (
  id         BIGSERIAL PRIMARY KEY,
  room_id    TEXT NOT NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL,
  page       INTEGER NOT NULL,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notes_room_page ON public.notes(room_id, page);

DROP TRIGGER IF EXISTS update_notes_timestamp ON public.notes;
CREATE TRIGGER update_notes_timestamp
  BEFORE UPDATE ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.update_timestamp();

-- ── 3. RLS policies ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.is_library_member(target_library_id TEXT, target_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.library_members
    WHERE library_id = target_library_id
      AND user_id = target_user_id
  );
$$;

ALTER TABLE public.room_pdfs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pdf_folders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members can read pdfs" ON public.room_pdfs;
CREATE POLICY "members can read pdfs" ON public.room_pdfs
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.rooms r
    JOIN public.library_members lm ON lm.library_id = r.library_id
    WHERE r.id = room_pdfs.room_id
      AND lm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "members can insert pdfs" ON public.room_pdfs;
CREATE POLICY "members can insert pdfs" ON public.room_pdfs
FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.rooms r
    JOIN public.library_members lm ON lm.library_id = r.library_id
    WHERE r.id = room_pdfs.room_id
      AND lm.user_id = auth.uid()
      AND lm.role IN ('owner', 'admin', 'member')
  )
);

DROP POLICY IF EXISTS "members can update pdfs" ON public.room_pdfs;
CREATE POLICY "members can update pdfs" ON public.room_pdfs
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM public.rooms r
    JOIN public.library_members lm ON lm.library_id = r.library_id
    WHERE r.id = room_pdfs.room_id
      AND lm.user_id = auth.uid()
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.rooms r
    JOIN public.library_members lm ON lm.library_id = r.library_id
    WHERE r.id = room_pdfs.room_id
      AND lm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "members can delete pdfs" ON public.room_pdfs;
CREATE POLICY "members can delete pdfs" ON public.room_pdfs
FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM public.rooms r
    JOIN public.library_members lm ON lm.library_id = r.library_id
    WHERE r.id = room_pdfs.room_id
      AND lm.user_id = auth.uid()
      AND lm.role IN ('owner', 'admin', 'member')
  )
);

DROP POLICY IF EXISTS "members can read folders" ON public.pdf_folders;
CREATE POLICY "members can read folders" ON public.pdf_folders
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.rooms r
    JOIN public.library_members lm ON lm.library_id = r.library_id
    WHERE r.id = pdf_folders.room_id
      AND lm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "members can manage folders" ON public.pdf_folders;
CREATE POLICY "members can manage folders" ON public.pdf_folders
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.rooms r
    JOIN public.library_members lm ON lm.library_id = r.library_id
    WHERE r.id = pdf_folders.room_id
      AND lm.user_id = auth.uid()
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.rooms r
    JOIN public.library_members lm ON lm.library_id = r.library_id
    WHERE r.id = pdf_folders.room_id
      AND lm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "members can read notes" ON public.notes;
CREATE POLICY "members can read notes" ON public.notes
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.rooms r
    JOIN public.library_members lm ON lm.library_id = r.library_id
    WHERE r.id = notes.room_id
      AND lm.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "members can write notes" ON public.notes;
CREATE POLICY "members can write notes" ON public.notes
FOR ALL USING (
  EXISTS (
    SELECT 1 FROM public.rooms r
    JOIN public.library_members lm ON lm.library_id = r.library_id
    WHERE r.id = notes.room_id
      AND lm.user_id = auth.uid()
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.rooms r
    JOIN public.library_members lm ON lm.library_id = r.library_id
    WHERE r.id = notes.room_id
      AND lm.user_id = auth.uid()
  )
);

-- ── 4. Private storage bucket and policies ─────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('room-pdfs', 'room-pdfs', false)
ON CONFLICT (id) DO UPDATE SET public = false;

DROP POLICY IF EXISTS "Room members can read shared PDFs" ON storage.objects;
CREATE POLICY "Room members can read shared PDFs" ON storage.objects
FOR SELECT USING (
  bucket_id = 'room-pdfs'
  AND public.is_library_member((storage.foldername(name))[1], auth.uid())
);

DROP POLICY IF EXISTS "Room members can upload shared PDFs" ON storage.objects;
CREATE POLICY "Room members can upload shared PDFs" ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'room-pdfs'
  AND EXISTS (
    SELECT 1 FROM public.library_members
    WHERE library_members.library_id = (storage.foldername(name))[1]
      AND library_members.user_id = auth.uid()
      AND library_members.role IN ('owner', 'admin', 'member')
  )
);

DROP POLICY IF EXISTS "Room members can update shared PDFs" ON storage.objects;
CREATE POLICY "Room members can update shared PDFs" ON storage.objects
FOR UPDATE USING (
  bucket_id = 'room-pdfs'
  AND public.is_library_member((storage.foldername(name))[1], auth.uid())
) WITH CHECK (
  bucket_id = 'room-pdfs'
  AND public.is_library_member((storage.foldername(name))[1], auth.uid())
);

DROP POLICY IF EXISTS "Room admins can remove shared PDFs" ON storage.objects;
CREATE POLICY "Room admins can remove shared PDFs" ON storage.objects
FOR DELETE USING (
  bucket_id = 'room-pdfs'
  AND EXISTS (
    SELECT 1 FROM public.library_members
    WHERE library_members.library_id = (storage.foldername(name))[1]
      AND library_members.user_id = auth.uid()
      AND library_members.role IN ('owner', 'admin')
  )
);

-- ── 5. Realtime publication ────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'room_pdfs'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.room_pdfs;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'pdf_folders'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.pdf_folders;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'notes'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.notes;
    END IF;
  END IF;
END $$;
