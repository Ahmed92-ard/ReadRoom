import { createAdminClient, createClient } from '@/lib/supabase/server';

export const PDF_BUCKET = 'room-pdfs';
export const PDF_TABLE = 'room_pdfs';
export const MAX_PDF_BYTES = 100 * 1024 * 1024;

export type ServerSupabase = ReturnType<typeof createClient>;

export async function getUserWithRetry(supabase: ServerSupabase) {
  let lastError: any = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await supabase.auth.getUser();
      if (!result.error || attempt === 1) return result;
      lastError = result.error;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return { data: { user: null }, error: lastError };
}

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

export function getDbClient(supabase: ServerSupabase) {
  return createAdminClient() ?? supabase;
}

export function sanitizePdfFilename(value: string) {
  return value.replace(/[^\w\s.\-()]/g, '').trim().slice(0, 180) || 'document.pdf';
}

export function buildPdfStoragePath(libraryId: string, roomId: string, pdfId: string) {
  return `${libraryId}/${roomId}/${pdfId}.pdf`;
}

export function isMissingPdfLibrary(error: any) {
  const message = String(error?.message ?? '');
  return error?.code === '42P01' ||
    error?.code === '42703' ||
    message.includes('room_pdfs') ||
    message.includes('channel_pdfs') ||
    message.includes('current_pdf_id');
}

export function serializeRoomPdf(pdf: any, libraryId: string) {
  return {
    id: pdf.id,
    channelId: pdf.room_id,
    roomId: pdf.room_id,
    driveId: pdf.drive_id,
    filename: pdf.filename,
    thumbnailUrl: pdf.thumbnail_url ?? null,
    storagePath: pdf.storage_path ?? null,
    url: pdf.storage_path
      ? `/api/libraries/${libraryId}/channels/${pdf.room_id}/pdfs/${pdf.id}/file`
      : null,
    position: pdf.position ?? 0,
    folderId: pdf.folder_id ?? null,
    createdAt: pdf.created_at,
  };
}
