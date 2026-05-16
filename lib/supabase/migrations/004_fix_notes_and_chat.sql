-- Fix for missing or incorrect notes and chat tables in the Discord architecture
-- Run this in Supabase SQL Editor

-- 1. Create or Update room_notes to reference channels instead of rooms
DROP TABLE IF EXISTS room_notes;

CREATE TABLE room_notes (
  id         BIGSERIAL PRIMARY KEY,
  room_id    TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL,
  page       INTEGER NOT NULL,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_room_notes_room_page ON room_notes(room_id, page);

-- 2. Create or Update room_chat_messages to reference channels instead of rooms
DROP TABLE IF EXISTS room_chat_messages;

CREATE TABLE room_chat_messages (
  id           BIGSERIAL PRIMARY KEY,
  room_id      TEXT NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL,
  user_name    TEXT NOT NULL,
  avatar_color TEXT DEFAULT '#6366f1',
  content      TEXT NOT NULL,
  created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_room_chat_room_id ON room_chat_messages(room_id, created_at DESC);

-- 3. RLS Policies
ALTER TABLE room_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_chat_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can read room notes" ON room_notes FOR SELECT USING (true);
CREATE POLICY "Anyone can write room notes" ON room_notes FOR ALL USING (true);

CREATE POLICY "Anyone can read chat messages" ON room_chat_messages FOR SELECT USING (true);
CREATE POLICY "Anyone can write chat messages" ON room_chat_messages FOR ALL USING (true);

-- 4. Trigger for updated_at on room_notes
CREATE TRIGGER update_room_notes_timestamp 
BEFORE UPDATE ON room_notes 
FOR EACH ROW EXECUTE FUNCTION update_timestamp();
