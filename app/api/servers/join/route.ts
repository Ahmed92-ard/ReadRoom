// app/api/servers/join/route.ts
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { inviteCode } = await req.json();
  if (!inviteCode) return NextResponse.json({ error: 'Invite code required' }, { status: 400 });

  const { data: server, error } = await supabase
    .from('servers')
    .select('*')
    .eq('invite_code', inviteCode.trim().toUpperCase())
    .single();

  if (error || !server) return NextResponse.json({ error: 'Invalid invite code' }, { status: 404 });

  // Check if already a member
  const { data: existing } = await supabase
    .from('server_members')
    .select('user_id')
    .eq('server_id', server.id)
    .eq('user_id', user.id)
    .single();

  if (!existing) {
    await supabase.from('server_members').insert({
      server_id: server.id,
      user_id: user.id,
      role: 'member',
    });
  }

  return NextResponse.json({ server });
}
