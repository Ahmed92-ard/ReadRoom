// app/api/libraries/[libraryId]/channels/[channelId]/messages/route.ts
// Permanent Supabase-backed modern chat API.
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { ChatAttachment, ChatMessage } from '@/types';
import { requireRoomInLibrary } from '@/lib/backend/readroom';

type Params = { libraryId: string; channelId: string };
const CHAT_BUCKET = 'chat-attachments';

async function verifyMembership(supabase: ReturnType<typeof createClient>, libraryId: string, userId: string) {
  const { data } = await supabase
    .from('library_members')
    .select('role')
    .eq('library_id', libraryId)
    .eq('user_id', userId)
    .maybeSingle();
  return data;
}

async function signedUrl(db: any, storagePath?: string | null) {
  if (!storagePath) return null;
  const { data } = await db.storage.from(CHAT_BUCKET).createSignedUrl(storagePath, 60 * 60);
  return data?.signedUrl ?? null;
}

function isModernChatSchemaError(error: any) {
  const msg = String(error?.message ?? '').toLowerCase();
  return (
    ['42P01', '42703', 'PGRST108', 'PGRST200', 'PGRST204', 'PGRST205'].includes(error?.code)
    || msg.includes('message_attachments')
    || msg.includes('message_reactions')
    || msg.includes('message_read_receipts')
    || msg.includes('message_clears')
    || msg.includes('reply_to_message_id')
    || msg.includes('attachment_name')
    || msg.includes('storage_path')
    || msg.includes('schema cache')
    || msg.includes('relationship')
  );
}

async function serializeMessage(row: any, db: any): Promise<ChatMessage> {
  const profile = row.sender ?? row.users ?? null;
  const attachments: ChatAttachment[] = await Promise.all((row.attachments ?? []).map(async (a: any) => ({
    id: a.id,
    messageId: a.message_id,
    roomId: a.room_id,
    name: a.name,
    mimeType: a.mime_type,
    sizeBytes: Number(a.size_bytes ?? 0),
    kind: a.kind,
    storagePath: a.storage_path,
    url: await signedUrl(db, a.storage_path),
    createdAt: a.created_at,
  })));
  const firstAttachment = attachments[0];

  return {
    id: row.id,
    roomId: row.room_id,
    userId: row.sender_id ?? row.user_id ?? '',
    userName: profile?.display_name ?? row.sender_name ?? row.user_name ?? 'Reader',
    avatarColor: row.avatar_color ?? '#6366f1',
    avatarUrl: profile?.avatar_url ?? row.avatar_url ?? null,
    content: row.content ?? '',
    replyToMessageId: row.reply_to_message_id ?? null,
    replyTo: row.reply_to ? {
      id: row.reply_to.id,
      userId: row.reply_to.sender_id ?? '',
      userName: row.reply_to.sender_name ?? 'Reader',
      content: row.reply_to.content ?? '',
      attachmentType: row.reply_to.attachment_type ?? null,
    } : null,
    attachmentUrl: row.attachment_url ?? firstAttachment?.url ?? null,
    attachmentType: row.attachment_type ?? firstAttachment?.kind ?? null,
    attachmentName: row.attachment_name ?? firstAttachment?.name ?? null,
    attachmentSize: Number(row.attachment_size ?? firstAttachment?.sizeBytes ?? 0) || null,
    attachmentMime: row.attachment_mime ?? firstAttachment?.mimeType ?? null,
    storagePath: row.storage_path ?? firstAttachment?.storagePath ?? null,
    attachments,
    reactions: (row.reactions ?? []).map((r: any) => ({
      messageId: r.message_id,
      userId: r.user_id,
      emoji: r.emoji,
      createdAt: r.created_at,
    })),
    receipts: (row.receipts ?? []).map((r: any) => ({
      messageId: r.message_id,
      roomId: r.room_id,
      userId: r.user_id,
      deliveredAt: r.delivered_at,
      readAt: r.read_at,
    })),
    deleted: row.deleted ?? false,
    editedAt: row.edited_at ?? null,
    ts: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    createdAt: row.created_at,
  };
}

