// app/api/libraries/route.ts
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: memberships, error } = await supabase
    .from('library_members')
    .select('library_id, role, libraries(*)')
    .eq('user_id', user.id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const libraries = memberships?.map((m: any) => ({ ...m.libraries, role: m.role })) ?? [];
  return NextResponse.json({ libraries });
}

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    console.error('[api/libraries] POST: Unauthorized');
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch (e) {
    console.error('[api/libraries] POST: Failed to parse request body');
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { name } = body;
  if (!name?.trim()) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  const inviteCode = Math.random().toString(36).substring(2, 10).toUpperCase();

  console.log('[api/libraries] POST: Creating library for user', user.id);

  const { data: library, error: serverError } = await supabase
    .from('libraries')
    .insert({ 
      name: name.trim().slice(0, 64), 
      owner_id: user.id, 
      invite_code: inviteCode 
    })
    .select()
    .single();

  if (serverError) {
    console.error('[api/libraries] POST: Library creation failed:', serverError);
    return NextResponse.json({ error: serverError.message }, { status: 500 });
  }

  console.log('[api/libraries] POST: Library created', library.id, '- Adding owner...');

  // Add owner as member
  const { error: memberError } = await supabase.from('library_members').insert({
    library_id: library.id,
    user_id: user.id,
    role: 'owner',
  });

  if (memberError) {
    console.error('[api/libraries] POST: Member addition failed:', memberError);
    return NextResponse.json({ error: memberError.message }, { status: 500 });
  }

  console.log('[api/libraries] POST: Creating general channel...');

  // Create a default "general" channel
  const { error: channelError } = await supabase.from('rooms').insert({
    library_id: library.id,
    name: 'general',
    type: 'text',
    position: 0,
  });

  if (channelError) {
    console.error('[api/libraries] POST: Channel creation failed:', channelError);
    return NextResponse.json({ error: channelError.message }, { status: 500 });
  }

  console.log('[api/libraries] POST: Success');
  return NextResponse.json({ library });
}

export async function PATCH(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const libraryId = body?.libraryId;
  const name = String(body?.name ?? '').trim();

  if (!libraryId) return NextResponse.json({ error: 'Library ID is required' }, { status: 400 });
  if (!name) return NextResponse.json({ error: 'Name is required' }, { status: 400 });

  const { data: membership } = await supabase
    .from('library_members')
    .select('role')
    .eq('library_id', libraryId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const { data: library, error } = await supabase
    .from('libraries')
    .update({ name: name.slice(0, 64) })
    .eq('id', libraryId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ library });
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

  const { libraryId } = body;
  if (!libraryId) return NextResponse.json({ error: 'Library ID is required' }, { status: 400 });

  // Check if user is the owner
  const { data: library } = await supabase
    .from('libraries')
    .select('owner_id')
    .eq('id', libraryId)
    .single();

  if (!library) return NextResponse.json({ error: 'Library not found' }, { status: 404 });
  if (library.owner_id !== user.id) return NextResponse.json({ error: 'Only the owner can delete a library' }, { status: 403 });

  // Delete server (cascades to channels, messages, etc.)
  const { error } = await supabase
    .from('libraries')
    .delete()
    .eq('id', libraryId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
