// app/api/libraries/[libraryId]/channels/[channelId]/pdfs/route.ts
// GET: list PDFs for a room.
// All uploads go through /pdfs/upload (multipart form).
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import {
  getDbClient,
  getUserWithRetry,
  isMissingPdfTable,
  PDF_TABLE,
  requireLibraryMember,
  requireRoomInLibrary,
  serializeRoomPdf,
} from '@/lib/backend/readroom';

export const runtime = 'nodejs';

type Params = { libraryId: string; channelId: string };

export async function GET(
  _req: Request,
  { params }: { params: Promise<Params> | Params }
) {
  const { libraryId, channelId } = await params;

  const supabase = createClient();
  const { data: { user }, error: userError } = await getUserWithRetry(supabase);
  if (userError) console.warn('[api/pdfs] getUser failed:', String(userError));
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const db = getDbClient(supabase);

  const { membership, error: membershipError } = await requireLibraryMember(supabase, libraryId, user.id);
  if (membershipError) return NextResponse.json({ error: membershipError.message }, { status: 500 });
  if (!membership) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  const { data: room, error: roomError } = await requireRoomInLibrary(db, libraryId, channelId);
  if (roomError) return NextResponse.json({ error: roomError.message }, { status: 500 });
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

  const { data: pdfs, error } = await db
    .from(PDF_TABLE)
    .select('*')
    .eq('room_id', channelId)
    .order('position', { ascending: true });

  if (error) {
    if (isMissingPdfTable(error)) return NextResponse.json({ pdfs: [] });
    return NextResponse.json({ error: error.message, code: error.code }, { status: 500 });
  }

  return NextResponse.json({ pdfs: (pdfs ?? []).map((pdf) => serializeRoomPdf(pdf, libraryId)) });
}
