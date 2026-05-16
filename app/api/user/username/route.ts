import { createClient, createAdminClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

function normalizeUsername(value: unknown) {
  return String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 64);
}

function validateUsername(username: string) {
  if (username.length < 2) return 'Username must be at least 2 characters';
  if (username.length > 64) return 'Username must be 64 characters or fewer';
  if (!/^[\p{L}\p{N}][\p{L}\p{N} _.-]*$/u.test(username)) {
    return 'Use letters, numbers, spaces, dots, dashes, or underscores';
  }
  return null;
}

export async function GET(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const username = normalizeUsername(searchParams.get('username'));
  const validationError = validateUsername(username);
  if (validationError) {
    return NextResponse.json({ available: false, error: validationError }, { status: 400 });
  }

  const db = createAdminClient() ?? supabase;
  const { data, error } = await db
    .from('users')
    .select('id')
    .ilike('display_name', username)
    .neq('id', user.id)
    .limit(1);

  if (error) return NextResponse.json({ available: false, error: error.message }, { status: 500 });

  return NextResponse.json({
    username,
    available: (data ?? []).length === 0,
  });
}
