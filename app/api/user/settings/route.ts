// app/api/user/settings/route.ts
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

function normalizeDisplayName(value: unknown) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 64);
}

function derivedName(user: any) {
  return normalizeDisplayName(
    user.user_metadata?.full_name ||
    user.user_metadata?.name ||
    user.user_metadata?.given_name ||
    user.email?.split('@')[0] ||
    'Reader'
  ) || 'Reader';
}

function isProfileComplete(profile: any, user: any) {
  if (user.user_metadata?.readroom_profile_complete === true) return true;
  const name = normalizeDisplayName(profile?.display_name);
  if (!name || name === 'Reader') return false;
  const emailPrefix = normalizeDisplayName(user.email?.split('@')[0] ?? '');
  return Boolean(emailPrefix && name !== emailPrefix) || name.includes(' ');
}

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const db = createAdminClient() ?? supabase;
  const { data: existingProfile, error: readError } = await db
    .from('users')
    .select('id, email, display_name, avatar_url, bio, created_at, updated_at')
    .eq('id', user.id)
    .maybeSingle();

  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });

  let safeDerivedName = derivedName(user);
  if (!existingProfile && safeDerivedName !== 'Reader') {
    const { data: taken } = await db
      .from('users')
      .select('id')
      .ilike('display_name', safeDerivedName)
      .neq('id', user.id)
      .limit(1);
    if ((taken ?? []).length > 0) safeDerivedName = 'Reader';
  }

  const writePayload = existingProfile
    ? {
        id: user.id,
        email: user.email ?? existingProfile.email ?? null,
        display_name: existingProfile.display_name || safeDerivedName,
        avatar_url: existingProfile.avatar_url ?? user.user_metadata?.avatar_url ?? null,
        bio: existingProfile.bio ?? null,
      }
    : {
        id: user.id,
        email: user.email ?? null,
        display_name: safeDerivedName,
        avatar_url: user.user_metadata?.avatar_url ?? null,
        bio: null,
      };

  const { data: profile, error } = await db
    .from('users')
    .upsert(writePayload, { onConflict: 'id', ignoreDuplicates: false })
    .select('id, email, display_name, avatar_url, bio, created_at, updated_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Ensure this user is enrolled in the global-library (fire-and-forget).
  // Runs on every sign-in; ON CONFLICT makes it idempotent.
  (async () => {
    try {
      // Make sure the global library exists (idempotent — uses DO NOTHING on conflict)
      await db.from('libraries').upsert({
        id: 'global-library',
        name: 'Global Library',
        invite_code: 'GLOBAL12',
        owner_id: user.id,
      }, { onConflict: 'id', ignoreDuplicates: true });

      // Ensure the global chat room exists
      await db.from('rooms').upsert({
        id: 'global-chat',
        library_id: 'global-library',
        name: 'Global Chat',
        type: 'text',
        position: -999,
      }, { onConflict: 'id', ignoreDuplicates: true });

      // Enrol this user as a member
      await db.from('library_members').upsert({
        library_id: 'global-library',
        user_id: user.id,
        role: 'member',
      }, { onConflict: 'library_id,user_id', ignoreDuplicates: true });
    } catch (e) {
      console.warn('[api/user/settings] global-library enrolment failed:', e);
    }
  })();

  return NextResponse.json({
    profile,
    profileComplete: isProfileComplete(profile, user),
  });
}

export async function PATCH(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });

  const updates: Record<string, any> = {};
  if (body.displayName !== undefined) {
    const displayName = normalizeDisplayName(body.displayName);
    if (displayName.length < 2) {
      return NextResponse.json({ error: 'Username must be at least 2 characters' }, { status: 400 });
    }
    updates.display_name = displayName;
  }
  if (body.avatarUrl !== undefined) updates.avatar_url = body.avatarUrl;
  if (body.bio !== undefined) updates.bio = body.bio ? String(body.bio).trim().slice(0, 500) : null;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 });
  }

  // Use admin client if available (bypasses RLS for upsert).
  // Fall back to user client — the UPDATE policy allows users to update their own row.
  const db = createAdminClient() ?? supabase;

  const { data: currentProfile } = await db
    .from('users')
    .select('display_name, avatar_url, bio')
    .eq('id', user.id)
    .maybeSingle();

  if (updates.display_name) {
    const { data: existing, error: lookupError } = await db
      .from('users')
      .select('id')
      .ilike('display_name', updates.display_name)
      .neq('id', user.id)
      .limit(1);

    if (lookupError) return NextResponse.json({ error: lookupError.message }, { status: 500 });
    if ((existing ?? []).length > 0) {
      return NextResponse.json({ error: 'That username is already taken' }, { status: 409 });
    }
  }

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
          currentProfile?.display_name ??
          derivedName(user),
        avatar_url:
          updates.avatar_url !== undefined
            ? updates.avatar_url
            : currentProfile?.avatar_url ?? user.user_metadata?.avatar_url ?? null,
        bio: updates.bio !== undefined ? updates.bio : currentProfile?.bio ?? null,
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
    await supabase.auth.updateUser({
      data: {
        full_name: updates.display_name,
        readroom_profile_complete: true,
      },
    }).catch(() => {});
  }

  if (updates.display_name) {
    const messageUpdates: Record<string, any> = {};
    messageUpdates.sender_name = updates.display_name;
    const { error: messageError } = await db
      .from('messages')
      .update(messageUpdates)
      .eq('sender_id', user.id);
    if (messageError) console.warn('[api/user/settings] message backfill failed:', messageError);
  }

  return NextResponse.json({ profile, profileComplete: isProfileComplete(profile, {
    ...user,
    user_metadata: {
      ...user.user_metadata,
      readroom_profile_complete: Boolean(updates.display_name) || user.user_metadata?.readroom_profile_complete,
    },
  }) });
}
