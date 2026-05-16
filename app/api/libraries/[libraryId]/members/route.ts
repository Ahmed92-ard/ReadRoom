// app/api/libraries/[libraryId]/members/route.ts — Canonical.
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

  const { data: membership } = await supabase
    .from('library_members')
    .select('role')
    .eq('library_id', libraryId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!membership) return NextResponse.json({ error: 'Access denied' }, { status: 403 });

  const { data: members, error } = await supabase
    .from('library_members')
    .select('role, joined_at, user_id, users:user_id(id, email, display_name, avatar_url)')
    .eq('library_id', libraryId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ members });
}
