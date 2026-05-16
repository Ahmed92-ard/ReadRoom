// app/api/libraries/[libraryId]/channels/[channelId]/pdfs/upload/route.ts
// Local file upload endpoint — accepts multipart/form-data with a PDF file.
// Stores the file in Supabase Storage (same bucket as Drive-imported PDFs).
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const PDF_BUCKET = 'room-pdfs';
const MAX_BYTES = 100 * 1024 * 1024; // 100 MB

type Params = { libraryId: string; channelId: string };

export async function POST(
  req: Request,
  { params }: { params: Promise<Params> | Params }
) {
  const { libraryId, channelId } = await params;

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Verify membership
  const { data: membership } = await supabase
    .from('library_members')
    .select('role')
    .eq('library_id', libraryId)
    .eq('user_id', user.id)
    .maybeSingle();

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

  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File too large (max ${MAX_BYTES / 1024 / 1024} MB)` }, { status: 400 });
  }

  const db = createAdminClient() ?? supabase;

  // Verify channel belongs to library
  const { data: channel } = await db
    .from('rooms')
    .select('id, library_id')
    .eq('id', channelId)
    .eq('library_id', libraryId)
    .maybeSingle();

  if (!channel) return NextResponse.json({ error: 'Channel not found' }, { status: 404 });

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
    .from('channel_pdfs')
    .select('position')
    .eq('room_id', channelId)
    .order('position', { ascending: false })
    .limit(1);
  positionQuery = folderId ? positionQuery.eq('folder_id', folderId) : positionQuery.is('folder_id', null);
  const { data: existing } = await positionQuery;

  const nextPosition = (existing?.[0]?.position ?? -1) + 1;

  // Upload to Supabase Storage
  const bytes = await file.arrayBuffer();
  const storagePath = `${libraryId}/${channelId}/${crypto.randomUUID()}.pdf`;

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
      hint: 'Ensure the "room-pdfs" Supabase Storage bucket exists (run migration 005).',
    }, { status: 500 });
  }

  // Insert channel_pdfs row
  const filename = file.name.replace(/[^\w\s.\-()]/g, '').trim() || 'document.pdf';

  const { data: pdf, error: insertError } = await db
    .from('channel_pdfs')
    .insert({
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

  const serialized = {
    id: pdf.id,
    channelId: pdf.room_id,
    driveId: pdf.drive_id,
    filename: pdf.filename,
    thumbnailUrl: pdf.thumbnail_url ?? null,
    storagePath: pdf.storage_path ?? null,
    url: `/api/libraries/${libraryId}/channels/${channelId}/pdfs/${pdf.id}/file`,
    position: pdf.position ?? 0,
    folderId: pdf.folder_id ?? null,
    createdAt: pdf.created_at,
  };

  return NextResponse.json({ pdf: serialized }, { status: 201 });
}
