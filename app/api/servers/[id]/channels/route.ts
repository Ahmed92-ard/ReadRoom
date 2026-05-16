// app/api/servers/[id]/channels/route.ts
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  const resolvedParams = await params;
  const serverId = resolvedParams.id;
  
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  console.log(`[api/channels] GET: Fetching channels for server ${serverId}`);

  // Verify membership
  const { data: membership, error: memError } = await supabase
    .from('server_members')
    .select('role')
    .eq('server_id', serverId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (memError) {
    console.error('[api/channels] GET: Membership check failed:', memError);
    return NextResponse.json({ error: memError.message }, { status: 500 });
  }

  if (!membership) {
    console.warn(`[api/channels] GET: User ${user.id} is not a member of ${serverId}`);
    return NextResponse.json({ error: 'Not a member' }, { status: 403 });
  }

  const { data: channels, error } = await supabase
    .from('channels')
    .select('*')
    .eq('server_id', serverId)
    .order('position', { ascending: true });

  if (error) {
    console.error('[api/channels] GET: Channel fetch failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ channels });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  const resolvedParams = await params;
  const serverId = resolvedParams.id;

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Must be owner or admin
  const { data: membership, error: memError } = await supabase
    .from('server_members')
    .select('role')
    .eq('server_id', serverId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (memError || !membership || !['owner', 'admin'].includes(membership.role)) {
    console.warn('[api/channels] POST: Access denied or member check failed', { memError, membership });
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const body = await req.json();
  const { name, type = 'pdf', description } = body;
  
  if (!name?.trim()) return NextResponse.json({ error: 'Name required' }, { status: 400 });

  // Get current max position
  const { data: last } = await supabase
    .from('channels')
    .select('position')
    .eq('server_id', serverId)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle();

  const position = (last?.position ?? -1) + 1;

  const { data: channel, error } = await supabase
    .from('channels')
    .insert({
      server_id: serverId,
      name: name.trim().slice(0, 64).toLowerCase().replace(/\s+/g, '-'),
      type,
      description: description?.trim().slice(0, 256) ?? null,
      position,
    })
    .select()
    .single();

  if (error) {
    console.error('[api/channels] POST: Channel creation failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ channel });
}
