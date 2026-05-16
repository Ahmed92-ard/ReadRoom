// app/api/servers/route.ts
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: memberships, error } = await supabase
    .from('server_members')
    .select('server_id, role, servers(*)')
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const servers = memberships?.map((m: any) => ({ ...m.servers, role: m.role })) ?? [];
  return NextResponse.json({ servers });
}

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    console.error('[api/servers] POST: Unauthorized');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch (e) {
    console.error('[api/servers] POST: Failed to parse request body');
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { name } = body;
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  const inviteCode = Math.random().toString(36).substring(2, 10).toUpperCase();

  console.log('[api/servers] POST: Creating server for user', user.id);

  const { data: server, error: serverError } = await supabase
    .from('servers')
    .insert({ 
      name: name.trim().slice(0, 64), 
      owner_id: user.id, 
      invite_code: inviteCode 
    })
    .select()
    .single();

  if (serverError) {
    console.error('[api/servers] POST: Server creation failed:', serverError);
    return NextResponse.json({ error: serverError.message }, { status: 500 });
  }

  console.log('[api/servers] POST: Server created', server.id, '- Adding owner...');

  // Add owner as member
  const { error: memberError } = await supabase.from('server_members').insert({
    server_id: server.id,
    user_id: user.id,
    role: 'owner',
  });

  if (memberError) {
    console.error('[api/servers] POST: Member addition failed:', memberError);
    return NextResponse.json({ error: memberError.message }, { status: 500 });
  }

  console.log('[api/servers] POST: Creating general channel...');

  // Create a default "general" channel
  const { error: channelError } = await supabase.from('channels').insert({
    server_id: server.id,
    name: 'general',
    type: 'text',
    position: 0,
  });

  if (channelError) {
    console.error('[api/servers] POST: Channel creation failed:', channelError);
    return NextResponse.json({ error: channelError.message }, { status: 500 });
  }

  console.log('[api/servers] POST: Success');
  return NextResponse.json({ server });
}

export async function PATCH(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const serverId = body?.serverId;
  const name = String(body?.name ?? '').trim();

  if (!serverId) return NextResponse.json({ error: 'Server ID is required' }, { status: 400 });
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  const { data: membership } = await supabase
    .from('server_members')
    .select('role')
    .eq('server_id', serverId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const { data: server, error } = await supabase
    .from('servers')
    .update({ name: name.slice(0, 64) })
    .eq('id', serverId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ server });
}

export async function DELETE(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body;
  try {
    body = await req.json();
  } catch (e) {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { serverId } = body;
  if (!serverId) return NextResponse.json({ error: 'Server ID is required' }, { status: 400 });

  // Check if user is the owner
  const { data: server } = await supabase
    .from('servers')
    .select('owner_id')
    .eq('id', serverId)
    .single();

  if (!server) return NextResponse.json({ error: 'Server not found' }, { status: 404 });
  if (server.owner_id !== user.id) return NextResponse.json({ error: 'Only the owner can delete a server' }, { status: 403 });

  // Delete server (cascades to channels, messages, etc.)
  const { error } = await supabase
    .from('servers')
    .delete()
    .eq('id', serverId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
