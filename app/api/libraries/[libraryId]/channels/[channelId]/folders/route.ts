// app/api/libraries/[libraryId]/channels/[channelId]/folders/route.ts
// Returns folder tree with PDFs embedded in each folder node.
import { createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import {
  getDbClient,
  PDF_TABLE,
  requireLibraryMember,
  serializeRoomPdf,
} from '@/lib/backend/readroom';

type Params = { libraryId: string; channelId: string };

function serializeFolder(f: any): any {
  return {
    id: f.id,
    roomId: f.room_id,
    parentId: f.parent_id ?? null,
    name: f.name,
    position: f.position,
    createdAt: f.created_at,
    children: [] as any[],
    pdfs: [] as any[],
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

  // Fetch folders and PDFs in parallel
  const [foldersResult, pdfsResult] = await Promise.all([
    db
      .from('pdf_folders')
      .select('*')
      .eq('room_id', channelId)
      .order('name', { ascending: true }),
    db
      .from(PDF_TABLE)
      .select('*')
      .eq('room_id', channelId)
      .order('position', { ascending: true }),
  ]);

  if (foldersResult.error) {
    if (foldersResult.error.code === '42P01') return NextResponse.json({ folders: [], rootPdfs: [] });
    return NextResponse.json({ error: foldersResult.error.message }, { status: 500 });
  }

  const folders = foldersResult.data ?? [];
  const allPdfs = pdfsResult.data ?? [];

  // Build folder map
  const folderMap = new Map<string, ReturnType<typeof serializeFolder>>();
  folders.forEach((f) => folderMap.set(f.id, serializeFolder(f)));

  // Assign PDFs to their folders
  const rootPdfs: any[] = [];
  allPdfs.forEach((pdf) => {
    const serialized = serializeRoomPdf(pdf, libraryId);
    if (pdf.folder_id && folderMap.has(pdf.folder_id)) {
      folderMap.get(pdf.folder_id)!.pdfs.push(serialized);
    } else {
      rootPdfs.push(serialized);
    }
  });

  // Build tree (children nested under parents)
  const roots: any[] = [];
  folderMap.forEach((folder) => {
    if (folder.parentId && folderMap.has(folder.parentId)) {
      folderMap.get(folder.parentId)!.children.push(folder);
    } else {
      roots.push(folder);
    }
  });

  // Sort children by name
  const sortChildren = (node: any) => {
    node.children.sort((a: any, b: any) => a.name.localeCompare(b.name));
    node.children.forEach(sortChildren);
  };
  roots.sort((a, b) => a.name.localeCompare(b.name));
  roots.forEach(sortChildren);

  return NextResponse.json({ folders: roots, rootPdfs });
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

  // Get next position within the same parent
  const posQuery = db
    .from('pdf_folders')
    .select('position')
    .eq('room_id', channelId)
    .order('position', { ascending: false })
    .limit(1);

  const { data: existing } = parentId
    ? await posQuery.eq('parent_id', parentId)
    : await posQuery.is('parent_id', null);

  const position = (existing?.[0]?.position ?? -1) + 1;

  const { data: folder, error } = await db
    .from('pdf_folders')
    .insert({ room_id: channelId, parent_id: parentId, name, position, created_by: user.id })
    .select()
    .single();

  if (error) {
    if (error.code === '42P01') {
      return NextResponse.json({ error: 'Run 001_canonical_schema.sql to enable folder support.' }, { status: 501 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ folder: serializeFolder(folder) }, { status: 201 });
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<Params> | Params }
) {
  // Rename a folder
  const { libraryId, channelId } = await params;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { membership } = await requireLibraryMember(supabase, libraryId, user.id);
  if (!membership) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const folderId = body?.folderId;
  const name = String(body?.name ?? '').trim().slice(0, 128);
  if (!folderId || !name) return NextResponse.json({ error: 'folderId and name required' }, { status: 400 });

  const db = getDbClient(supabase);
  const { data: folder, error } = await db
    .from('pdf_folders')
    .update({ name })
    .eq('id', folderId)
    .eq('room_id', channelId)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ folder: serializeFolder(folder) });
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
  // All members can delete folders (consistent with PDF delete permissions)
  if (!membership) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const folderId = body?.folderId;
  if (!folderId) return NextResponse.json({ error: 'folderId required' }, { status: 400 });

  const db = getDbClient(supabase);

  // Recursively collect all descendant folder IDs
  const allFolderIds = new Set<string>([folderId]);
  const collectDescendants = async (parentId: string) => {
    const { data: children } = await db
      .from('pdf_folders')
      .select('id')
      .eq('parent_id', parentId)
      .eq('room_id', channelId);
    for (const child of children ?? []) {
      allFolderIds.add(child.id);
      await collectDescendants(child.id);
    }
  };
  await collectDescendants(folderId);

  // Move all PDFs in these folders to root (null folder_id)
  await db
    .from('room_pdfs')
    .update({ folder_id: null })
    .in('folder_id', Array.from(allFolderIds));

  // Delete all folders (cascade handles children via DB FK, but we do it explicitly)
  const { error } = await db
    .from('pdf_folders')
    .delete()
    .in('id', Array.from(allFolderIds))
    .eq('room_id', channelId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, deletedCount: allFolderIds.size });
}
