-- SQL Migration 007: Persist library/room updates and channel PDF edits
-- Run this in Supabase SQL Editor after the previous migrations.

-- Library names can be edited by owners/admins.
DROP POLICY IF EXISTS "Owners and admins can update their servers" ON servers;
CREATE POLICY "Owners and admins can update their servers" ON servers
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM server_members
    WHERE server_id = servers.id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM server_members
    WHERE server_id = servers.id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
  )
);

-- Room/channel names and reading defaults can be updated by members.
DROP POLICY IF EXISTS "Members can update channels in their servers" ON channels;
CREATE POLICY "Members can update channels in their servers" ON channels
FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM server_members
    WHERE server_id = channels.server_id
      AND user_id = auth.uid()
  )
) WITH CHECK (
  EXISTS (
    SELECT 1 FROM server_members
    WHERE server_id = channels.server_id
      AND user_id = auth.uid()
  )
);

-- PDF metadata can be updated by members if future UI adds rename/reorder.
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
      )
  )
);
