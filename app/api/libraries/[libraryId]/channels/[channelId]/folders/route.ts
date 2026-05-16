// app/api/libraries/[libraryId]/channels/[channelId]/folders/route.ts
// CRUD for PDF folders (Google Drive-style organization)
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import { PDF_TABLE } from '@/lib/backend/readroom';

type Params = { libraryId: string; channelId: string };

async function verifyMembership(supabase: ReturnType<typeof createClient>, libraryId: string, userId: string) {
  const { data } = await supabase
    .from('library_members')
    .select('role')
    .eq('library_id', libraryId)
    .eq('user_id', userId)
    .maybeSingle();
  return data;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<Params> | Params }
) {
  const { libraryId, channelId } = await params;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const membership = await verifyMembership(supabase, libraryId, user.id);
  if (!membership) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  const db = createAdminClient() ?? supabase;

  const { data: room } = await db
    .from('rooms')
    .select('id')
    .eq('id', channelId)
    .eq('library_id', libraryId)
    .maybeSingle();
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

  const { data: folders, error } = await db
    .from('pdf_folders')
    .select('*')
    .eq('room_id', channelId)
    .order('position', { ascending: true });

  if (error) {
    if (error.code === '42P01') return NextResponse.json({ folders: [] }); // table not yet created
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Build tree structure
  const folderMap = new Map<string, any>();
  const roots: any[] = [];

  (folders ?? []).forEach((f) => {
    folderMap.set(f.id, {
      id: f.id,
      roomId: f.room_id,
      parentId: f.parent_id ?? null,
      name: f.name,
      position: f.position,
      createdAt: f.created_at,
      children: [],
      pdfs: [],
    });
  });

  folderMap.forEach((folder) => {
    if (folder.parentId && folderMap.has(folder.parentId)) {
      folderMap.get(folder.parentId).children.push(folder);
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

  const membership = await verifyMembership(supabase, libraryId, user.id);
  if (!membership) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const name = String(body?.name ?? '').trim().slice(0, 128);
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  const parentId = body?.parentId ?? null;
  const db = createAdminClient() ?? supabase;

  const { data: room } = await db
    .from('rooms')
    .select('id')
    .eq('id', channelId)
    .eq('library_id', libraryId)
    .maybeSingle();
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

  if (parentId) {
    const { data: parent } = await db
      .from('pdf_folders')
      .select('id')
      .eq('id', parentId)
      .eq('room_id', channelId)
      .maybeSingle();
    if (!parent) return NextResponse.json({ error: 'Parent folder not found' }, { status: 404 });
  }

  // Get next position
  let positionQuery = db
    .from('pdf_folders')
    .select('position')
    .eq('room_id', channelId)
    .order('position', { ascending: false })
    .limit(1);
  positionQuery = parentId ? positionQuery.eq('parent_id', parentId) : positionQuery.is('parent_id', null);
  const { data: existing } = await positionQuery;

  const position = (existing?.[0]?.position ?? -1) + 1;

  const { data: folder, error } = await db
    .from('pdf_folders')
    .insert({
      room_id: channelId,
      parent_id: parentId,
      name,
      position,
      created_by: user.id,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      let existingQuery = db
        .from('pdf_folders')
        .select('*')
        .eq('room_id', channelId)
        .ilike('name', name);
      existingQuery = parentId ? existingQuery.eq('parent_id', parentId) : existingQuery.is('parent_id', null);
      const { data: existing } = await existingQuery.maybeSingle();
      if (existing) {
        return NextResponse.json({
          folder: {
            id: existing.id,
            roomId: existing.room_id,
            parentId: existing.parent_id ?? null,
            name: existing.name,
            position: existing.position,
            createdAt: existing.created_at,
            children: [],
            pdfs: [],
          },
        }, { status: 200 });
      }
    }
    if (error.code === '42P01') {
      return NextResponse.json({ error: 'Run migration 008 to enable folder support.' }, { status: 501 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    folder: {
      id: folder.id,
      roomId: folder.room_id,
      parentId: folder.parent_id ?? null,
      name: folder.name,
      position: folder.position,
      createdAt: folder.created_at,
      children: [],
      pdfs: [],
    },
  }, { status: 201 });
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<Params> | Params }
) {
  const { libraryId, channelId } = await params;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const membership = await verifyMembership(supabase, libraryId, user.id);
  if (!membership || !['owner', 'admin'].includes(membership.role)) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const folderId = body?.folderId;
  if (!folderId) return NextResponse.json({ error: 'folderId required' }, { status: 400 });

  const db = createAdminClient() ?? supabase;

  const { data: room } = await db
    .from('rooms')
    .select('id')
    .eq('id', channelId)
    .eq('library_id', libraryId)
    .maybeSingle();
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

  const { data: folder } = await db
    .from('pdf_folders')
    .select('id')
    .eq('id', folderId)
    .eq('room_id', channelId)
    .maybeSingle();
  if (!folder) return NextResponse.json({ error: 'Folder not found' }, { status: 404 });

  // Cascade: move PDFs in this folder to root (null folder_id)
  await db
    .from(PDF_TABLE)
    .update({ folder_id: null })
    .eq('folder_id', folderId);

  const { error } = await db
    .from('pdf_folders')
    .delete()
    .eq('id', folderId)
    .eq('room_id', channelId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
