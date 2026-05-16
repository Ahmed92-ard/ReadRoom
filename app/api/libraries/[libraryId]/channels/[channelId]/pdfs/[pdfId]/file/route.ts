import { createAdminClient, createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { getUserWithRetry, PDF_BUCKET, PDF_TABLE } from '@/lib/backend/readroom';

export const runtime = 'nodejs';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ libraryId: string; channelId: string; pdfId: string }> | { libraryId: string; channelId: string; pdfId: string } }
) {
  const { libraryId, channelId, pdfId } = await params;
  const supabase = createClient();
  const { data: { user }, error: userError } = await getUserWithRetry(supabase);
  if (userError) console.warn('[api/pdf-file] getUser failed:', userError.message ?? String(userError));
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Verify the user is a member of this library
  const { data: membership, error: membershipError } = await supabase
    .from('library_members')
    .select('role')
    .eq('library_id', libraryId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (membershipError) {
    console.error('[api/pdf-file] membership lookup failed', { libraryId, pdfId, error: membershipError.message });
    return NextResponse.json({ error: membershipError.message }, { status: 500 });
  }
  if (!membership) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  const db = createAdminClient() ?? supabase;

  // Primary lookup: PDF in the specified channel (normal case)
  let pdf: { id: string; room_id: string; filename: string; storage_path: string | null } | null = null;

  const { data: primaryPdf, error: primaryError } = await db
    .from(PDF_TABLE)
    .select('id, room_id, filename, storage_path')
    .eq('id', pdfId)
    .eq('room_id', channelId)
    .maybeSingle();

  if (primaryError) {
    console.error('[api/pdf-file] primary lookup failed', { pdfId, error: primaryError.message });
    return NextResponse.json({ error: primaryError.message }, { status: 500 });
  }

  if (primaryPdf) {
    pdf = primaryPdf;
  } else {
    // Cross-room fallback: the PDF may belong to a different room in the same library.
    // This happens when a follower opens a PDF from a room they're not currently in.
    // We verify the PDF's room is still in this library before serving it.
    const { data: fallbackPdf, error: fallbackError } = await db
      .from(PDF_TABLE)
      .select('id, room_id, filename, storage_path, rooms!inner(library_id)')
      .eq('id', pdfId)
      .eq('rooms.library_id', libraryId)
      .maybeSingle();

    if (fallbackError) {
      console.error('[api/pdf-file] fallback lookup failed', { pdfId, error: fallbackError.message });
    } else if (fallbackPdf) {
      pdf = fallbackPdf as any;
      console.log('[api/pdf-file] cross-room fallback: serving PDF from room', fallbackPdf.room_id);
    }
  }

  if (!pdf?.storage_path) {
    console.warn('[api/pdf-file] PDF not found or missing storage path', { libraryId, channelId, pdfId });
    return NextResponse.json({ error: 'Shared PDF file is not available' }, { status: 404 });
  }

  const { data, error } = await db.storage.from(PDF_BUCKET).download(pdf.storage_path);
  if (error || !data) {
    console.error('[api/pdf-file] storage download failed', {
      pdfId,
      storagePath: pdf.storage_path,
      error: error?.message ?? 'No data returned',
    });
    return NextResponse.json({ error: error?.message ?? 'Failed to load PDF file' }, { status: 404 });
  }

  return new NextResponse(data.stream(), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${encodeURIComponent(pdf.filename ?? 'document.pdf')}"`,
      'Cache-Control': 'private, max-age=300',
    },
  });
}
