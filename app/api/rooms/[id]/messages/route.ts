// app/api/rooms/[id]/messages/route.ts
// Legacy endpoint kept for rooms that don't have a libraryId/channelId context.
// Reads from Supabase `messages` table (permanent). Falls back to empty on missing table.
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { ChatMessage } from '@/types';

function serializeMessage(row: any): ChatMessage {
  return {
    id: row.id,
    roomId: row.room_id,
    userId: row.sender_id ?? '',
    userName: row.sender_name ?? 'Reader',
    avatarColor: row.avatar_color ?? '#6366f1',
    avatarUrl: row.avatar_url ?? null,
    content: row.content,
    attachmentUrl: row.attachment_url ?? null,
    attachmentType: row.attachment_type ?? null,
    deleted: row.deleted ?? false,
    ts: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    createdAt: row.created_at,
  };
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  const { id: roomId } = await params;
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);
  const before = url.searchParams.get('before');

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let query = supabase
    .from('messages')
    .select('*')
    .eq('room_id', roomId)
    .eq('deleted', false)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (before) query = query.lt('created_at', before);

  const { data: rows, error } = await query;

  if (error) {
    if (error.code === '42P01') return NextResponse.json({ messages: [] });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const messages = (rows ?? []).map(serializeMessage).reverse();
  return NextResponse.json({ messages });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> | { id: string } }
) {
  const { id: roomId } = await params;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body?.content?.trim()) return NextResponse.json({ error: 'content required' }, { status: 400 });

  const { data: profile } = await supabase
    .from('users')
    .select('display_name, avatar_url')
    .eq('id', user.id)
    .maybeSingle();

  const { data: row, error } = await supabase
    .from('messages')
    .insert({
      ...(body.id ? { id: body.id } : {}),
      room_id: roomId,
      sender_id: user.id,
      sender_name: profile?.display_name ?? body.userName ?? 'Reader',
      avatar_color: body.avatarColor ?? '#6366f1',
      avatar_url: profile?.avatar_url ?? body.avatarUrl ?? null,
      content: String(body.content).trim().slice(0, 2000),
    })
    .select()
    .single();

  if (error) {
    if (error.code === '42P01') return NextResponse.json({ message: { id: body.id ?? crypto.randomUUID(), roomId, userId: user.id, userName: profile?.display_name ?? 'Reader', avatarColor: '#6366f1', content: body.content, ts: Date.now() } });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ message: serializeMessage(row) }, { status: 201 });
}
