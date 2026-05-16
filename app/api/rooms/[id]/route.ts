import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const { name, pdfFileId, pdfFilename, pdfThumbnail } = await req.json();
    const updates: Record<string, any> = {};
    if (name !== undefined) updates.name = String(name).trim().slice(0, 64);
    if (pdfFileId !== undefined) {
      updates.pdf_drive_id = pdfFileId;
      updates.pdf_name = pdfFilename;
      updates.pdf_url = pdfThumbnail ?? null;
    }

    if (updates.name === '') {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }
    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid updates provided' }, { status: 400 });
    }

    const supabase = createClient();
    const { error } = await supabase
      .from('rooms')
      .update(updates)
      .eq('id', params.id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  const supabase = createClient();
  const { data, error } = await supabase
    .from('rooms')
    .select('*')
    .eq('id', params.id)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 404 });
  return NextResponse.json(data);
}
