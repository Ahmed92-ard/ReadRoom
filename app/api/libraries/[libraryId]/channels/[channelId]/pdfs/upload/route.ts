// Local file upload endpoint — accepts multipart/form-data with a PDF file.
import { NextResponse } from 'next/server';
import {
  buildPdfStoragePath,
  getDbClient,
  getUserWithRetry,
  MAX_PDF_BYTES,
  PDF_BUCKET,
  PDF_TABLE,
  requireLibraryMember,
  requireRoomInLibrary,
  sanitizePdfFilename,
  serializeRoomPdf,
} from '@/lib/backend/readroom';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

type Params = { libraryId: string; channelId: string };

export async function POST(
  req: Request,
  { params }: { params: Promise<Params> | Params }
) {
  const { libraryId, channelId } = await params;

  const supabase = createClient();
  const { data: { user }, error: userError } = await getUserWithRetry(supabase);
  if (userError) console.warn('[api/pdfs/upload] getUser failed:', userError.message ?? String(userError));
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { membership, error: membershipError } = await requireLibraryMember(supabase, libraryId, user.id);
  if (membershipError) return NextResponse.json({ error: membershipError.message }, { status: 500 });
  if (!membership) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  // Parse multipart form
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const file = formData.get('file') as File | null;
  const folderId = formData.get('folderId') ? String(formData.get('folderId')) : null;
  if (!file || file.size === 0) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    return NextResponse.json({ error: 'Only PDF files are supported' }, { status: 400 });
  }

  if (file.size > MAX_PDF_BYTES) {
    return NextResponse.json({ error: `File too large (max ${MAX_PDF_BYTES / 1024 / 1024} MB)` }, { status: 400 });
  }

  const db = getDbClient(supabase);

  const { data: room, error: roomError } = await requireRoomInLibrary(db, libraryId, channelId);
  if (roomError) return NextResponse.json({ error: roomError.message }, { status: 500 });
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

  // Get next position
  if (folderId) {
    const { data: folder } = await db
      .from('pdf_folders')
      .select('id')
      .eq('id', folderId)
      .eq('room_id', channelId)
      .maybeSingle();
    if (!folder) return NextResponse.json({ error: 'Folder not found' }, { status: 404 });
  }

  let positionQuery = db
    .from(PDF_TABLE)
    .select('position')
    .eq('room_id', channelId)
    .order('position', { ascending: false })
    .limit(1);
  positionQuery = folderId ? positionQuery.eq('folder_id', folderId) : positionQuery.is('folder_id', null);
  const { data: existing } = await positionQuery;

  const nextPosition = (existing?.[0]?.position ?? -1) + 1;

  // Upload to Supabase Storage
  const pdfId = crypto.randomUUID();
  const bytes = await file.arrayBuffer();
  const storagePath = buildPdfStoragePath(libraryId, channelId, pdfId);

  const { error: uploadError } = await db.storage
    .from(PDF_BUCKET)
    .upload(storagePath, bytes, {
      contentType: 'application/pdf',
      upsert: false,
    });

  if (uploadError) {
    console.error('[api/pdfs/upload] storage upload failed:', uploadError);
    return NextResponse.json({
      error: uploadError.message,
      hint: 'Ensure the private "room-pdfs" Supabase Storage bucket exists and run migration 009_backend_storage_stabilization.sql.',
    }, { status: 500 });
  }

  const filename = sanitizePdfFilename(file.name);

  const { data: pdf, error: insertError } = await db
    .from(PDF_TABLE)
    .insert({
      id: pdfId,
      room_id: channelId,
      drive_id: `local:${crypto.randomUUID()}`, // synthetic drive_id for local uploads
      filename,
      thumbnail_url: null,
      storage_path: storagePath,
      size_bytes: file.size,
      uploader_id: user.id,
      position: nextPosition,
      folder_id: folderId,
    })
    .select()
    .single();

  if (insertError) {
    // Clean up orphaned storage file
    await db.storage.from(PDF_BUCKET).remove([storagePath]).catch(() => {});
    console.error('[api/pdfs/upload] insert failed:', insertError);
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // Set as current PDF if first one
  await db
    .from('rooms')
    .update({ current_pdf_id: pdf.id })
    .eq('id', channelId)
    .is('current_pdf_id', null);

  return NextResponse.json({ pdf: serializeRoomPdf(pdf, libraryId) }, { status: 201 });
}
