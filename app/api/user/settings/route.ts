// app/api/user/settings/route.ts
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: profile } = await supabase
    .from('users')
    .select('*')
    .eq('id', user.id)
    .single();

  return NextResponse.json({ profile });
}

export async function PATCH(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const updates: Record<string, any> = {};

  if (body.displayName !== undefined) updates.display_name = body.displayName;
  if (body.avatarUrl !== undefined) updates.avatar_url = body.avatarUrl;

  const { data: profile, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', user.id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Also update the auth user metadata if updating display name
  if (body.displayName !== undefined) {
    await supabase.auth.updateUser({
      data: { full_name: body.displayName }
    });
  }

  return NextResponse.json({ profile });
}
