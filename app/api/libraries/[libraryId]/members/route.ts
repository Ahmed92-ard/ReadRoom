// app/api/libraries/[libraryId]/members/route.ts
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ libraryId: string }> | { libraryId: string } }
) {
  const { libraryId } = await params;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Verify requester is a member of the library
  const { data: membership, error: memError } = await supabase
    .from('library_members')
    .select('role')
    .eq('library_id', libraryId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (memError || !membership) {
    return NextResponse.json({ error: 'Access denied' }, { status: 403 });
  }

  // Fetch all members with their user details
  const { data: members, error } = await supabase
    .from('library_members')
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
    .eq('library_id', libraryId);

  if (error) {
    console.error('[api/members] GET failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ members });
}
