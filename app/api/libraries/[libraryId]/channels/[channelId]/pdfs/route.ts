// app/api/libraries/[libraryId]/channels/[channelId]/pdfs/route.ts
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
const PDF_BUCKET = 'room-pdfs';

function serializePdf(pdf: any) {
  return {
    id: pdf.id,
    channelId: pdf.channel_id,
    driveId: pdf.drive_id,
    filename: pdf.filename,
    thumbnailUrl: pdf.thumbnail_url ?? null,
    storagePath: pdf.storage_path ?? null,
    url: pdf.storage_path ? `/api/libraries/${pdf.server_id ?? ''}/channels/${pdf.channel_id}/pdfs/${pdf.id}/file` : null,
    position: pdf.position ?? 0,
    createdAt: pdf.created_at,
  };
}

function serializePdfForRoute(pdf: any, libraryId: string) {
  const serialized = serializePdf(pdf);
  return {
    ...serialized,
    url: pdf.storage_path
      ? `/api/libraries/${libraryId}/channels/${pdf.channel_id}/pdfs/${pdf.id}/file`
      : null,
  };
}

function isMissingPdfLibrary(error: any) {
  const message = String(error?.message ?? '');
  return error?.code === '42P01' ||
    error?.code === '42703' ||
    message.includes('channel_pdfs') ||
    message.includes('current_pdf_id');
}

async function getUserWithRetry(supabase: ReturnType<typeof createClient>) {
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
  const db = createAdminClient() ?? supabase;

  // Verify user is a member of the library
  const { data: membership, error: membershipError } = await supabase
    .from('server_members')
    .select('role')
    .eq('server_id', libraryId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (membershipError) return NextResponse.json({ error: membershipError.message }, { status: 500 });
  if (!membership) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  // Get all PDFs for this channel
  const { data: pdfs, error } = await db
    .from('channel_pdfs')
    .select('*')
    .eq('channel_id', channelId)
    .order('position', { ascending: true });

  if (error) {
    const status = isMissingPdfLibrary(error) ? 501 : 500;
    return NextResponse.json({
      error: error.message,
      code: error.code,
      hint: isMissingPdfLibrary(error)
        ? 'Run Supabase migration 005_multiple_pdfs.sql to create channel_pdfs/current_pdf_id.'
        : undefined,
    }, { status });
  }

  return NextResponse.json({ pdfs: (pdfs ?? []).map((pdf) => serializePdfForRoute(pdf, libraryId)) });
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
  const db = createAdminClient() ?? supabase;

  // Verify user is a member of the library. After this point use the admin
  // client when available so RLS policy drift cannot block metadata writes.
  const { data: membership, error: membershipError } = await supabase
    .from('server_members')
    .select('role')
    .eq('server_id', libraryId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (membershipError) return NextResponse.json({ error: membershipError.message }, { status: 500 });
  if (!membership) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  const { data: channel, error: channelError } = await db
    .from('channels')
    .select('id, server_id')
    .eq('id', channelId)
    .eq('server_id', libraryId)
    .maybeSingle();

  if (channelError) return NextResponse.json({ error: channelError.message }, { status: 500 });
  if (!channel) return NextResponse.json({ error: 'Channel not found' }, { status: 404 });

  const body = await req.json();
  const driveId = String(body?.driveId ?? '').trim();
  const filename = String(body?.filename ?? '').trim();
  const thumbnailUrl = body?.thumbnailUrl ? String(body.thumbnailUrl) : null;
  const driveAccessToken = body?.driveAccessToken ? String(body.driveAccessToken) : null;

  if (!driveId || !filename) {
    return NextResponse.json({ error: 'driveId and filename are required' }, { status: 400 });
  }

  if (!driveAccessToken) {
    return NextResponse.json({
      error: 'Drive authorization is required to add a shared room PDF',
      hint: 'Authorize Google Drive again so the room can copy the PDF into shared storage.',
    }, { status: 401 });
  }

  // Get the next position
  const { data: pdfs, error: positionError } = await db
    .from('channel_pdfs')
    .select('position')
    .eq('channel_id', channelId)
    .order('position', { ascending: false })
    .limit(1);

  if (positionError) {
    const status = isMissingPdfLibrary(positionError) ? 501 : 500;
    return NextResponse.json({
      error: positionError.message,
      code: positionError.code,
      hint: isMissingPdfLibrary(positionError)
        ? 'Run Supabase migration 005_multiple_pdfs.sql to create channel_pdfs/current_pdf_id.'
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
  storagePath = `${libraryId}/${channelId}/${crypto.randomUUID()}.pdf`;

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
      hint: 'Create the private Supabase Storage bucket "room-pdfs" or rerun migration 005_multiple_pdfs.sql.',
    }, { status: 500 });
  }

  // Insert the new PDF
  const { data: pdf, error } = await db
    .from('channel_pdfs')
    .insert({
      channel_id: channelId,
      drive_id: driveId,
      filename,
      thumbnail_url: thumbnailUrl,
      storage_path: storagePath,
      size_bytes: sizeBytes,
      uploader_id: user.id,
      position: nextPosition,
    })
    .select()
    .single();

  if (error) {
    const status = isMissingPdfLibrary(error) ? 501 : 500;
    return NextResponse.json({
      error: error.message,
      code: error.code,
      hint: isMissingPdfLibrary(error)
        ? 'Run Supabase migration 005_multiple_pdfs.sql to create channel_pdfs/current_pdf_id.'
        : undefined,
    }, { status });
  }

  await db
    .from('channels')
    .update({ current_pdf_id: pdf.id })
    .eq('id', channelId)
    .is('current_pdf_id', null);

  return NextResponse.json({ pdf: serializePdfForRoute(pdf, libraryId) });
}
