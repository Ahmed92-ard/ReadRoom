// lib/backend/readroom.ts
// Canonical backend helpers — single source of truth for table names,
// storage paths, and shared query patterns.
// NO legacy aliases. NO compatibility shims.

import { createAdminClient, createClient } from '@/lib/supabase/server';

// ── Constants ─────────────────────────────────────────────────────────────────
export const PDF_BUCKET   = 'room-pdfs';
export const PDF_TABLE    = 'room_pdfs';
export const MAX_PDF_BYTES = 100 * 1024 * 1024; // 100 MB

export type ServerSupabase = ReturnType<typeof createClient>;

// ── Auth helpers ──────────────────────────────────────────────────────────────

/** getUser with one retry on transient network errors */
export async function getUserWithRetry(supabase: ServerSupabase) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await supabase.auth.getUser();
      if (!result.error || attempt === 1) return result;
    } catch (err) {
      if (attempt === 1) return { data: { user: null }, error: err };
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return { data: { user: null }, error: new Error('getUser failed') };
}

// ── Membership helpers ────────────────────────────────────────────────────────

/** Verify user is a member of a library. Returns { membership, error }. */
export async function requireLibraryMember(
  supabase: ServerSupabase,
  libraryId: string,
  userId: string
) {
  const { data, error } = await supabase
    .from('library_members')
    .select('role')
    .eq('library_id', libraryId)
    .eq('user_id', userId)
    .maybeSingle();
  return { membership: data, error };
}

/** Verify a room belongs to a library. Returns { data, error }. */
export async function requireRoomInLibrary(
  db: ServerSupabase | NonNullable<ReturnType<typeof createAdminClient>>,
  libraryId: string,
  roomId: string
) {
  return db
    .from('rooms')
    .select('id, library_id')
    .eq('id', roomId)
    .eq('library_id', libraryId)
    .maybeSingle();
}

// ── DB client helper ──────────────────────────────────────────────────────────

/** Returns admin client if available (bypasses RLS), falls back to user client. */
export function getDbClient(supabase: ServerSupabase) {
  return createAdminClient() ?? supabase;
}

// ── Storage path helpers ──────────────────────────────────────────────────────

/** Canonical storage path: <library_id>/<room_id>/<pdf_id>.pdf */
export function buildPdfStoragePath(libraryId: string, roomId: string, pdfId: string) {
  return `${libraryId}/${roomId}/${pdfId}.pdf`;
}

// ── Sanitization ──────────────────────────────────────────────────────────────

export function sanitizePdfFilename(value: string) {
  return value.replace(/[^\w\s.\-()]/g, '').trim().slice(0, 180) || 'document.pdf';
}

// ── Error detection ───────────────────────────────────────────────────────────

/** True if the error indicates the room_pdfs table doesn't exist yet. */
export function isMissingPdfTable(error: any) {
  const msg = String(error?.message ?? '');
  return error?.code === '42P01' || msg.includes('room_pdfs') || msg.includes('channel_pdfs');
}

// ── Serialization ─────────────────────────────────────────────────────────────

/** Serialize a room_pdfs row into the canonical ChannelPDF shape the frontend expects. */
export function serializeRoomPdf(pdf: any, libraryId: string) {
  return {
    id:           pdf.id,
    channelId:    pdf.room_id,   // kept for frontend compat (RoomShell uses channelId)
    roomId:       pdf.room_id,
    driveId:      pdf.drive_id,
    filename:     pdf.filename,
    thumbnailUrl: pdf.thumbnail_url ?? null,
    storagePath:  pdf.storage_path ?? null,
    url: pdf.storage_path
      ? `/api/libraries/${libraryId}/channels/${pdf.room_id}/pdfs/${pdf.id}/file`
      : null,
    position:  pdf.position ?? 0,
    folderId:  pdf.folder_id ?? null,
    createdAt: pdf.created_at,
  };
}
