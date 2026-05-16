# ReadRoom Backend Audit & Canonical Flow

## Canonical Runtime Architecture

- Auth/session: Supabase Auth via `@supabase/ssr`; API routes call `auth.getUser()` and verify library membership before data access.
- Libraries: `libraries` owns rooms; `library_members` is the only membership/role table.
- Rooms: `rooms` is the canonical room table. The current UI route still says `/channels/...`, but API handlers map that URL segment to `rooms.id`.
- PDFs: `room_pdfs` is the canonical PDF metadata table. `channel_pdfs` is kept only as a read compatibility view by migration 009.
- Folders: `pdf_folders` stores nested logical folders per room. PDFs point to folders with `room_pdfs.folder_id`.
- Storage: private Supabase Storage bucket `room-pdfs`; object path is `<library_id>/<room_id>/<pdf_id>.pdf`.
- Chat: `messages` is the permanent chat table; Socket.IO broadcasts the already-persisted message for instant fan-out.
- Notes: `notes` is canonical. The notes API can fall back to `room_notes` only for databases that have not yet run cleanup.
- Realtime: Socket.IO handles presence, PDF library fan-out, chat fan-out, and follow sync. Supabase Realtime is used for profile propagation.

## Upload Flow

1. User selects Drive PDFs/folders or local files/folders in `GooglePicker`.
2. Drive imports copy PDF bytes into `room-pdfs`, then insert `room_pdfs`.
3. Local imports post multipart data to `/pdfs/upload`; folder uploads create `pdf_folders` first, preserving nested paths.
4. The API verifies user membership and verifies the room belongs to the requested library before using the service-role client.
5. The upload path is deterministic: `<library_id>/<room_id>/<pdf_id>.pdf`.
6. The client receives the inserted PDF row, selects it, and emits `pdf:added` so connected users update without reload.

## Migration Order

Run migrations in filename order:

1. `002_discord_architecture.sql`
2. `003_auth_trigger.sql`
3. `004_fix_notes_and_chat.sql`
4. `005_multiple_pdfs.sql`
5. `006_fix_rls_policies.sql`
6. `007_workspace_updates.sql`
7. `008_architecture_cleanup.sql`
8. `009_backend_storage_stabilization.sql`

For a fresh production reset, 002-007 are historical scaffolding. 008 and 009 are the cleanup/stabilization layer that canonicalizes names and storage.

## Obsolete / Transitional Pieces

- `servers`, `server_members`, and `channels` should be treated as compatibility views only after migration 008.
- `channel_pdfs` should be treated as a compatibility view only after migration 009.
- `room_notes` is legacy; `notes` is canonical.
- `/api/rooms/[id]/messages` remains a legacy fallback for non-library room contexts; library room chat uses `/api/libraries/[libraryId]/channels/[channelId]/messages`.
- Frontend naming still uses `channels` in route paths and store aliases. That is now a URL/UI boundary only; the DB table is `rooms`.
