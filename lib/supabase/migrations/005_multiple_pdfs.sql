-- SQL Migration 005: Support for Multiple PDFs per Channel
-- Run this in Supabase SQL Editor

-- 1. Create channel_pdfs table to store multiple PDFs per channel.
-- Migration 008 renames channels -> rooms and channel_id -> room_id. This
-- guarded create keeps 005 usable as a repair migration in either schema shape.
DO $$
BEGIN
  IF to_regclass('public.channel_pdfs') IS NULL THEN
    IF EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'channels' AND c.relkind IN ('r', 'p')
    ) THEN
      CREATE TABLE channel_pdfs (
        id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
        channel_id    TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
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
    ELSIF EXISTS (
      SELECT 1 FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'rooms' AND c.relkind IN ('r', 'p')
    ) THEN
      CREATE TABLE channel_pdfs (
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
    END IF;
  END IF;
END $$;

ALTER TABLE channel_pdfs ADD COLUMN IF NOT EXISTS storage_path TEXT;
ALTER TABLE channel_pdfs ADD COLUMN IF NOT EXISTS mime_type TEXT DEFAULT 'application/pdf';
ALTER TABLE channel_pdfs ADD COLUMN IF NOT EXISTS size_bytes BIGINT;
ALTER TABLE channel_pdfs ADD COLUMN IF NOT EXISTS uploader_id UUID REFERENCES users(id) ON DELETE SET NULL;

INSERT INTO storage.buckets (id, name, public)
VALUES ('room-pdfs', 'room-pdfs', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Room members can read shared PDFs" ON storage.objects;
CREATE POLICY "Room members can read shared PDFs" ON storage.objects
FOR SELECT USING (
  bucket_id = 'room-pdfs'
  AND EXISTS (
    SELECT 1 FROM server_members
    WHERE server_members.server_id = (storage.foldername(name))[1]
    AND server_members.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Room members can upload shared PDFs" ON storage.objects;
CREATE POLICY "Room members can upload shared PDFs" ON storage.objects
FOR INSERT WITH CHECK (
  bucket_id = 'room-pdfs'
  AND EXISTS (
    SELECT 1 FROM server_members
    WHERE server_members.server_id = (storage.foldername(name))[1]
    AND server_members.user_id = auth.uid()
    AND server_members.role IN ('owner', 'admin', 'member')
  )
);

DROP POLICY IF EXISTS "Room admins can remove shared PDFs" ON storage.objects;
CREATE POLICY "Room admins can remove shared PDFs" ON storage.objects
FOR DELETE USING (
  bucket_id = 'room-pdfs'
  AND EXISTS (
    SELECT 1 FROM server_members
    WHERE server_members.server_id = (storage.foldername(name))[1]
    AND server_members.user_id = auth.uid()
    AND server_members.role IN ('owner', 'admin')
  )
);

-- 2. Create index for fast lookups.
-- If migration 008 has already renamed channel_id -> room_id, keep reruns from
-- failing when this file is used only to repair the storage bucket.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'channel_pdfs' AND column_name = 'channel_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS channel_pdfs_channel_id ON channel_pdfs(channel_id);
  ELSIF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'channel_pdfs' AND column_name = 'room_id'
  ) THEN
    CREATE INDEX IF NOT EXISTS idx_channel_pdfs_room ON channel_pdfs(room_id);
  END IF;
END $$;

-- 3. Add current_pdf_id to the room/channel table if it doesn't exist.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'channels' AND c.relkind IN ('r', 'p')
  ) THEN
    ALTER TABLE channels ADD COLUMN IF NOT EXISTS current_pdf_id TEXT REFERENCES channel_pdfs(id) ON DELETE SET NULL;
  ELSIF EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname = 'rooms' AND c.relkind IN ('r', 'p')
  ) THEN
    ALTER TABLE rooms ADD COLUMN IF NOT EXISTS current_pdf_id TEXT REFERENCES channel_pdfs(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 4. Auto-update updated_at for channel_pdfs
CREATE OR REPLACE FUNCTION update_channel_pdfs_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_channel_pdfs_timestamp_trigger ON channel_pdfs;
CREATE TRIGGER update_channel_pdfs_timestamp_trigger 
  BEFORE UPDATE ON channel_pdfs 
  FOR EACH ROW 
  EXECUTE FUNCTION update_channel_pdfs_timestamp();

-- 5. Add RLS policies for channel_pdfs
ALTER TABLE channel_pdfs ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'channel_pdfs' AND column_name = 'channel_id'
  ) THEN
    DROP POLICY IF EXISTS "Members can see channel PDFs in their servers" ON channel_pdfs;
    CREATE POLICY "Members can see channel PDFs in their servers" ON channel_pdfs
    FOR SELECT USING (
      EXISTS (
        SELECT 1 FROM channels
        WHERE channels.id = channel_pdfs.channel_id
        AND EXISTS (
          SELECT 1 FROM server_members
          WHERE server_id = channels.server_id
          AND user_id = auth.uid()
        )
      )
    );

    DROP POLICY IF EXISTS "Members can insert PDFs to their channels" ON channel_pdfs;
    CREATE POLICY "Members can insert PDFs to their channels" ON channel_pdfs
    FOR INSERT WITH CHECK (
      EXISTS (
        SELECT 1 FROM channels
        WHERE channels.id = channel_pdfs.channel_id
        AND EXISTS (
          SELECT 1 FROM server_members
          WHERE server_id = channels.server_id
          AND user_id = auth.uid()
          AND role IN ('owner', 'admin', 'member')
        )
      )
    );

    DROP POLICY IF EXISTS "Members can update PDFs in their channels" ON channel_pdfs;
    CREATE POLICY "Members can update PDFs in their channels" ON channel_pdfs
    FOR UPDATE USING (
      EXISTS (
        SELECT 1 FROM channels
        WHERE channels.id = channel_pdfs.channel_id
        AND EXISTS (
          SELECT 1 FROM server_members
          WHERE server_id = channels.server_id
          AND user_id = auth.uid()
          AND role IN ('owner', 'admin', 'member')
        )
      )
    ) WITH CHECK (
      EXISTS (
        SELECT 1 FROM channels
        WHERE channels.id = channel_pdfs.channel_id
        AND EXISTS (
          SELECT 1 FROM server_members
          WHERE server_id = channels.server_id
          AND user_id = auth.uid()
          AND role IN ('owner', 'admin', 'member')
        )
      )
    );

    DROP POLICY IF EXISTS "Members can delete PDFs from their channels" ON channel_pdfs;
    CREATE POLICY "Members can delete PDFs from their channels" ON channel_pdfs
    FOR DELETE USING (
      EXISTS (
        SELECT 1 FROM channels
        WHERE channels.id = channel_pdfs.channel_id
        AND EXISTS (
          SELECT 1 FROM server_members
          WHERE server_id = channels.server_id
          AND user_id = auth.uid()
          AND role IN ('owner', 'admin')
        )
      )
    );
  END IF;
END $$;
