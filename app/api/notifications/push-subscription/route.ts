// app/api/notifications/push-subscription/route.ts
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    if (!body || !body.subscription || !body.subscription.endpoint) {
      return NextResponse.json({ error: 'Invalid subscription payload' }, { status: 400 });
    }

    const { endpoint, keys } = body.subscription;
    if (!keys || !keys.p256dh || !keys.auth) {
      return NextResponse.json({ error: 'Missing encryption keys' }, { status: 400 });
    }

    const db = createAdminClient() ?? supabase;

    // Secure upsert by endpoint to prevent duplicates
    const { error } = await db.from('push_subscriptions').upsert({
      user_id: user.id,
      endpoint,
      p256dh: keys.p256dh,
      auth: keys.auth,
      device_metadata: body.device_metadata || null,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'endpoint'
    });

    if (error) {
      console.error('[PushSubscriptionAPI] DB upsert failed:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true }, { status: 201 });
  } catch (err: any) {
    console.error('[PushSubscriptionAPI] Uncaught POST error:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json().catch(() => null);
    if (!body || !body.endpoint) {
      return NextResponse.json({ error: 'endpoint parameter is required' }, { status: 400 });
    }

    const db = createAdminClient() ?? supabase;

    // Delete the endpoint strictly matching user_id to prevent users deleting other's endpoints
    const { error } = await db
      .from('push_subscriptions')
      .delete()
      .eq('endpoint', body.endpoint)
      .eq('user_id', user.id);

    if (error) {
      console.error('[PushSubscriptionAPI] DB delete failed:', error.message);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error('[PushSubscriptionAPI] Uncaught DELETE error:', err);
    return NextResponse.json({ error: err.message || 'Internal Server Error' }, { status: 500 });
  }
}
