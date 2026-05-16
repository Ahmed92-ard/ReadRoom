import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function POST(req: Request) {
  try {
    const { id, name, createdBy } = await req.json();
    console.log('[api/rooms] creating room:', { id, name, createdBy });

    const supabase = createClient();
    const { data, error } = await supabase
      .from('rooms')
      .insert({ id, name, created_by: createdBy })
      .select()
      .single();

    if (error) {
      console.error('[api/rooms] supabase error:', error);
      return NextResponse.json({ error: error.message, details: error }, { status: 500 });
    }

    console.log('[api/rooms] room created:', data);
    return NextResponse.json({ id });
  } catch (e) {
    console.error('[api/rooms] caught error:', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
