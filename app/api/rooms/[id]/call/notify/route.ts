// app/api/rooms/[id]/call/notify/route.ts
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { redis } from '@/lib/redis/client';
import { sendPushToRoomParticipants } from '@/lib/backend/push';

type Params = { id: string };

export async function POST(req: Request, { params }: { params: Promise<Params> | Params }) {
  try {
    const { id: roomId } = await params;
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    const callerName = String(body?.callerName || 'Reader').trim().slice(0, 64);

    const db = createAdminClient() ?? supabase;

    // 1. Resolve room details to get library_id
    const { data: room, error: roomError } = await db
      .from('rooms')
      .select('library_id, name')
      .eq('id', roomId)
      .maybeSingle();

    if (roomError || !room) {
      return NextResponse.json({ error: 'Room not found' }, { status: 404 });
    }

    const libraryId = room.library_id;

    // 2. Verify membership to secure the endpoint
    const { data: membership, error: memberError } = await db
      .from('library_members')
      .select('role')
      .eq('library_id', libraryId)
      .eq('user_id', user.id)
      .maybeSingle();

    if (memberError || !membership) {
      return NextResponse.json({ error: 'Forbidden: not a library member' }, { status: 403 });
    }

    // 3. Coordinate call lock in Redis to avoid spam ringing
    const lockKey = `room:call:active:${roomId}`;
    const isCallAlreadyActive = await redis.get(lockKey);

    if (isCallAlreadyActive) {
      // Return early: call is already active, so do not trigger duplicate ring/vibrations
      return NextResponse.json({ active: true, notified: false });
    }

    // Lock call notifications for 60 seconds (prevents double ring if others connect in parallel)
    await redis.set(lockKey, '1', { ex: 60 });

    // 4. Assemble call ringing push payload
    const payload = {
      title: 'Incoming Call 📞',
      body: `${callerName} is calling in #${room.name}`,
      icon: '/icons/app_icon_192.png',
      badge: '/icons/app_icon_192.png',
      vibrate: [100, 50, 100, 50, 100, 50, 100],
      data: {
        url: `/libraries/${libraryId}/channels/${roomId}`, // navigate internally inside app
        roomId: roomId,
        libraryId: libraryId,
        isCall: true,
        notificationType: 'call' as const,
        senderName: callerName
      },
      actions: [
        { action: 'join', title: 'Join Call' },
        { action: 'decline', title: 'Decline' }
      ]
    };

    // 5. Asynchronously trigger push notifications (fire-and-forget focus-driven)
    sendPushToRoomParticipants(roomId, user.id, payload, true);

    return NextResponse.json({ active: true, notified: true });
  } catch (err: any) {
    console.error('[CallNotifyAPI] Uncaught error:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
