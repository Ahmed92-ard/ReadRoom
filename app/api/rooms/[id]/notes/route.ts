import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

const MAX_NOTE_LENGTH = 20_000;
const NOTE_TABLES = ['notes', 'room_notes'];

function isMissingTable(error: any) {
  return error?.code === '42P01' || String(error?.message ?? '').includes('does not exist');
}

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  const url = new URL(req.url);
  const page = Number(url.searchParams.get('page') || '1');
  const supabase = createClient();

  let data: any = null;
  let error: any = null;
  for (const table of NOTE_TABLES) {
    const result = await supabase
      .from(table)
      .select('id, content, page, user_id, updated_at')
      .eq('room_id', params.id)
      .eq('page', page)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    data = result.data;
    error = result.error;
    if (!error || !isMissingTable(error)) break;
  }

  if (error) {
    console.error('[api/notes] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    roomId: params.id,
    page,
    content: data?.content ?? '',
    noteId: data?.id ?? null,
    userId: data?.user_id ?? null,
    updatedAt: data?.updated_at ?? null,
  });
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const body = await req.json().catch(() => ({}));
  const roomId = params.id;
  const page = Number(body.pageNum || 1);
  const content = String(body.content ?? '').trim();
  const userId = String(body.userId ?? 'anonymous').slice(0, 128);
  const lastUpdatedAt = body.lastUpdatedAt ? String(body.lastUpdatedAt) : null;

  if (!roomId || page < 1) {
    return NextResponse.json({ error: 'Invalid room or page number.' }, { status: 400 });
  }

  if (content.length > MAX_NOTE_LENGTH) {
    return NextResponse.json({ error: 'Note content is too long.' }, { status: 400 });
  }

  const supabase = createClient();

  let noteTable = 'notes';
  let existing: any = null;
  let fetchError: any = null;
  for (const table of NOTE_TABLES) {
    const result = await supabase
      .from(table)
      .select('id, content, updated_at')
      .eq('room_id', roomId)
      .eq('page', page)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    noteTable = table;
    existing = result.data;
    fetchError = result.error;
    if (!fetchError || !isMissingTable(fetchError)) break;
  }

  if (fetchError) {
    console.error('[api/notes] POST fetch error:', fetchError);
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  if (existing) {
    if (lastUpdatedAt && new Date(existing.updated_at).getTime() > new Date(lastUpdatedAt).getTime()) {
      return NextResponse.json(
        {
          conflict: true,
          message: 'This note was updated from another session.',
          libraryContent: existing.content,
          libraryUpdatedAt: existing.updated_at,
        },
        { status: 409 }
      );
    }

    const { data, error } = await supabase
      .from(noteTable)
      .update({ content, user_id: userId })
      .eq('id', existing.id)
      .select()
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ note: data });
  }

  const { data, error } = await supabase
    .from(noteTable)
    .insert({ room_id: roomId, page, content, user_id: userId })
    .select()
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ note: data });
}
