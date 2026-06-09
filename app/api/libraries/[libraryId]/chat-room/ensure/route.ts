// app/api/libraries/[libraryId]/chat-room/ensure/route.ts
// Idempotent mutation: ensures a library-wide chat room exists and returns its ID.
// POST only — never creates a room on GET.

import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

type Params = { libraryId: string };

export async function POST(
  _req: Request,
  { params }: { params: Promise<Params> | Params }
) {
  const { libraryId } = await params;
  const supabase = createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Verify membership
  const { data: membership } = await supabase
    .from('library_members')
    .select('role')
    .eq('library_id', libraryId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!membership) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  const db = createAdminClient() ?? supabase;

  // Check if a library chat room already exists
  const { data: existing } = await db
    .from('rooms')
    .select('id')
    .eq('library_id', libraryId)
    .eq('is_library_chat', true)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ roomId: existing.id });
  }

  // Create the library chat room
  const { data: room, error } = await db
    .from('rooms')
    .insert({
      library_id: libraryId,
      name: 'Library Chat',
      type: 'text',
      is_library_chat: true,
      position: -1, // hidden from normal channel lists
    })
    .select('id')
    .single();

  if (error) {
    // Race condition: another request may have created it concurrently
    if (error.code === '23505') {
      const { data: raced } = await db
        .from('rooms')
        .select('id')
        .eq('library_id', libraryId)
        .eq('is_library_chat', true)
        .maybeSingle();
      if (raced) return NextResponse.json({ roomId: raced.id });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ roomId: room.id }, { status: 201 });
}
