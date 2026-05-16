import { createAdminClient, createClient } from '@/lib/supabase/server';
import { requireRoomInLibrary } from '@/lib/backend/readroom';
import { NextResponse } from 'next/server';

type Params = { libraryId: string; channelId: string };
const CHAT_BUCKET = 'chat-attachments';
const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

function kindFor(mime: string, name: string) {
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime === 'application/pdf' || name.toLowerCase().endsWith('.pdf')) return 'pdf';
  return 'file';
}

function cleanName(name: string) {
  return name.replace(/[^\w\s.\-()[\]]/g, '').trim().slice(0, 180) || 'attachment';
}

export async function POST(req: Request, { params }: { params: Promise<Params> | Params }) {
  const { libraryId, channelId } = await params;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data: membership } = await supabase
    .from('library_members')
    .select('role')
    .eq('library_id', libraryId)
    .eq('user_id', user.id)
    .maybeSingle();
  if (!membership) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  const db = createAdminClient() ?? supabase;
  const { data: room, error: roomError } = await requireRoomInLibrary(db, libraryId, channelId);
  if (roomError) return NextResponse.json({ error: roomError.message }, { status: 500 });
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

  const form = await req.formData();
  const file = form.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 });
  if (file.size > MAX_ATTACHMENT_BYTES) return NextResponse.json({ error: 'File is larger than 100 MB' }, { status: 413 });

  const name = cleanName(file.name);
  const mimeType = file.type || 'application/octet-stream';
  const kind = kindFor(mimeType, name);
  const bytes = Buffer.from(await file.arrayBuffer());
  const ext = name.includes('.') ? name.split('.').pop() : 'bin';
  const storagePath = `${libraryId}/${channelId}/${user.id}/${crypto.randomUUID()}.${ext}`;

  const { error: uploadError } = await db.storage
    .from(CHAT_BUCKET)
    .upload(storagePath, bytes, { contentType: mimeType, upsert: false });

  if (uploadError) {
    return NextResponse.json({
      error: uploadError.message,
      hint: 'Ensure the "chat-attachments" Supabase Storage bucket exists (run 010_modern_chat_system.sql).',
    }, { status: 500 });
  }

  const { data: urlData } = await db.storage.from(CHAT_BUCKET).createSignedUrl(storagePath, 60 * 60);

  return NextResponse.json({
    attachment: {
      name,
      mimeType,
      sizeBytes: file.size,
      kind,
      storagePath,
      url: urlData?.signedUrl ?? null,
    },
  });
}