async function getClearTime(db: any, roomId: string, userId: string) {
  const { data, error } = await db
    .from('message_clears')
    .select('cleared_at')
    .eq('room_id', roomId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) return null;
  return data?.cleared_at ?? null;
}

function messageSelect() {
  return `
    *,
    sender:users!messages_sender_id_fkey(id, display_name, avatar_url),
    reply_to:messages!messages_reply_to_message_id_fkey(id, sender_id, sender_name, content, attachment_type),
    attachments:message_attachments(*),
    reactions:message_reactions(*),
    receipts:message_read_receipts(*)
  `;
}

function baseMessageSelect() {
  return '*, sender:users!messages_sender_id_fkey(id, display_name, avatar_url)';
}

export async function GET(req: Request, { params }: { params: Promise<Params> | Params }) {
  const { libraryId, channelId } = await params;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const membership = await verifyMembership(supabase, libraryId, user.id);
  if (!membership) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  const db = createAdminClient() ?? supabase;
  const { data: room, error: roomError } = await requireRoomInLibrary(db, libraryId, channelId);
  if (roomError) return NextResponse.json({ error: roomError.message }, { status: 500 });
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);
  const before = url.searchParams.get('before');
  const search = url.searchParams.get('search')?.trim();
  const media = url.searchParams.get('media') === '1';
  const clearTime = await getClearTime(db, channelId, user.id);

  const buildQuery = (select: string, includeModernSearch: boolean) => {
    let query = db
      .from('messages')
      .select(select)
      .eq('room_id', channelId)
      .eq('deleted', false)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (before) query = query.lt('created_at', before);
    if (clearTime) query = query.gt('created_at', clearTime);
    if (media) query = query.not('attachment_type', 'is', null);
    if (search) {
      const safe = search.replaceAll('%', '\\%').replaceAll('_', '\\_');
      query = query.or(includeModernSearch
        ? `content.ilike.%${safe}%,sender_name.ilike.%${safe}%,attachment_name.ilike.%${safe}%`
        : `content.ilike.%${safe}%,sender_name.ilike.%${safe}%`);
    }
    return query;
  };

  let { data: rows, error } = await buildQuery(messageSelect(), true);
  if (error && isModernChatSchemaError(error)) {
    ({ data: rows, error } = await buildQuery(baseMessageSelect(), false));
  }
  if (error && isModernChatSchemaError(error)) {
    ({ data: rows, error } = await buildQuery('*', false));
  }
  if (error) {
    if (error.code === '42P01') return NextResponse.json({ messages: [] });
    console.error('[api/messages] GET failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const messages = await Promise.all((rows ?? []).map((row: any) => serializeMessage(row, db)));
  return NextResponse.json({ messages: messages.reverse(), clearedAt: clearTime });
}

export async function POST(req: Request, { params }: { params: Promise<Params> | Params }) {
  const { libraryId, channelId } = await params;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const membership = await verifyMembership(supabase, libraryId, user.id);
  if (!membership) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const content = String(body?.content ?? '').trim().slice(0, 2000);
  const attachment = body?.attachment ?? null;
  if (!content && !attachment) return NextResponse.json({ error: 'content or attachment is required' }, { status: 400 });

  const db = createAdminClient() ?? supabase;
  const { data: room, error: roomError } = await requireRoomInLibrary(db, libraryId, channelId);
  if (roomError) return NextResponse.json({ error: roomError.message }, { status: 500 });
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

  const { data: profile } = await db.from('users').select('display_name, avatar_url').eq('id', user.id).maybeSingle();
  const senderName = String(profile?.display_name ?? body.userName ?? body.senderName ?? 'Reader').trim().slice(0, 64);
  const avatarColor = String(body.avatarColor ?? '#6366f1').slice(0, 32);
  const avatarUrl = profile?.avatar_url ?? (body.avatarUrl ? String(body.avatarUrl).slice(0, 512) : null);
  const replyToMessageId = body.replyToMessageId ? String(body.replyToMessageId) : null;
  const type = attachment?.kind ?? body.attachmentType ?? null;
  const baseInsert = {
    ...(body.id ? { id: body.id } : {}),
    room_id: channelId,
    sender_id: user.id,
    sender_name: senderName,
    avatar_color: avatarColor,
    avatar_url: avatarUrl,
    content: content || String(attachment?.name ?? body.content ?? 'Attachment').slice(0, 2000),
  };
  const modernInsert = {
    ...baseInsert,
    content: content || (attachment ? '' : String(body.content ?? '')),
    reply_to_message_id: replyToMessageId,
    attachment_url: attachment?.url ?? body.attachmentUrl ?? null,
    attachment_type: type,
    attachment_name: attachment?.name ?? null,
    attachment_size: attachment?.sizeBytes ?? null,
    attachment_mime: attachment?.mimeType ?? null,
    storage_path: attachment?.storagePath ?? null,
  };

  let { data: row, error } = await db
    .from('messages')
    .insert(modernInsert)
    .select('*')
    .single();

  if (error && isModernChatSchemaError(error)) {
    ({ data: row, error } = await db
      .from('messages')
      .insert(baseInsert)
      .select('*')
      .single());
  }

  if (error) {
    if (error.code === '42P01') return NextResponse.json({ message: { id: body.id ?? crypto.randomUUID(), roomId: channelId, userId: user.id, userName: senderName, avatarColor, avatarUrl, content, ts: Date.now() } });
    console.error('[api/messages] POST failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const insertedRow = row as any;
  if (!insertedRow?.id) {
    return NextResponse.json({ error: 'Message insert returned no row' }, { status: 500 });
  }

  if (attachment?.storagePath) {
    const { error: attachError } = await db.from('message_attachments').insert({
      message_id: insertedRow.id,
      room_id: channelId,
      uploader_id: user.id,
      name: String(attachment.name ?? 'Attachment').slice(0, 240),
      mime_type: String(attachment.mimeType ?? 'application/octet-stream').slice(0, 160),
      size_bytes: Number(attachment.sizeBytes ?? 0),
      kind: attachment.kind,
      storage_path: attachment.storagePath,
    });
    if (attachError) console.warn('[api/messages] attachment metadata failed:', attachError);
  }

  let { data: hydrated, error: hydrateError } = await db.from('messages').select(messageSelect()).eq('id', insertedRow.id).single();
  if (hydrateError && isModernChatSchemaError(hydrateError)) {
    ({ data: hydrated } = await db.from('messages').select(baseMessageSelect()).eq('id', insertedRow.id).single());
  }
  if (!hydrated && hydrateError && isModernChatSchemaError(hydrateError)) {
    ({ data: hydrated } = await db.from('messages').select('*').eq('id', insertedRow.id).single());
  }
  return NextResponse.json({ message: await serializeMessage(hydrated ?? insertedRow, db) }, { status: 201 });
}

export async function PATCH(req: Request, { params }: { params: Promise<Params> | Params }) {
  const { libraryId, channelId } = await params;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const membership = await verifyMembership(supabase, libraryId, user.id);
  if (!membership) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  const db = createAdminClient() ?? supabase;
  const { data: room, error: roomError } = await requireRoomInLibrary(db, libraryId, channelId);
  if (roomError) return NextResponse.json({ error: roomError.message }, { status: 500 });
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

  const body = await req.json().catch(() => null);
  const action = body?.action ?? 'edit';

  if (action === 'clear') {
    const { error } = await db.from('message_clears').upsert({ room_id: channelId, user_id: user.id, cleared_at: new Date().toISOString() }, { onConflict: 'room_id,user_id' });
    if (error && isModernChatSchemaError(error)) return NextResponse.json({ ok: true, degraded: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  if (action === 'read') {
    const messageIds = Array.isArray(body.messageIds) ? body.messageIds.slice(0, 200) : [];
    const now = new Date().toISOString();
    const rows = messageIds.map((messageId: string) => ({ room_id: channelId, message_id: messageId, user_id: user.id, delivered_at: now, read_at: now }));
    if (rows.length) {
      const { error } = await db.from('message_read_receipts').upsert(rows, { onConflict: 'message_id,user_id' });
      if (error && isModernChatSchemaError(error)) return NextResponse.json({ ok: true, readAt: now, messageIds, degraded: true });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, readAt: now, messageIds });
  }

  if (action === 'delivered') {
    const messageIds = Array.isArray(body.messageIds) ? body.messageIds.slice(0, 200) : [];
    const now = new Date().toISOString();
    const rows = messageIds.map((messageId: string) => ({ room_id: channelId, message_id: messageId, user_id: user.id, delivered_at: now }));
    if (rows.length) {
      const { error } = await db.from('message_read_receipts').upsert(rows, { onConflict: 'message_id,user_id' });
      if (error && isModernChatSchemaError(error)) return NextResponse.json({ ok: true, deliveredAt: now, messageIds, degraded: true });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, deliveredAt: now, messageIds });
  }

  if (action === 'reaction') {
    const messageId = String(body.messageId ?? '');
    const emoji = String(body.emoji ?? '').slice(0, 16);
    const active = Boolean(body.active);
    if (!messageId || !emoji) return NextResponse.json({ error: 'messageId and emoji required' }, { status: 400 });
    if (active) {
      const { error } = await db.from('message_reactions').upsert({ message_id: messageId, user_id: user.id, emoji }, { onConflict: 'message_id,user_id,emoji' });
      if (error && isModernChatSchemaError(error)) return NextResponse.json({ ok: true, degraded: true });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    } else {
      const { error } = await db.from('message_reactions').delete().eq('message_id', messageId).eq('user_id', user.id).eq('emoji', emoji);
      if (error && isModernChatSchemaError(error)) return NextResponse.json({ ok: true, degraded: true });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  const messageId = String(body?.messageId ?? '');
  const content = String(body?.content ?? '').trim().slice(0, 2000);
  if (!messageId || !content) return NextResponse.json({ error: 'messageId and content required' }, { status: 400 });

  const { data: msg } = await db.from('messages').select('sender_id').eq('id', messageId).eq('room_id', channelId).maybeSingle();
  if (!msg) return NextResponse.json({ error: 'Message not found' }, { status: 404 });
  if (msg.sender_id !== user.id) return NextResponse.json({ error: 'Only the sender can edit this message' }, { status: 403 });

  const { data: row, error } = await db
    .from('messages')
    .update({ content, edited_at: new Date().toISOString() })
    .eq('id', messageId)
    .select(messageSelect())
    .single();

  if (error && isModernChatSchemaError(error)) {
    let { data: fallbackRow, error: fallbackError } = await db
      .from('messages')
      .update({ content, edited_at: new Date().toISOString() })
      .eq('id', messageId)
      .select(baseMessageSelect())
      .single();
    if (fallbackError && isModernChatSchemaError(fallbackError)) {
      ({ data: fallbackRow, error: fallbackError } = await db
        .from('messages')
        .update({ content, edited_at: new Date().toISOString() })
        .eq('id', messageId)
        .select('*')
        .single());
    }
    if (fallbackError) return NextResponse.json({ error: fallbackError.message }, { status: 500 });
    return NextResponse.json({ message: await serializeMessage(fallbackRow, db) });
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ message: await serializeMessage(row, db) });
}

export async function DELETE(req: Request, { params }: { params: Promise<Params> | Params }) {
  const { libraryId, channelId } = await params;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const membership = await verifyMembership(supabase, libraryId, user.id);
  if (!membership) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const messageId = body?.messageId;
  if (!messageId) return NextResponse.json({ error: 'messageId required' }, { status: 400 });

  const db = createAdminClient() ?? supabase;
  const { data: room, error: roomError } = await requireRoomInLibrary(db, libraryId, channelId);
  if (roomError) return NextResponse.json({ error: roomError.message }, { status: 500 });
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

  const { data: msg } = await db.from('messages').select('sender_id').eq('id', messageId).eq('room_id', channelId).maybeSingle();
  if (!msg) return NextResponse.json({ error: 'Message not found' }, { status: 404 });

  const isOwner = ['owner', 'admin'].includes(membership.role);
  if (msg.sender_id !== user.id && !isOwner) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });

  let { error } = await db.from('messages').update({ deleted: true, deleted_at: new Date().toISOString() }).eq('id', messageId);
  if (error && isModernChatSchemaError(error)) {
    ({ error } = await db.from('messages').update({ deleted: true }).eq('id', messageId));
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
