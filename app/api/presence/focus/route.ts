// app/api/presence/focus/route.ts
// Writes the client's focus state to Redis so push.ts can suppress
// notifications for actively-focused users.
//
// Key: presence:user:<userId>
// TTL: 90 seconds (client heartbeats every 30s)

import { createClient } from '@/lib/supabase/server';
import { redis } from '@/lib/redis/client';
import { NextResponse } from 'next/server';

const TTL_SECONDS = 90;

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const isFocused: boolean = body?.isFocused === true;
  const activeLibraryId: string | null = body?.libraryId ?? null;
  const currentRoomId: string | null = body?.roomId ?? null;

  const key = `presence:user:${user.id}`;

  if (!isFocused) {
    // User blurred/hidden — remove key so push is delivered
    await redis.del(key);
  } else {
    await redis.set(
      key,
      JSON.stringify({ isFocused: true, activeLibraryId, currentRoomId, ts: Date.now() }),
      { ex: TTL_SECONDS }
    );
  }

  return NextResponse.json({ ok: true });
}
