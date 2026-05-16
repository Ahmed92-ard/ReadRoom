// app/api/rooms/[id]/notes/route.ts — Canonical. Uses `notes` table.
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

const MAX_NOTE_LENGTH = 20_000;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  const { id: roomId } = await params;
  const url = new URL(req.url);
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'));

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('notes')
    .select('id, content, page, user_id, updated_at')
    .eq('room_id', roomId)
    .eq('page', page)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error('[api/notes] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    roomId,
    page,
    content: data?.content ?? '',
    noteId: data?.id ?? null,
    userId: data?.user_id ?? null,
    updatedAt: data?.updated_at ?? null,
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  const { id: roomId } = await params;
  const body = await req.json().catch(() => ({}));
  const page = Math.max(1, Number(body.pageNum ?? 1));
  const content = String(body.content ?? '').trim();
  const lastUpdatedAt = body.lastUpdatedAt ? String(body.lastUpdatedAt) : null;

  if (content.length > MAX_NOTE_LENGTH) {
    return NextResponse.json({ error: 'Note content is too long.' }, { status: 400 });
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: existing, error: fetchError } = await supabase
    .from('notes')
    .select('id, content, updated_at')
    .eq('room_id', roomId)
    .eq('page', page)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (fetchError) {
    console.error('[api/notes] POST fetch error:', fetchError);
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  if (existing) {
    // Conflict detection: reject if server version is newer than client's last-known version
    if (lastUpdatedAt && new Date(existing.updated_at).getTime() > new Date(lastUpdatedAt).getTime()) {
      return NextResponse.json({
        conflict: true,
        message: 'This note was updated from another session.',
        libraryContent: existing.content,
        libraryUpdatedAt: existing.updated_at,
      }, { status: 409 });
    }

    const { data, error } = await supabase
      .from('notes')
      .update({ content, user_id: user.id })
      .eq('id', existing.id)
      .select()
      .single();

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ note: data });
  }

  const { data, error } = await supabase
    .from('notes')
    .insert({ room_id: roomId, page, content, user_id: user.id })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ note: data });
}
