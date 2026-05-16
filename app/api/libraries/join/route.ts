// app/api/libraries/join/route.ts — Canonical. Uses libraries + library_members.
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json().catch(() => null);
  const inviteCode = String(body?.inviteCode ?? '').trim().toUpperCase();
  if (!inviteCode) return NextResponse.json({ error: 'Invite code required' }, { status: 400 });

  // Use admin client to find library by invite code
  // Regular RLS prevents selecting libraries you aren't a member of.
  const adminSupabase = createAdminClient();
  if (!adminSupabase) {
    return NextResponse.json({ error: 'System configuration error' }, { status: 500 });
  }

  const { data: library, error } = await adminSupabase
    .from('libraries')
    .select('*')
    .eq('invite_code', inviteCode)
    .single();

  if (error || !library) return NextResponse.json({ error: 'Invalid invite code' }, { status: 404 });

  const { data: existing } = await adminSupabase
    .from('library_members')
    .select('user_id')
    .eq('library_id', library.id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!existing) {
    const { error: joinError } = await adminSupabase.from('library_members').insert({
      library_id: library.id,
      user_id: user.id,
      role: 'member',
    });
    if (joinError) return NextResponse.json({ error: joinError.message }, { status: 500 });
  }

  return NextResponse.json({ library });
}
