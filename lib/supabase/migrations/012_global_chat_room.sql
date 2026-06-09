-- 012_global_chat_room.sql
-- Drop the single library chat unique index and column
DROP INDEX IF EXISTS rooms_library_chat_unique;
ALTER TABLE rooms DROP COLUMN IF EXISTS is_library_chat;

-- Delete all old chat and messaging data (rooms of type 'text' and all messages/receipts/reactions)
DELETE FROM message_reactions;
DELETE FROM message_read_receipts;
DELETE FROM message_attachments;
DELETE FROM message_clears;
DELETE FROM messages;
DELETE FROM rooms WHERE type = 'text';

-- Create the sentinel global library if it doesn't exist
INSERT INTO libraries (id, name, invite_code)
VALUES ('global-library', 'Global Library', 'GLOBAL12')
ON CONFLICT (id) DO NOTHING;

-- Create the single global chat room
INSERT INTO rooms (id, library_id, name, type, position)
VALUES ('global-chat', 'global-library', 'Global Chat', 'text', -999)
ON CONFLICT (id) DO NOTHING;
