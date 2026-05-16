import { createAdminClient, createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { getUserWithRetry, PDF_BUCKET, PDF_TABLE, requireRoomInLibrary } from '@/lib/backend/readroom';

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

  const { data: membership, error: membershipError } = await supabase
    .from('library_members')
    .select('role')
    .eq('library_id', libraryId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (membershipError) {
    console.error('[api/pdf-file] membership lookup failed', { libraryId, channelId, pdfId, error: membershipError.message });
    return NextResponse.json({ error: membershipError.message }, { status: 500 });
  }
  if (!membership) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  const db = createAdminClient() ?? supabase;
  const { data: room, error: roomError } = await requireRoomInLibrary(db, libraryId, channelId);
  if (roomError) return NextResponse.json({ error: roomError.message }, { status: 500 });
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

  const { data: pdf, error: pdfError } = await db
    .from(PDF_TABLE)
    .select('id, room_id, filename, storage_path')
    .eq('id', pdfId)
    .eq('room_id', channelId)
    .maybeSingle();

  if (pdfError) {
    console.error('[api/pdf-file] pdf metadata lookup failed', { libraryId, channelId, pdfId, error: pdfError.message });
    return NextResponse.json({ error: pdfError.message }, { status: 500 });
  }
  if (!pdf?.storage_path) {
    console.warn('[api/pdf-file] missing storage path', { libraryId, channelId, pdfId });
    return NextResponse.json({ error: 'Shared PDF file is not available' }, { status: 404 });
  }

  const { data, error } = await db.storage.from(PDF_BUCKET).download(pdf.storage_path);
  if (error || !data) {
    console.error('[api/pdf-file] storage download failed', {
      libraryId,
      channelId,
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
