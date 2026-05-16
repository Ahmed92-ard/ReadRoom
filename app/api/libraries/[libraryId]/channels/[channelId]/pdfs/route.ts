// app/api/libraries/[libraryId]/channels/[channelId]/pdfs/route.ts — Canonical.
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import {
  buildPdfStoragePath,
  getDbClient,
  getUserWithRetry,
  isMissingPdfTable,
  PDF_BUCKET,
  PDF_TABLE,
  requireLibraryMember,
  requireRoomInLibrary,
  sanitizePdfFilename,
  serializeRoomPdf,
} from '@/lib/backend/readroom';

export const runtime = 'nodejs';

type Params = { libraryId: string; channelId: string };

export async function GET(
  req: Request,
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

export async function POST(
  req: Request,
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

  const body = await req.json().catch(() => null);
  const driveId = String(body?.driveId ?? '').trim();
  const filename = String(body?.filename ?? '').trim();
  const thumbnailUrl = body?.thumbnailUrl ? String(body.thumbnailUrl) : null;
  const driveAccessToken = body?.driveAccessToken ? String(body.driveAccessToken) : null;
  const folderId = body?.folderId ? String(body.folderId) : null;

  if (!driveId || !filename) {
    return NextResponse.json({ error: 'driveId and filename are required' }, { status: 400 });
  }
  if (!driveAccessToken) {
    return NextResponse.json({
      error: 'Drive authorization is required to add a shared room PDF',
      hint: 'Authorize Google Drive again so the room can copy the PDF into shared storage.',
    }, { status: 401 });
  }

  // Validate folder if provided
  if (folderId) {
    const { data: folder } = await db
      .from('pdf_folders')
      .select('id')
      .eq('id', folderId)
      .eq('room_id', channelId)
      .maybeSingle();
    if (!folder) return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
  }

  // Get next position
  let posQuery = db
    .from(PDF_TABLE)
    .select('position')
    .eq('room_id', channelId)
    .order('position', { ascending: false })
    .limit(1);
  posQuery = folderId ? posQuery.eq('folder_id', folderId) : posQuery.is('folder_id', null);
  const { data: existing, error: posError } = await posQuery;

  if (posError) {
    if (isMissingPdfTable(posError)) {
      return NextResponse.json({ error: 'Run 001_canonical_schema.sql to set up the database.' }, { status: 501 });
    }
    return NextResponse.json({ error: posError.message }, { status: 500 });
  }

  const nextPosition = (existing?.[0]?.position ?? -1) + 1;

  // Fetch PDF bytes from Google Drive
  const driveRes = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveId)}?alt=media`,
    { headers: { Authorization: `Bearer ${driveAccessToken}` } }
  );

  if (!driveRes.ok) {
    return NextResponse.json({
      error: `Failed to copy PDF from Google Drive (${driveRes.status})`,
      hint: 'Re-authorize Drive access and try adding the PDF again.',
    }, { status: driveRes.status === 401 ? 401 : 502 });
  }

  const bytes = Buffer.from(await driveRes.arrayBuffer());
  const pdfId = crypto.randomUUID();
  const storagePath = buildPdfStoragePath(libraryId, channelId, pdfId);

  const { error: uploadError } = await db.storage
    .from(PDF_BUCKET)
    .upload(storagePath, bytes, { contentType: 'application/pdf', upsert: false });

  if (uploadError) {
    console.error('[api/pdfs] storage upload failed:', uploadError);
    return NextResponse.json({
      error: uploadError.message,
      hint: 'Ensure the "room-pdfs" Supabase Storage bucket exists (run 001_canonical_schema.sql).',
    }, { status: 500 });
  }

  const { data: pdf, error: insertError } = await db
    .from(PDF_TABLE)
    .insert({
      id: pdfId,
      room_id: channelId,
      drive_id: driveId,
      filename: sanitizePdfFilename(filename),
      thumbnail_url: thumbnailUrl,
      storage_path: storagePath,
      size_bytes: bytes.byteLength,
      uploader_id: user.id,
      position: nextPosition,
      folder_id: folderId,
    })
    .select()
    .single();

  if (insertError) {
    await db.storage.from(PDF_BUCKET).remove([storagePath]).catch(() => {});
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // Set as current PDF if room has none yet
  await db
    .from('rooms')
    .update({ current_pdf_id: pdf.id })
    .eq('id', channelId)
    .is('current_pdf_id', null);

  return NextResponse.json({ pdf: serializeRoomPdf(pdf, libraryId) });
}
