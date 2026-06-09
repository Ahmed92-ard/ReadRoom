import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const body = await req.json().catch(() => null);
    if (!body) return NextResponse.json({ error: 'Body is required' }, { status: 400 });

    const { name, pdfFileId, pdfFilename, pdfThumbnail, currentPage, scrollPct, zoom, currentPdfId } = body;
    const updates: Record<string, any> = {};

    if (name !== undefined) updates.name = String(name).trim().slice(0, 64);
    if (pdfFileId !== undefined) {
      updates.pdf_drive_id = pdfFileId;
      updates.pdf_name = pdfFilename;
      updates.pdf_url = pdfThumbnail ?? null;
    }

    if (currentPage !== undefined) {
      const p = Number(currentPage);
      if (Number.isInteger(p) && p >= 1) updates.current_page = p;
    }
    if (scrollPct !== undefined) {
      const s = Number(scrollPct);
      if (Number.isFinite(s)) updates.scroll_pct = Math.min(1, Math.max(0, s));
    }
    if (zoom !== undefined) {
      const z = Number(zoom);
      if (Number.isFinite(z)) updates.zoom = Math.min(3, Math.max(0.5, z));
    }
    if (currentPdfId !== undefined) {
      updates.current_pdf_id = currentPdfId;
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
