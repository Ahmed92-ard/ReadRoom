// app/api/libraries/[libraryId]/channels/[channelId]/pdfs/[pdfId]/route.ts
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

const PDF_BUCKET = 'room-pdfs';

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ libraryId: string; channelId: string; pdfId: string }> | { libraryId: string; channelId: string; pdfId: string } }
) {
  const resolvedParams = await params;
  const { libraryId, channelId, pdfId } = resolvedParams;

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Verify user is admin/owner
  const { data: membership } = await supabase
    .from('library_members')
    .select('role')
    .eq('library_id', libraryId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const db = createAdminClient() ?? supabase;
  const { data: existingPdf } = await db
    .from('channel_pdfs')
    .select('storage_path')
    .eq('id', pdfId)
    .eq('room_id', channelId)
    .maybeSingle();

  // Delete the PDF
  const { error } = await db
    .from('channel_pdfs')
    .delete()
    .eq('id', pdfId)
    .eq('room_id', channelId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // If this was the current PDF, set the next one
  const { data: channel } = await supabase
    .from('rooms')
    .select('current_pdf_id')
    .eq('id', channelId)
    .single();

  if (channel.current_pdf_id === pdfId) {
    const { data: firstPdf } = await supabase
      .from('channel_pdfs')
      .select('id')
      .eq('room_id', channelId)
      .order('position', { ascending: true })
      .limit(1);

    await supabase
      .from('rooms')
      .update({ current_pdf_id: firstPdf?.[0]?.id ?? null })
      .eq('id', channelId);
  }

  if (existingPdf?.storage_path) {
    const { error: storageError } = await db.storage.from(PDF_BUCKET).remove([existingPdf.storage_path]);
    if (storageError) {
      console.warn('[api/pdfs] shared storage cleanup failed', {
        libraryId,
        channelId,
        pdfId,
        storagePath: existingPdf.storage_path,
        error: storageError.message,
      });
    }
  }

  return NextResponse.json({ ok: true });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ libraryId: string; channelId: string; pdfId: string }> | { libraryId: string; channelId: string; pdfId: string } }
) {
  const resolvedParams = await params;
  const { libraryId, channelId, pdfId } = resolvedParams;

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Verify user is a member
  const { data: membership } = await supabase
    .from('library_members')
    .select('role')
    .eq('library_id', libraryId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!membership) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  const body = await req.json();

  // Update channel's current PDF
  if (body.setCurrent) {
    const { error } = await supabase
      .from('rooms')
      .update({ current_pdf_id: pdfId })
      .eq('id', channelId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
