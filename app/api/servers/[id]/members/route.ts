// app/api/servers/[id]/members/route.ts
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const serverId = params.id;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Verify requester is a member of the server
  const { data: membership, error: memError } = await supabase
    .from('server_members')
    .select('role')
    .eq('server_id', serverId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (memError || !membership) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  // Fetch all members with their user details
  const { data: members, error } = await supabase
    .from('server_members')
    .select(`
      role,
      joined_at,
      user_id,
      users:user_id (
        id,
        email,
        display_name,
        avatar_url
      )
    `)
    .eq('server_id', serverId);

  if (error) {
    console.error('[api/members] GET failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ members });
}
