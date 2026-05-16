// app/api/servers/[id]/channels/[channelId]/route.ts
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string; channelId: string }> | { id: string; channelId: string } }
) {
  const resolvedParams = await params;
  const { id: serverId, channelId } = resolvedParams;

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: membership } = await supabase
    .from('server_members')
    .select('role')
    .eq('server_id', serverId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!membership) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  const body = await req.json();
  const updates: Record<string, any> = {};

  if (body.pdfDriveId !== undefined) updates.pdf_drive_id = body.pdfDriveId;
  if (body.pdfName !== undefined) updates.pdf_name = body.pdfName;
  if (body.pdfUrl !== undefined) updates.pdf_url = body.pdfUrl;
  if (body.currentPage !== undefined) {
    const currentPage = Number(body.currentPage);
    if (Number.isInteger(currentPage) && currentPage >= 1) updates.current_page = currentPage;
  }
  if (body.scrollPct !== undefined) {
    const scrollPct = Number(body.scrollPct);
    if (Number.isFinite(scrollPct)) updates.scroll_pct = Math.min(1, Math.max(0, scrollPct));
  }
  if (body.zoom !== undefined) {
    const zoom = Number(body.zoom);
    if (Number.isFinite(zoom)) updates.zoom = Math.min(3, Math.max(0.5, zoom));
  }
  
  if (['owner', 'admin'].includes(membership.role)) {
    if (body.name !== undefined) {
      const name = String(body.name).trim().slice(0, 64).toLowerCase().replace(/\s+/g, '-');
      if (name) updates.name = name;
    }
    if (body.description !== undefined) updates.description = body.description === null ? null : String(body.description).trim().slice(0, 256);
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid updates provided' }, { status: 400 });
  }

  const { data: channel, error } = await supabase
    .from('channels')
    .update(updates)
    .eq('id', channelId)
    .eq('server_id', serverId)
    .select()
    .single();

  if (error) {
    console.error('[api/channel/patch] Update failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ channel });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; channelId: string }> | { id: string; channelId: string } }
) {
  const resolvedParams = await params;
  const { id: serverId, channelId } = resolvedParams;

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: membership } = await supabase
    .from('server_members')
    .select('role')
    .eq('server_id', serverId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const { error } = await supabase
    .from('channels')
    .delete()
    .eq('id', channelId)
    .eq('server_id', serverId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
