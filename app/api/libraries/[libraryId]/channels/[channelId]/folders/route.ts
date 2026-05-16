// app/api/libraries/[libraryId]/channels/[channelId]/folders/route.ts — Canonical.
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { getDbClient, requireLibraryMember, requireRoomInLibrary } from '@/lib/backend/readroom';

type Params = { libraryId: string; channelId: string };

function serializeFolder(f: any): any {
  return {
    id: f.id,
    roomId: f.room_id,
    parentId: f.parent_id ?? null,
    name: f.name,
    position: f.position,
    createdAt: f.created_at,
    children: [],
    pdfs: [],
  };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<Params> | Params }
) {
  const { libraryId, channelId } = await params;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { membership } = await requireLibraryMember(supabase, libraryId, user.id);
  if (!membership) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  const db = getDbClient(supabase);
  const { data: folders, error } = await db
    .from('pdf_folders')
    .select('*')
    .eq('room_id', channelId)
    .order('position', { ascending: true });

  if (error) {
    if (error.code === '42P01') return NextResponse.json({ folders: [] });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Build tree
  const map = new Map<string, any>();
  const roots: any[] = [];
  (folders ?? []).forEach((f) => map.set(f.id, serializeFolder(f)));
  map.forEach((folder) => {
    if (folder.parentId && map.has(folder.parentId)) {
      map.get(folder.parentId).children.push(folder);
    } else {
      roots.push(folder);
    }
  });

  return NextResponse.json({ folders: roots });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<Params> | Params }
) {
  const { libraryId, channelId } = await params;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { membership } = await requireLibraryMember(supabase, libraryId, user.id);
  if (!membership) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const name = String(body?.name ?? '').trim().slice(0, 128);
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 });

  const parentId = body?.parentId ?? null;
  const db = getDbClient(supabase);

  const { data: existing } = await db
    .from('pdf_folders')
    .select('position')
    .eq('room_id', channelId)
    .order('position', { ascending: false })
    .limit(1);

  const position = (existing?.[0]?.position ?? -1) + 1;

  const { data: folder, error } = await db
    .from('pdf_folders')
    .insert({ room_id: channelId, parent_id: parentId, name, position, created_by: user.id })
    .select()
    .single();

  if (error) {
    if (error.code === '42P01') return NextResponse.json({ error: 'Run 001_canonical_schema.sql to enable folder support.' }, { status: 501 });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ folder: serializeFolder(folder) }, { status: 201 });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<Params> | Params }
) {
  const { libraryId, channelId } = await params;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { membership } = await requireLibraryMember(supabase, libraryId, user.id);
  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const folderId = body?.folderId;
  if (!folderId) return NextResponse.json({ error: 'folderId required' }, { status: 400 });

  const db = getDbClient(supabase);
  // Move PDFs in this folder to root
  await db.from('room_pdfs').update({ folder_id: null }).eq('folder_id', folderId);

  const { error } = await db
    .from('pdf_folders')
    .delete()
    .eq('id', folderId)
    .eq('room_id', channelId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
