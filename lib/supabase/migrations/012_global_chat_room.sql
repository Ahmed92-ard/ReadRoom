-- 012_global_chat_room.sql
-- Migrates ReadRoom to a single global chat model.

-- 1. Drop the old library-chat unique index and column if they exist
DROP INDEX IF EXISTS rooms_library_chat_unique;
ALTER TABLE rooms DROP COLUMN IF EXISTS is_library_chat;

-- 2. Wipe old chat/messaging data
DELETE FROM message_reactions;
DELETE FROM message_read_receipts;
DELETE FROM message_attachments;
DELETE FROM message_clears;
DELETE FROM messages;
DELETE FROM rooms WHERE type = 'text';

-- 3. Create the sentinel global library.
--    owner_id must reference a real user, so we pick the first user in the table.
--    If no user exists yet, this block is skipped and the library will be
--    created on first sign-in by the application bootstrap logic.
DO $$
DECLARE
  v_owner UUID;
BEGIN
  SELECT id INTO v_owner FROM users ORDER BY created_at LIMIT 1;

  IF v_owner IS NOT NULL THEN
    INSERT INTO libraries (id, name, invite_code, owner_id)
    VALUES ('global-library', 'Global Library', 'GLOBAL12', v_owner)
    ON CONFLICT (id) DO NOTHING;

    -- 4. Create the single global chat room
    INSERT INTO rooms (id, library_id, name, type, position)
    VALUES ('global-chat', 'global-library', 'Global Chat', 'text', -999)
    ON CONFLICT (id) DO NOTHING;

    -- 5. Enrol every existing user as a member of the global library
    INSERT INTO library_members (library_id, user_id, role)
    SELECT 'global-library', id, 'member'
    FROM users
    ON CONFLICT (library_id, user_id) DO NOTHING;

    -- Promote the owner to 'owner' role
    INSERT INTO library_members (library_id, user_id, role)
    VALUES ('global-library', v_owner, 'owner')
    ON CONFLICT (library_id, user_id)
    DO UPDATE SET role = 'owner';

    RAISE NOTICE 'global-library and global-chat created successfully (owner: %)', v_owner;
  ELSE
    RAISE NOTICE 'No users found — global-library will be created on first sign-in.';
  END IF;
END $$;
