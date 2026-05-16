// app/api/rooms/[id]/messages/route.ts
import { Redis } from '@upstash/redis';
import { createAdminClient, createClient } from '@/lib/supabase/server';
import type { ChatMessage } from '@/types';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

function asUuid(value: string | null | undefined) {
  if (!value) return null;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null;
}

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  const roomId = params.id;
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);
  const supabase = createClient();
  const db = createAdminClient() ?? supabase;

  const { data: rows, error } = await db
    .from('messages')
    .select('*, sender:users!messages_sender_id_fkey(id, display_name, avatar_url)')
    .eq('room_id', roomId)
    .eq('deleted', false)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (!error) {
    const messages = (rows ?? []).map((row: any): ChatMessage => ({
      id: row.id,
      roomId: row.room_id,
      userId: row.sender_id ?? '',
      userName: row.sender?.display_name ?? row.sender_name ?? 'Reader',
      avatarColor: row.avatar_color ?? '#6366f1',
      avatarUrl: row.sender?.avatar_url ?? row.avatar_url ?? null,
      content: row.content,
      attachmentUrl: row.attachment_url ?? null,
      attachmentType: row.attachment_type ?? null,
      deleted: row.deleted ?? false,
      editedAt: row.edited_at ?? null,
      ts: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
      createdAt: row.created_at,
    })).reverse();
    return Response.json({ messages });
  }

  try {
    // Get message IDs for this room, sorted by timestamp (newest first)
    // Upstash REST API uses zrange with rev option instead of zrevrange
    const messageIds = await redis.zrange<string[]>(
      `messages:${roomId}`,
      0,
      limit - 1,
      { rev: true }
    );

    if (!messageIds || messageIds.length === 0) {
      return Response.json({ messages: [] });
    }

    // Get message data
    const messages: ChatMessage[] = [];
    for (const id of messageIds) {
      const data = await redis.get<string>(`message:${id}`);
      if (data) {
        try {
          const parsed = typeof data === 'string' ? JSON.parse(data) : data;
          messages.push(parsed);
        } catch {
          // skip malformed messages
        }
      }
    }

    return Response.json({ messages });
  } catch (error) {
    console.error('[messages] GET failed:', error);
    return Response.json({ messages: [], error: 'Failed to load messages' }, { status: 500 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  const roomId = params.id;

  try {
    const payload = await req.json() as ChatMessage;

    // Validate required fields
    if (!payload.id || !payload.userId || !payload.content || !payload.ts) {
      return Response.json({ error: 'Missing required fields' }, { status: 400 });
    }

    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const db = createAdminClient() ?? supabase;
    const senderId = user?.id ?? asUuid(payload.userId?.split('_')[0]) ?? null;

    const { data: profile } = senderId
      ? await db.from('users').select('display_name, avatar_url').eq('id', senderId).maybeSingle()
      : { data: null };

    const { data: row, error } = await db
      .from('messages')
      .insert({
        id: payload.id,
        room_id: roomId,
        sender_id: senderId,
        sender_name: profile?.display_name ?? payload.userName,
        avatar_color: payload.avatarColor,
        avatar_url: profile?.avatar_url ?? payload.avatarUrl ?? null,
        content: payload.content.trim().slice(0, 2000),
      })
      .select()
      .single();

    if (!error && row) {
      const message: ChatMessage = {
        ...payload,
        id: row.id,
        roomId: row.room_id,
        userId: row.sender_id ?? payload.userId,
        userName: row.sender_name,
        avatarUrl: row.avatar_url ?? null,
        ts: new Date(row.created_at).getTime(),
        createdAt: row.created_at,
      };
      return Response.json({ success: true, message });
    }

    // Legacy fallback if migration 008 has not been applied yet.
    const messageKey = `message:${payload.id}`;
    await redis.set(messageKey, JSON.stringify(payload), { ex: 7 * 24 * 60 * 60 });

    // Add to room's message sorted set (by timestamp)
    await redis.zadd(`messages:${roomId}`, { score: payload.ts, member: payload.id });

    // Keep room messages TTL fresh
    await redis.expire(`messages:${roomId}`, 7 * 24 * 60 * 60);

    return Response.json({ success: true, message: payload });
  } catch (error) {
    console.error('[messages] POST failed:', error);
    return Response.json({ error: 'Failed to save message' }, { status: 500 });
  }
}
