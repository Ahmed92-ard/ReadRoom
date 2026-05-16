// app/api/rooms/[id]/messages/route.ts
import { Redis } from '@upstash/redis';
import type { ChatMessage } from '@/types';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export async function GET(
  req: Request,
  { params }: { params: { id: string } }
) {
  const roomId = params.id;
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 200);

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

    // Store message with expiration (7 days)
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
