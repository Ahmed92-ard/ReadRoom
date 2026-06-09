-- ── 011_library_chat_room.sql ─────────────────────────────────────────────────
-- Adds is_library_chat flag to rooms so each library can have exactly one
-- hidden library-wide chat room. Additive and non-breaking.

ALTER TABLE rooms
  ADD COLUMN IF NOT EXISTS is_library_chat BOOLEAN NOT NULL DEFAULT FALSE;

-- Enforce at most one library chat room per library
CREATE UNIQUE INDEX IF NOT EXISTS rooms_library_chat_unique
  ON rooms (library_id)
  WHERE is_library_chat = TRUE;
