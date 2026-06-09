// app/api/libraries/[libraryId]/channels/route.ts — Canonical. Uses rooms table.
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

type Params = { libraryId: string };

export async function GET(
  _req: Request,
  { params }: { params: Promise<Params> | Params }
) {
  const { libraryId } = await params;
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

  const { data: channels, error } = await supabase
    .from('rooms')
    .select('*')
    .eq('library_id', libraryId)
    .order('position', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Add server_id alias for frontend compat; exclude hidden library chat rooms
  const normalized = (channels ?? [])
    .filter((c) => !c.is_library_chat)
    .map((c) => ({ ...c, server_id: c.library_id }));
  return NextResponse.json({ channels: normalized });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<Params> | Params }
) {
  const { libraryId } = await params;
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

  const body = await req.json().catch(() => null);
  const name = String(body?.name ?? '').trim();
  const type = body?.type === 'text' ? 'text' : 'pdf';
  const description = body?.description ? String(body.description).trim().slice(0, 256) : null;

  if (!name) return NextResponse.json({ error: 'Name required' }, { status: 400 });

  const { data: last } = await supabase
    .from('rooms')
    .select('position')
    .eq('library_id', libraryId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();

  const position = (last?.position ?? -1) + 1;

  const { data: channel, error } = await supabase
    .from('rooms')
    .insert({
      library_id: libraryId,
      name: name.slice(0, 64).toLowerCase().replace(/\s+/g, '-'),
      type,
      description,
      position,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ channel: { ...channel, server_id: channel.library_id } });
}
