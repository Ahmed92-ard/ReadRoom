// app/api/libraries/[libraryId]/channels/[channelId]/route.ts — Canonical. Uses rooms table.
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

type Params = { libraryId: string; channelId: string };

export async function PATCH(
  req: Request,
  { params }: { params: Promise<Params> | Params }
) {
  const { libraryId, channelId } = await params;
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
  const updates: Record<string, any> = {};

  if (body?.currentPage !== undefined) {
    const p = Number(body.currentPage);
    if (Number.isInteger(p) && p >= 1) updates.current_page = p;
  }
  if (body?.scrollPct !== undefined) {
    const s = Number(body.scrollPct);
    if (Number.isFinite(s)) updates.scroll_pct = Math.min(1, Math.max(0, s));
  }
  if (body?.zoom !== undefined) {
    const z = Number(body.zoom);
    if (Number.isFinite(z)) updates.zoom = Math.min(3, Math.max(0.5, z));
  }
  if (body?.currentPdfId !== undefined) updates.current_pdf_id = body.currentPdfId;

  if (['owner', 'admin'].includes(membership.role)) {
    if (body?.name !== undefined) {
      const n = String(body.name).trim().slice(0, 64).toLowerCase().replace(/\s+/g, '-');
      if (n) updates.name = n;
    }
    if (body?.description !== undefined) {
      updates.description = body.description === null ? null : String(body.description).trim().slice(0, 256);
    }
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid updates' }, { status: 400 });
  }

  const { data: channel, error } = await supabase
    .from('rooms')
    .update(updates)
    .eq('id', channelId)
    .eq('library_id', libraryId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ channel: { ...channel, server_id: channel.library_id } });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<Params> | Params }
) {
  const { libraryId, channelId } = await params;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: membership } = await supabase
    .from('library_members')
    .select('role')
    .eq('library_id', libraryId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const { error } = await supabase
    .from('rooms')
    .delete()
    .eq('id', channelId)
    .eq('library_id', libraryId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
