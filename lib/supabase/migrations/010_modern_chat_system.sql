-- ── Modern persistent chat extensions ────────────────────────────────────────
-- Adds replies, reactions, receipts, per-user clearing, and Supabase-backed
-- message attachments while preserving the canonical messages table.

ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS reply_to_message_id UUID REFERENCES messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS attachment_name TEXT,
  ADD COLUMN IF NOT EXISTS attachment_size BIGINT,
  ADD COLUMN IF NOT EXISTS attachment_mime TEXT,
  ADD COLUMN IF NOT EXISTS storage_path TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_attachment_type_check;

ALTER TABLE messages
  DROP CONSTRAINT IF EXISTS messages_content_check;

ALTER TABLE messages
  ADD CONSTRAINT messages_attachment_type_check
  CHECK (attachment_type IS NULL OR attachment_type IN ('image','video','file','pdf','link'));

ALTER TABLE messages
  ADD CONSTRAINT messages_content_check
  CHECK (char_length(content) <= 2000 AND (char_length(content) >= 1 OR attachment_type IS NOT NULL));

CREATE TABLE IF NOT EXISTS message_attachments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  room_id     TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  uploader_id UUID REFERENCES users(id) ON DELETE SET NULL,
  name        TEXT NOT NULL CHECK (char_length(name) <= 240),
  mime_type   TEXT NOT NULL CHECK (char_length(mime_type) <= 160),
  size_bytes  BIGINT NOT NULL DEFAULT 0,
  kind        TEXT NOT NULL CHECK (kind IN ('image','video','file','pdf')),
  storage_path TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS message_reactions (
  message_id UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji      TEXT NOT NULL CHECK (char_length(emoji) BETWEEN 1 AND 16),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_id, emoji)
);

CREATE TABLE IF NOT EXISTS message_read_receipts (
  room_id      TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  message_id   UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delivered_at TIMESTAMPTZ,
  read_at      TIMESTAMPTZ,
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS message_clears (
  room_id    TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cleared_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (room_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_messages_room_created_visible
  ON messages(room_id, created_at ASC) WHERE deleted = false;
CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to_message_id);
CREATE INDEX IF NOT EXISTS idx_message_attachments_room_created ON message_attachments(room_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_message_reactions_message ON message_reactions(message_id);
CREATE INDEX IF NOT EXISTS idx_message_receipts_room_user ON message_read_receipts(room_id, user_id);
CREATE INDEX IF NOT EXISTS idx_message_clears_user ON message_clears(user_id);

DROP TRIGGER IF EXISTS trg_messages_updated_at ON messages;
CREATE TRIGGER trg_messages_updated_at
  BEFORE UPDATE ON messages FOR EACH ROW EXECUTE FUNCTION update_timestamp();

ALTER TABLE message_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_read_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_clears ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "members can read message attachments" ON message_attachments;
CREATE POLICY "members can read message attachments"
  ON message_attachments FOR SELECT USING (
    EXISTS (SELECT 1 FROM rooms r JOIN library_members lm ON lm.library_id = r.library_id WHERE r.id = message_attachments.room_id AND lm.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "members can insert message attachments" ON message_attachments;
CREATE POLICY "members can insert message attachments"
  ON message_attachments FOR INSERT WITH CHECK (
    uploader_id = auth.uid()
    AND EXISTS (SELECT 1 FROM rooms r JOIN library_members lm ON lm.library_id = r.library_id WHERE r.id = message_attachments.room_id AND lm.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "members can manage message reactions" ON message_reactions;
CREATE POLICY "members can manage message reactions"
  ON message_reactions FOR ALL USING (
    EXISTS (
      SELECT 1 FROM messages m JOIN rooms r ON r.id = m.room_id JOIN library_members lm ON lm.library_id = r.library_id
      WHERE m.id = message_reactions.message_id AND lm.user_id = auth.uid()
    )
  ) WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM messages m JOIN rooms r ON r.id = m.room_id JOIN library_members lm ON lm.library_id = r.library_id
      WHERE m.id = message_reactions.message_id AND lm.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "members can manage message receipts" ON message_read_receipts;
CREATE POLICY "members can manage message receipts"
  ON message_read_receipts FOR ALL USING (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM rooms r JOIN library_members lm ON lm.library_id = r.library_id WHERE r.id = message_read_receipts.room_id AND lm.user_id = auth.uid())
  ) WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM rooms r JOIN library_members lm ON lm.library_id = r.library_id WHERE r.id = message_read_receipts.room_id AND lm.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "members can clear their own chat" ON message_clears;
CREATE POLICY "members can clear their own chat"
  ON message_clears FOR ALL USING (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM rooms r JOIN library_members lm ON lm.library_id = r.library_id WHERE r.id = message_clears.room_id AND lm.user_id = auth.uid())
  ) WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (SELECT 1 FROM rooms r JOIN library_members lm ON lm.library_id = r.library_id WHERE r.id = message_clears.room_id AND lm.user_id = auth.uid())
  );

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'chat-attachments',
  'chat-attachments',
  false,
  104857600,
  ARRAY[
    'image/jpeg','image/png','image/webp','image/gif',
    'video/mp4','video/webm','video/quicktime',
    'application/pdf','text/plain','text/csv','application/zip','application/octet-stream',
    'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ]
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "room members can read chat attachments" ON storage.objects;
DROP POLICY IF EXISTS "room members can upload chat attachments" ON storage.objects;

CREATE POLICY "room members can read chat attachments" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'chat-attachments'
    AND EXISTS (
      SELECT 1 FROM library_members
      WHERE library_id = (storage.foldername(name))[1]
        AND user_id = auth.uid()
    )
  );

CREATE POLICY "room members can upload chat attachments" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'chat-attachments'
    AND EXISTS (
      SELECT 1 FROM library_members
      WHERE library_id = (storage.foldername(name))[1]
        AND user_id = auth.uid()
    )
  );

DO $$
DECLARE
  tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['message_attachments','message_reactions','message_read_receipts','message_clears']
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND tablename = tbl
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE %I', tbl);
    END IF;
  END LOOP;
END $$;
