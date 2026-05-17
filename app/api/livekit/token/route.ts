import { AccessToken } from 'livekit-server-sdk';
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    // Auth Guard: Only authenticated users can request video/voice calling tokens
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const roomId = searchParams.get('roomId');
    const userId = searchParams.get('userId');
    const userName = searchParams.get('userName');

    if (!roomId || !userId) {
      return NextResponse.json({ error: 'Missing roomId or userId' }, { status: 400 });
    }

    const apiKey = process.env.LIVEKIT_API_KEY;
    const apiSecret = process.env.LIVEKIT_API_SECRET;
    const wsUrl = process.env.NEXT_PUBLIC_LIVEKIT_URL;

    // Graceful Fallback: If LiveKit environment variables are missing,
    // return a specific unconfigured status so the frontend can display setup help.
    if (!apiKey || !apiSecret || !wsUrl) {
      return NextResponse.json({
        error: 'LiveKit credentials are not configured on the server.',
        status: 'unconfigured'
      }, { status: 200 });
    }

    const at = new AccessToken(apiKey, apiSecret, {
      identity: userId,
      name: userName || 'Reader',
    });

    at.addGrant({
      roomJoin: true,
      room: roomId,
      canPublish: true,
      canSubscribe: true,
    });

    const token = await at.toJwt();
    return NextResponse.json({ token, url: wsUrl });
  } catch (err) {
    console.error('[LiveKit Token API Error]:', err);
    return NextResponse.json({ error: 'Failed to generate connection token' }, { status: 500 });
  }
}
