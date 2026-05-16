// app/api/libraries/[libraryId]/channels/[channelId]/pdfs/route.ts
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import {
  buildPdfStoragePath,
  getDbClient,
  getUserWithRetry,
  isMissingPdfLibrary,
  PDF_BUCKET,
  PDF_TABLE,
  requireLibraryMember,
  requireRoomInLibrary,
  sanitizePdfFilename,
  serializeRoomPdf,
} from '@/lib/backend/readroom';

export const runtime = 'nodejs';

export async function GET(
  req: Request,
  { params }: { params: Promise<{ libraryId: string; channelId: string }> | { libraryId: string; channelId: string } }
) {
  const resolvedParams = await params;
  const { libraryId, channelId } = resolvedParams;

  const supabase = createClient();
  const { data: { user }, error: userError } = await getUserWithRetry(supabase);
  if (userError) console.warn('[api/pdfs] getUser failed:', userError.message ?? String(userError));
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
    const status = isMissingPdfLibrary(error) ? 501 : 500;
    return NextResponse.json({
      error: error.message,
      code: error.code,
      hint: isMissingPdfLibrary(error)
        ? 'Run Supabase migrations through 009_backend_storage_stabilization.sql in order.'
        : undefined,
    }, { status });
  }

  return NextResponse.json({ pdfs: (pdfs ?? []).map((pdf) => serializeRoomPdf(pdf, libraryId)) });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ libraryId: string; channelId: string }> | { libraryId: string; channelId: string } }
) {
  const resolvedParams = await params;
  const { libraryId, channelId } = resolvedParams;

  const supabase = createClient();
  const { data: { user }, error: userError } = await getUserWithRetry(supabase);
  if (userError) console.warn('[api/pdfs] getUser failed:', userError.message ?? String(userError));
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const db = getDbClient(supabase);

  const { membership, error: membershipError } = await requireLibraryMember(supabase, libraryId, user.id);
  if (membershipError) return NextResponse.json({ error: membershipError.message }, { status: 500 });
  if (!membership) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  const { data: channel, error: channelError } = await requireRoomInLibrary(db, libraryId, channelId);

  if (channelError) return NextResponse.json({ error: channelError.message }, { status: 500 });
  if (!channel) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

  const body = await req.json();
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

  if (folderId) {
    const { data: folder } = await db
      .from('pdf_folders')
      .select('id')
      .eq('id', folderId)
      .eq('room_id', channelId)
      .maybeSingle();
    if (!folder) return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
  }

  // Get the next position
  let positionQuery = db
    .from(PDF_TABLE)
    .select('position')
    .eq('room_id', channelId)
    .order('position', { ascending: false })
    .limit(1);
  positionQuery = folderId ? positionQuery.eq('folder_id', folderId) : positionQuery.is('folder_id', null);
  const { data: pdfs, error: positionError } = await positionQuery;

  if (positionError) {
    const status = isMissingPdfLibrary(positionError) ? 501 : 500;
    return NextResponse.json({
      error: positionError.message,
      code: positionError.code,
      hint: isMissingPdfLibrary(positionError)
        ? 'Run Supabase migrations through 009_backend_storage_stabilization.sql in order.'
        : undefined,
    }, { status });
  }

  const nextPosition = (pdfs?.[0]?.position ?? -1) + 1;
  let storagePath: string | null = null;
  let sizeBytes: number | null = null;

  const driveRes = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(driveId)}?alt=media`, {
    headers: { Authorization: `Bearer ${driveAccessToken}` },
  });

  if (!driveRes.ok) {
    console.error('[api/pdfs] Drive copy failed', { libraryId, channelId, driveId, status: driveRes.status });
    return NextResponse.json({
      error: `Failed to copy PDF from Google Drive (${driveRes.status})`,
      hint: 'Re-authorize Drive access and try adding the PDF again.',
    }, { status: driveRes.status === 401 ? 401 : 502 });
  }

  const bytes = Buffer.from(await driveRes.arrayBuffer());
  sizeBytes = bytes.byteLength;
  const pdfId = crypto.randomUUID();
  storagePath = buildPdfStoragePath(libraryId, channelId, pdfId);

  const { error: uploadError } = await db.storage
    .from(PDF_BUCKET)
    .upload(storagePath, bytes, {
      contentType: 'application/pdf',
      upsert: false,
    });

  if (uploadError) {
    console.error('[api/pdfs] shared storage upload failed', { libraryId, channelId, driveId, storagePath, error: uploadError.message });
    return NextResponse.json({
      error: uploadError.message,
      hint: 'Create the private Supabase Storage bucket "room-pdfs" or run migration 009_backend_storage_stabilization.sql.',
    }, { status: 500 });
  }

  const { data: pdf, error } = await db
    .from(PDF_TABLE)
    .insert({
      id: pdfId,
      room_id: channelId,
      drive_id: driveId,
      filename: sanitizePdfFilename(filename),
      thumbnail_url: thumbnailUrl,
      storage_path: storagePath,
      size_bytes: sizeBytes,
      uploader_id: user.id,
      position: nextPosition,
      folder_id: folderId,
    })
    .select()
    .single();

  if (error) {
    if (storagePath) await db.storage.from(PDF_BUCKET).remove([storagePath]).catch(() => {});
    const status = isMissingPdfLibrary(error) ? 501 : 500;
    return NextResponse.json({
      error: error.message,
      code: error.code,
      hint: isMissingPdfLibrary(error)
        ? 'Run Supabase migrations through 009_backend_storage_stabilization.sql in order.'
        : undefined,
    }, { status });
  }

  await db
    .from('rooms')
    .update({ current_pdf_id: pdf.id })
    .eq('id', channelId)
    .is('current_pdf_id', null);

  return NextResponse.json({ pdf: serializeRoomPdf(pdf, libraryId) });
}
