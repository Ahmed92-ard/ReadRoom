// app/api/libraries/[libraryId]/channels/[channelId]/pdfs/upload/route.ts
// Local device file upload — accepts multipart/form-data with a PDF file.
// Supports single files and folder uploads (multiple files with relative paths).
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { sendPushToRoomParticipants } from '@/lib/backend/push';
import {
  buildPdfStoragePath,
  getDbClient,
  getUserWithRetry,
  PDF_BUCKET,
  PDF_TABLE,
  requireLibraryMember,
  requireRoomInLibrary,
  sanitizePdfFilename,
  serializeRoomPdf,
} from '@/lib/backend/readroom';

export const runtime = 'nodejs';

type Params = { libraryId: string; channelId: string };

function fileBasename(name: string) {
  return name.split(/[\\/]/).pop() || name;
}

export async function POST(
  req: Request,
  { params }: { params: Promise<Params> | Params }
) {
  const { libraryId, channelId } = await params;

  const supabase = createClient();
  const { data: { user }, error: userError } = await getUserWithRetry(supabase);
  if (userError) console.warn('[upload] getUser failed:', userError);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { membership, error: memberError } = await requireLibraryMember(supabase, libraryId, user.id);
  if (memberError) return NextResponse.json({ error: memberError.message }, { status: 500 });
  if (!membership) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  const db = getDbClient(supabase);
  const { data: room, error: roomError } = await requireRoomInLibrary(db, libraryId, channelId);
  if (roomError) return NextResponse.json({ error: roomError.message }, { status: 500 });
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const file = formData.get('file') as File | null;
  const folderId = formData.get('folderId') as string | null;

  if (!file || file.size === 0) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    return NextResponse.json({ error: 'Only PDF files are supported' }, { status: 400 });
  }
  if (file.size > 100 * 1024 * 1024) {
    return NextResponse.json({ error: 'File too large (max 100 MB)' }, { status: 400 });
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
  const { data: existing } = await posQuery;
  const nextPosition = (existing?.[0]?.position ?? -1) + 1;

  // Upload to Supabase Storage
  const pdfId = crypto.randomUUID();
  const storagePath = buildPdfStoragePath(libraryId, channelId, pdfId);
  const bytes = await file.arrayBuffer();

  const { error: uploadError } = await db.storage
    .from(PDF_BUCKET)
    .upload(storagePath, bytes, { contentType: 'application/pdf', upsert: false });

  if (uploadError) {
    console.error('[upload] storage upload failed:', uploadError);
    return NextResponse.json({
      error: uploadError.message,
      hint: 'Ensure the "room-pdfs" Supabase Storage bucket exists (run 001_canonical_schema.sql).',
    }, { status: 500 });
  }

  const filename = sanitizePdfFilename(fileBasename(file.name));

  const { data: pdf, error: insertError } = await db
    .from(PDF_TABLE)
    .insert({
      id: pdfId,
      room_id: channelId,
      drive_id: `local:${pdfId}`,
      filename,
      thumbnail_url: null,
      storage_path: storagePath,
      size_bytes: file.size,
      uploader_id: user.id,
      position: nextPosition,
      folder_id: folderId ?? null,
    })
    .select()
    .single();

  if (insertError) {
    await db.storage.from(PDF_BUCKET).remove([storagePath]).catch(() => {});
    console.error('[upload] insert failed:', insertError);
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // Set as current PDF if first one in room
  await db
    .from('rooms')
    .update({ current_pdf_id: pdf.id })
    .eq('id', channelId)
    .is('current_pdf_id', null);

  const { data: profile } = await db
    .from('users')
    .select('display_name')
    .eq('id', user.id)
    .maybeSingle();

  const pdfPushPayload = {
    title: `New document in #Room 📄`,
    body: `${profile?.display_name || user.email?.split('@')[0] || 'Someone'} uploaded "${pdf.filename || 'a document'}"`,
    icon: '/icons/app_icon_192.png',
    badge: '/icons/app_icon_192.png',
    data: {
      url: `/libraries/${libraryId}/channels/${channelId}`,
      roomId: channelId,
      notificationType: 'pdf_added' as const,
      senderName: profile?.display_name || 'System'
    }
  };
  sendPushToRoomParticipants(channelId, user.id, pdfPushPayload, false);

  return NextResponse.json({ pdf: serializeRoomPdf(pdf, libraryId) }, { status: 201 });
}
