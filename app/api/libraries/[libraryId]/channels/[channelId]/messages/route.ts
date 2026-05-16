// app/api/libraries/[libraryId]/channels/[channelId]/messages/route.ts
// Permanent Supabase-backed chat messages — replaces ephemeral Redis storage.
import { createAdminClient, createClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';
import type { ChatMessage } from '@/types';
import { requireRoomInLibrary } from '@/lib/backend/readroom';

type Params = { libraryId: string; channelId: string };

function serializeMessage(row: any): ChatMessage {
  const profile = row.sender ?? row.users ?? null;
  return {
    id: row.id,
    roomId: row.room_id,
    userId: row.sender_id ?? row.user_id ?? '',
    userName: profile?.display_name ?? row.sender_name ?? row.user_name ?? 'Reader',
    avatarColor: row.avatar_color ?? '#6366f1',
    avatarUrl: profile?.avatar_url ?? row.avatar_url ?? null,
    content: row.content,
    attachmentUrl: row.attachment_url ?? null,
    attachmentType: row.attachment_type ?? null,
    deleted: row.deleted ?? false,
    editedAt: row.edited_at ?? null,
    ts: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    createdAt: row.created_at,
  };
}

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
  req: Request,
  { params }: { params: Promise<Params> | Params }
) {
  const { libraryId, channelId } = await params;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const membership = await verifyMembership(supabase, libraryId, user.id);
  if (!membership) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 200);
  const before = url.searchParams.get('before'); // ISO timestamp for pagination

  const db = createAdminClient() ?? supabase;
  const { data: room, error: roomError } = await requireRoomInLibrary(db, libraryId, channelId);
  if (roomError) return NextResponse.json({ error: roomError.message }, { status: 500 });
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

  let query = db
    .from('messages')
    .select('*, sender:users!messages_sender_id_fkey(id, display_name, avatar_url)')
    .eq('room_id', channelId)
    .eq('deleted', false)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (before) {
    query = query.lt('created_at', before);
  }

  const { data: rows, error } = await query;

  if (error) {
    // Graceful fallback: if the messages table doesn't exist yet (migration not run),
    // return empty array instead of 500 so the UI still loads.
    if (error.code === '42P01') {
      return NextResponse.json({ messages: [] });
    }
    console.error('[api/messages] GET failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Return in ascending order (oldest first) for display
  const messages = (rows ?? []).map(serializeMessage).reverse();
  return NextResponse.json({ messages });
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
  if (!body?.content?.trim()) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 });
  }

  const content = String(body.content).trim().slice(0, 2000);
  const db = createAdminClient() ?? supabase;
  const { data: room, error: roomError } = await requireRoomInLibrary(db, libraryId, channelId);
  if (roomError) return NextResponse.json({ error: roomError.message }, { status: 500 });
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

  const { data: profile } = await db
    .from('users')
    .select('display_name, avatar_url')
    .eq('id', user.id)
    .maybeSingle();

  const senderName = String(profile?.display_name ?? body.userName ?? body.senderName ?? 'Reader').trim().slice(0, 64);
  const avatarColor = String(body.avatarColor ?? '#6366f1').slice(0, 32);
  const avatarUrl = profile?.avatar_url ?? (body.avatarUrl ? String(body.avatarUrl).slice(0, 512) : null);
  const attachmentUrl = body.attachmentUrl ? String(body.attachmentUrl).slice(0, 512) : null;
  const attachmentType = body.attachmentType ?? null;

  const { data: row, error } = await db
    .from('messages')
    .insert({
      ...(body.id ? { id: body.id } : {}),
      room_id: channelId,
      sender_id: user.id,
      sender_name: senderName,
      avatar_color: avatarColor,
      avatar_url: avatarUrl,
      content,
      attachment_url: attachmentUrl,
      attachment_type: attachmentType,
    })
    .select()
    .single();

  if (error) {
    // Graceful fallback if migration not yet applied
    if (error.code === '42P01') {
      return NextResponse.json({ message: { id: body.id ?? crypto.randomUUID(), roomId: channelId, userId: user.id, userName: senderName, avatarColor, avatarUrl, content, ts: Date.now() } });
    }
    console.error('[api/messages] POST failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ message: serializeMessage(row) }, { status: 201 });
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
  if (!membership) return NextResponse.json({ error: 'Not a member' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const messageId = body?.messageId;
  if (!messageId) return NextResponse.json({ error: 'messageId required' }, { status: 400 });

  const db = createAdminClient() ?? supabase;
  const { data: room, error: roomError } = await requireRoomInLibrary(db, libraryId, channelId);
  if (roomError) return NextResponse.json({ error: roomError.message }, { status: 500 });
  if (!room) return NextResponse.json({ error: 'Room not found' }, { status: 404 });

  // Soft delete — only sender or admin/owner can delete
  const { data: msg } = await db
    .from('messages')
    .select('sender_id')
    .eq('id', messageId)
    .eq('room_id', channelId)
    .maybeSingle();

  if (!msg) return NextResponse.json({ error: 'Message not found' }, { status: 404 });

  const isOwner = ['owner', 'admin'].includes(membership.role);
  if (msg.sender_id !== user.id && !isOwner) {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }

  const { error } = await db
    .from('messages')
    .update({ deleted: true })
    .eq('id', messageId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
