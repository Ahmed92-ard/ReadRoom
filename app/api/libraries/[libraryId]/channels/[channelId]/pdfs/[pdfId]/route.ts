// app/api/libraries/[libraryId]/channels/[channelId]/pdfs/[pdfId]/route.ts
// All room members can delete PDFs and set the current PDF.
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { PDF_BUCKET, PDF_TABLE, requireRoomInLibrary } from '@/lib/backend/readroom';

type Params = { libraryId: string; channelId: string; pdfId: string };

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<Params> | Params }
) {
  const { libraryId, channelId, pdfId } = await params;

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Any library member can delete PDFs
  const { data: membership } = await supabase
    .from('library_members')
    .select('role')
    .eq('library_id', libraryId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!membership) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  const db = createAdminClient() ?? supabase;
  const { data: room, error: roomError } = await requireRoomInLibrary(db, libraryId, channelId);
  if (roomError) return NextResponse.json({ error: roomError.message }, { status: 500 });
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

  const { data: existingPdf } = await db
    .from(PDF_TABLE)
    .select('storage_path')
    .eq('id', pdfId)
    .eq('room_id', channelId)
    .maybeSingle();

  const { error } = await db
    .from(PDF_TABLE)
    .delete()
    .eq('id', pdfId)
    .eq('room_id', channelId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Update current_pdf_id if this was the active PDF
  const { data: roomRow } = await supabase
    .from('rooms')
    .select('current_pdf_id')
    .eq('id', channelId)
    .maybeSingle();

  if (roomRow?.current_pdf_id === pdfId) {
    const { data: firstPdf } = await supabase
      .from(PDF_TABLE)
      .select('id')
      .eq('room_id', channelId)
      .order('position', { ascending: true })
      .limit(1);

    await supabase
      .from('rooms')
      .update({ current_pdf_id: firstPdf?.[0]?.id ?? null })
      .eq('id', channelId);
  }

  // Clean up storage file
  if (existingPdf?.storage_path) {
    await db.storage.from(PDF_BUCKET).remove([existingPdf.storage_path]).catch(() => {});
  }

  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<Params> | Params }
) {
  const { libraryId, channelId, pdfId } = await params;

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: membership } = await supabase
    .from('library_members')
    .select('role')
    .eq('library_id', libraryId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!membership) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const db = createAdminClient() ?? supabase;

  if (body?.setCurrent) {
    const { data: pdf } = await db
      .from(PDF_TABLE)
      .select('id')
      .eq('id', pdfId)
      .eq('room_id', channelId)
      .maybeSingle();
    if (!pdf) return NextResponse.json({ error: 'PDF not found' }, { status: 404 });

    const { error } = await db
      .from('rooms')
      .update({ current_pdf_id: pdfId })
      .eq('id', channelId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
