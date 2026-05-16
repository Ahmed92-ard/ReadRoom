-- Fix RLS Policies for Room Notes and Chat Messages
-- Run this in your Supabase SQL Editor

-- 1. Drop existing problematic policies
DROP POLICY IF EXISTS "Anyone can read room notes" ON room_notes;
DROP POLICY IF EXISTS "Anyone can write room notes" ON room_notes;
DROP POLICY IF EXISTS "public read notes" ON room_notes;
DROP POLICY IF EXISTS "public write notes" ON room_notes;

DROP POLICY IF EXISTS "Anyone can read chat messages" ON room_chat_messages;
DROP POLICY IF EXISTS "Anyone can write chat messages" ON room_chat_messages;
DROP POLICY IF EXISTS "public read chat" ON room_chat_messages;
DROP POLICY IF EXISTS "public write chat" ON room_chat_messages;

-- 2. Create explicit policies for room_notes
-- Select: Anyone can read notes
CREATE POLICY "select_room_notes" ON room_notes
FOR SELECT USING (true);

-- Insert: Anyone can create a note
CREATE POLICY "insert_room_notes" ON room_notes
FOR INSERT WITH CHECK (true);

-- Update: Anyone can update a note
CREATE POLICY "update_room_notes" ON room_notes
FOR UPDATE USING (true) WITH CHECK (true);

-- Delete: Anyone can delete a note (optional but good for completeness)
CREATE POLICY "delete_room_notes" ON room_notes
FOR DELETE USING (true);


-- 3. Create explicit policies for room_chat_messages
-- Select: Anyone can read chat
CREATE POLICY "select_room_chat" ON room_chat_messages
FOR SELECT USING (true);

-- Insert: Anyone can post a message
CREATE POLICY "insert_room_chat" ON room_chat_messages
FOR INSERT WITH CHECK (true);

-- Update/Delete: Usually restricted but for now keeping it open to match previous "FOR ALL"
CREATE POLICY "update_room_chat" ON room_chat_messages
FOR UPDATE USING (true) WITH CHECK (true);

CREATE POLICY "delete_room_chat" ON room_chat_messages
FOR DELETE USING (true);

-- 4. Ensure RLS is actually enabled (just in case)
ALTER TABLE room_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE room_chat_messages ENABLE ROW LEVEL SECURITY;
