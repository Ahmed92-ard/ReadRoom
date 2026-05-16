// app/api/user/settings/route.ts
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile, error } = await supabase
    .from('users')
    .select('id, email, display_name, avatar_url, bio, created_at, updated_at')
    .eq('id', user.id)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // If no profile row yet (auth trigger hasn't fired), synthesize one from auth metadata
  if (!profile) {
    return NextResponse.json({
      profile: {
        id: user.id,
        email: user.email ?? null,
        display_name: user.user_metadata?.full_name || user.email?.split('@')[0] || 'Reader',
        avatar_url: user.user_metadata?.avatar_url ?? null,
        bio: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
    });
  }

  return NextResponse.json({ profile });
}

export async function PATCH(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  const updates: Record<string, any> = {};
  if (body.displayName !== undefined) updates.display_name = String(body.displayName).trim().slice(0, 64);
  if (body.avatarUrl !== undefined) updates.avatar_url = body.avatarUrl;
  if (body.bio !== undefined) updates.bio = body.bio ? String(body.bio).trim().slice(0, 500) : null;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  // Use admin client if available (bypasses RLS for upsert).
  // Fall back to user client — the UPDATE policy allows users to update their own row.
  const db = createAdminClient() ?? supabase;

  // Upsert: creates the row if the auth trigger hasn't fired yet,
  // or updates it if it already exists.
  const { data: profile, error } = await db
    .from('users')
    .upsert(
      {
        id: user.id,
        email: user.email ?? null,
        display_name:
          updates.display_name ??
          user.user_metadata?.full_name ??
          user.email?.split('@')[0] ??
          'Reader',
        avatar_url: updates.avatar_url ?? user.user_metadata?.avatar_url ?? null,
        ...updates,
      },
      { onConflict: 'id' }
    )
    .select('id, email, display_name, avatar_url, bio, created_at, updated_at')
    .single();

  if (error) {
    console.error('[api/user/settings] PATCH upsert failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Keep auth metadata in sync with display name
  if (updates.display_name) {
    await supabase.auth.updateUser({ data: { full_name: updates.display_name } }).catch(() => {});
  }

  return NextResponse.json({ profile });
}
