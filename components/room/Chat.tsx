'use client';

// Chat.tsx — persistent WhatsApp/Discord-style room chat.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Check,
  CheckCheck,
  Download,
  Edit3,
  File,
  Image as ImageIcon,
  Paperclip,
  Reply,
  Search,
  Send,
  SmilePlus,
  Trash2,
  X,
} from 'lucide-react';
import { useParams } from 'next/navigation';
import { getSocket } from '@/lib/socket/client';
import { createClient } from '@/lib/supabase/client';
import { usePresenceStore } from '@/store/presenceStore';
import type { ChatAttachment, ChatMessage, ChatReaction } from '@/types';

interface ChatProps {
  roomId: string;
  onClose?: () => void;
}

const messageCache = new Map<string, ChatMessage[]>();
const loadedRooms = new Set<string>();
const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDay(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

function summarize(msg: ChatMessage) {
  if (msg.content) return msg.content;
  if (msg.attachmentName) return msg.attachmentName;
  if (msg.attachmentType) return `${msg.attachmentType} attachment`;
  return 'Message';
}

function reactionGroups(reactions: ChatReaction[] = []) {
  const groups = new Map<string, ChatReaction[]>();
  reactions.forEach((r) => groups.set(r.emoji, [...(groups.get(r.emoji) ?? []), r]));
  return Array.from(groups.entries());
}

function attachmentIcon(kind?: string | null) {
  if (kind === 'image') return ImageIcon;
  return File;
}

export function Chat({ roomId, onClose }: ChatProps) {
  const self = usePresenceStore((s) => s.self);
  const users = usePresenceStore((s) => s.users);
  const params = useParams();
  const libraryId = params?.libraryId as string | undefined;
  const channelId = params?.channelId as string | undefined;
  const canUseAdvancedApi = Boolean(libraryId && channelId);

  const [messages, setMessages] = useState<ChatMessage[]>(() => messageCache.get(roomId) ?? []);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(!loadedRooms.has(roomId));
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [typing, setTyping] = useState<Record<string, { name: string; ts: number }>>({});
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [mediaOpen, setMediaOpen] = useState(false);
  const [mediaMessages, setMediaMessages] = useState<ChatMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);
  const [hasOlder, setHasOlder] = useState(true);
  const [activeActionsId, setActiveActionsId] = useState<string | null>(null);

  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const typingStopRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingThrottleRef = useRef(0);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAtBottomRef = useRef(isAtBottom);
  const selfRef = useRef(self);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);

  const messagesEndpoint = canUseAdvancedApi
    ? `/api/libraries/${libraryId}/channels/${channelId}/messages`
    : `/api/rooms/${roomId}/messages`;
  const attachmentsEndpoint = `/api/libraries/${libraryId}/channels/${channelId}/messages/attachments`;

  if (!supabaseRef.current) supabaseRef.current = createClient();

  useEffect(() => { isAtBottomRef.current = isAtBottom; }, [isAtBottom]);
  useEffect(() => { selfRef.current = self; }, [self]);

  const updateMessages = useCallback((updater: (prev: ChatMessage[]) => ChatMessage[]) => {
    setMessages((prev) => {
      const next = updater(prev);
      messageCache.set(roomId, next);
      return next;
    });
  }, [roomId]);

  const loadMessages = useCallback(async (opts?: { before?: string; search?: string }) => {
    const before = opts?.before ? `&before=${encodeURIComponent(opts.before)}` : '';
    const q = opts?.search ? `&search=${encodeURIComponent(opts.search)}` : '';
    const res = await fetch(`${messagesEndpoint}?limit=80${before}${q}`);
    if (!res.ok) throw new Error('Failed to load messages');
    const { messages: loaded } = await res.json();
    return (loaded as ChatMessage[]).sort((a, b) => a.ts - b.ts);
  }, [messagesEndpoint]);

  useEffect(() => {
    if (loadedRooms.has(roomId) && !search) {
      setMessages(messageCache.get(roomId) ?? []);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    loadMessages(search ? { search } : undefined)
      .then((loaded) => {
        if (cancelled) return;
        if (!search) {
          messageCache.set(roomId, loaded);
          loadedRooms.add(roomId);
        }
        setMessages(loaded);
        setHasOlder(loaded.length >= 80);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) {
          console.error('[chat] load failed:', err);
          setError('Failed to load messages');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [loadMessages, roomId, search]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket.connected) socket.connect();

    const upsert = (msg: ChatMessage) => {
      if (msg.roomId !== roomId) return;
      updateMessages((prev) => {
        const existing = prev.find((m) => m.id === msg.id);
        return existing
          ? prev.map((m) => (m.id === msg.id ? { ...m, ...msg } : m))
          : [...prev, msg].sort((a, b) => a.ts - b.ts);
      });
      const currentSelf = selfRef.current;
      const own = currentSelf?.userId && msg.userId.startsWith(currentSelf.userId.split('_')[0]);
      if (!own && !isAtBottomRef.current) {
        setUnreadCount((n) => n + 1);
        setFirstUnreadId((id) => id ?? msg.id);
      }
    };

    const handleDelete = (payload: { roomId: string; messageId: string }) => {
      if (payload.roomId !== roomId) return;
      updateMessages((prev) => prev.filter((m) => m.id !== payload.messageId));
    };

    const handleReaction = (payload: { roomId: string; messageId: string; userId: string; emoji: string; active: boolean }) => {
      if (payload.roomId !== roomId) return;
      updateMessages((prev) => prev.map((m) => {
        if (m.id !== payload.messageId) return m;
        const reactions = (m.reactions ?? []).filter((r) => !(r.userId === payload.userId && r.emoji === payload.emoji));
        return { ...m, reactions: payload.active ? [...reactions, { messageId: m.id, userId: payload.userId, emoji: payload.emoji }] : reactions };
      }));
    };

    const handleRead = (payload: { roomId: string; messageIds: string[]; userId: string; readAt: string }) => {
      if (payload.roomId !== roomId) return;
      const ids = new Set(payload.messageIds);
      updateMessages((prev) => prev.map((m) => {
        if (!ids.has(m.id)) return m;
        const receipts = (m.receipts ?? []).filter((r) => r.userId !== payload.userId);
        return { ...m, receipts: [...receipts, { roomId, messageId: m.id, userId: payload.userId, deliveredAt: payload.readAt, readAt: payload.readAt }] };
      }));
    };

    const handleDelivered = (payload: { roomId: string; messageIds: string[]; userId: string; deliveredAt: string }) => {
      if (payload.roomId !== roomId) return;
      const ids = new Set(payload.messageIds);
      updateMessages((prev) => prev.map((m) => {
        if (!ids.has(m.id)) return m;
        const existing = (m.receipts ?? []).find((r) => r.userId === payload.userId);
        const receipts = (m.receipts ?? []).filter((r) => r.userId !== payload.userId);
        return { ...m, receipts: [...receipts, { roomId, messageId: m.id, userId: payload.userId, deliveredAt: existing?.deliveredAt ?? payload.deliveredAt, readAt: existing?.readAt ?? null }] };
      }));
    };

    const handleTyping = (payload: { roomId: string; userId: string; userName: string; typing: boolean; ts: number }) => {
      const currentSelf = selfRef.current;
      if (payload.roomId !== roomId || payload.userId.split('_')[0] === currentSelf?.userId.split('_')[0]) return;
      setTyping((prev) => {
        const next = { ...prev };
        if (payload.typing) next[payload.userId] = { name: payload.userName, ts: payload.ts };
        else delete next[payload.userId];
        return next;
      });
    };

    const handleUpdate = (payload: { roomId: string; message: ChatMessage }) => upsert(payload.message);
    const handleConnect = async () => {
      try {
        const refreshed = await loadMessages();
        updateMessages((prev) => {
          const byId = new Map(prev.map((m) => [m.id, m]));
          refreshed.forEach((m) => byId.set(m.id, { ...(byId.get(m.id) ?? {}), ...m }));
          return Array.from(byId.values()).sort((a, b) => a.ts - b.ts);
        });
      } catch {
        // Reconnect refresh is best-effort; the normal API load still owns errors.
      }
    };

    socket.on('chat:message', upsert);
    socket.on('chat:update', handleUpdate);
    socket.on('chat:delete', handleDelete);
    socket.on('chat:reaction', handleReaction);
    socket.on('chat:delivered', handleDelivered);
    socket.on('chat:read', handleRead);
    socket.on('chat:typing', handleTyping);
    socket.on('connect', handleConnect);
    return () => {
      socket.off('chat:message', upsert);
      socket.off('chat:update', handleUpdate);
      socket.off('chat:delete', handleDelete);
      socket.off('chat:reaction', handleReaction);
      socket.off('chat:delivered', handleDelivered);
      socket.off('chat:read', handleRead);
      socket.off('chat:typing', handleTyping);
      socket.off('connect', handleConnect);
    };
  }, [loadMessages, roomId, updateMessages]);

  useEffect(() => {
    const supabase = supabaseRef.current;
    if (!supabase) return;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;

    const refreshRecent = () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(async () => {
        try {
          const refreshed = await loadMessages();
          updateMessages((prev) => {
            const byId = new Map(prev.map((m) => [m.id, m]));
            refreshed.forEach((m) => byId.set(m.id, { ...(byId.get(m.id) ?? {}), ...m }));
            return Array.from(byId.values()).filter((m) => !m.deleted).sort((a, b) => a.ts - b.ts);
          });
        } catch {
          // Socket.IO remains the primary realtime path; this is a quiet fallback.
        }
      }, 150);
    };

    const channel = supabase
      .channel(`chat-messages:${roomId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
        refreshRecent
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
        (payload) => {
          const next = payload.new as any;
          if (next?.deleted) {
            updateMessages((prev) => prev.filter((m) => m.id !== next.id));
            return;
          }
          refreshRecent();
        }
      )
      .on(
        'postgres_changes',
        { event: 'DELETE', schema: 'public', table: 'messages', filter: `room_id=eq.${roomId}` },
        (payload) => {
          const old = payload.old as any;
          if (old?.id) updateMessages((prev) => prev.filter((m) => m.id !== old.id));
        }
      )
      .subscribe();

    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      supabase.removeChannel(channel);
    };
  }, [loadMessages, roomId, updateMessages]);

  useEffect(() => {
    const timer = setInterval(() => {
      const cutoff = Date.now() - 4500;
      setTyping((prev) => Object.fromEntries(Object.entries(prev).filter(([, v]) => v.ts > cutoff)));
    }, 1500);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => () => {
    if (longPressRef.current) clearTimeout(longPressRef.current);
    if (typingStopRef.current) clearTimeout(typingStopRef.current);
  }, []);

  useEffect(() => {
    const socket = getSocket();
    const handleProfileUpdate = (payload: { userId: string; userName: string; avatarUrl: string | null }) => {
      updateMessages((prev) => {
        const baseId = payload.userId.split('_')[0];
        return prev.map((m) => (
          m.userId.startsWith(baseId)
            ? { ...m, userName: payload.userName, avatarUrl: payload.avatarUrl }
            : m
        ));
      });
    };
    socket.on('profile:updated', handleProfileUpdate);
    return () => { socket.off('profile:updated', handleProfileUpdate); };
  }, [updateMessages]);

  useEffect(() => {
    if (isAtBottom) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      setUnreadCount(0);
      setFirstUnreadId(null);
    }
  }, [messages, isAtBottom]);

  useEffect(() => {
    if (!self || !isAtBottom || !canUseAdvancedApi) return;
    const selfBaseId = self.userId.split('_')[0];
    const readable = messages.filter((m) => !m.userId.startsWith(selfBaseId) && !(m.receipts ?? []).some((r) => r.userId === selfBaseId && r.readAt));
    if (readable.length === 0) return;
    const messageIds = readable.map((m) => m.id);
    const readAt = new Date().toISOString();
    fetch(messagesEndpoint, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'read', messageIds }),
    }).then((res) => {
      if (res.ok) {
        updateMessages((prev) => prev.map((m) => messageIds.includes(m.id)
          ? { ...m, receipts: [...(m.receipts ?? []).filter((r) => r.userId !== selfBaseId), { roomId, messageId: m.id, userId: selfBaseId, deliveredAt: readAt, readAt }] }
          : m));
        getSocket().emit('chat:read', { roomId, messageIds, userId: selfBaseId, readAt });
      }
    }).catch(() => {});
  }, [canUseAdvancedApi, isAtBottom, messages, messagesEndpoint, roomId, self, updateMessages]);

  useEffect(() => {
    if (!self || !canUseAdvancedApi) return;
    const selfBaseId = self.userId.split('_')[0];
    const deliverable = messages.filter((m) => !m.userId.startsWith(selfBaseId) && !(m.receipts ?? []).some((r) => r.userId === selfBaseId && (r.deliveredAt || r.readAt)));
    if (deliverable.length === 0) return;
    const messageIds = deliverable.map((m) => m.id);
    const deliveredAt = new Date().toISOString();
    fetch(messagesEndpoint, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'delivered', messageIds }),
    }).then((res) => {
      if (res.ok) {
        updateMessages((prev) => prev.map((m) => messageIds.includes(m.id)
          ? { ...m, receipts: [...(m.receipts ?? []).filter((r) => r.userId !== selfBaseId), { roomId, messageId: m.id, userId: selfBaseId, deliveredAt, readAt: null }] }
          : m));
        getSocket().emit('chat:delivered', { roomId, messageIds, userId: selfBaseId, deliveredAt });
      }
    }).catch(() => {});
  }, [canUseAdvancedApi, messages, messagesEndpoint, roomId, self, updateMessages]);

  const loadOlder = useCallback(async () => {
    const first = messages[0];
    if (!first?.createdAt || loadingOlder || search || !hasOlder) return;
    const el = scrollRef.current;
    const previousHeight = el?.scrollHeight ?? 0;
    setLoadingOlder(true);
    try {
      const older = await loadMessages({ before: first.createdAt });
      setHasOlder(older.length >= 80);
      updateMessages((prev) => {
        const ids = new Set(prev.map((m) => m.id));
        return [...older.filter((m) => !ids.has(m.id)), ...prev].sort((a, b) => a.ts - b.ts);
      });
      requestAnimationFrame(() => {
        if (el) el.scrollTop = el.scrollHeight - previousHeight;
      });
    } finally {
      setLoadingOlder(false);
    }
  }, [hasOlder, loadMessages, loadingOlder, messages, search, updateMessages]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setIsAtBottom(atBottom);
    if (el.scrollTop < 120 && hasOlder && !loadingOlder && !search) {
      loadOlder();
    }
  }, [hasOlder, loadingOlder, loadOlder, search]);

  const emitTyping = useCallback((value: string) => {
    if (!self) return;
    const now = Date.now();
    if (now - typingThrottleRef.current > 1200) {
      typingThrottleRef.current = now;
      getSocket().emit('chat:typing', { roomId, userId: self.userId, userName: self.userName, typing: Boolean(value), ts: now });
    }
    if (typingStopRef.current) clearTimeout(typingStopRef.current);
    typingStopRef.current = setTimeout(() => {
      getSocket().emit('chat:typing', { roomId, userId: self.userId, userName: self.userName, typing: false, ts: Date.now() });
    }, 2200);
  }, [roomId, self]);

  const uploadAttachment = useCallback(async () => {
    if (!attachment || !canUseAdvancedApi) return null;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', attachment);
      const res = await fetch(attachmentsEndpoint, { method: 'POST', body: form });
      if (!res.ok) throw new Error('Failed to upload attachment');
      const data = await res.json();
      return data.attachment;
    } finally {
      setUploading(false);
    }
  }, [attachment, attachmentsEndpoint, canUseAdvancedApi]);

  const send = useCallback(async () => {
    if (!self || (!input.trim() && !attachment) || uploading) return;

    if (editing) {
      const content = input.trim();
      const res = await fetch(messagesEndpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'edit', messageId: editing.id, content }),
      });
      if (!res.ok) return setError('Failed to edit message');
      const { message } = await res.json();
      updateMessages((prev) => prev.map((m) => (m.id === message.id ? message : m)));
      getSocket().emit('chat:update', { roomId, message });
      setEditing(null);
      setInput('');
      return;
    }

    const optimisticId = crypto.randomUUID();
    const text = input.trim().slice(0, 2000);
    const optimistic: ChatMessage = {
      id: optimisticId,
      roomId,
      userId: self.userId,
      userName: self.userName,
      avatarColor: self.avatarColor,
      avatarUrl: self.avatarUrl ?? null,
      content: text,
      replyToMessageId: replyTo?.id ?? null,
      replyTo: replyTo ? { id: replyTo.id, userId: replyTo.userId, userName: replyTo.userName, content: summarize(replyTo), attachmentType: replyTo.attachmentType } : null,
      attachmentName: attachment?.name ?? null,
      attachmentType: attachment ? (attachment.type.startsWith('image/') ? 'image' : attachment.type.startsWith('video/') ? 'video' : attachment.type === 'application/pdf' ? 'pdf' : 'file') : null,
      ts: Date.now(),
      receipts: [],
      reactions: [],
    };

    updateMessages((prev) => [...prev, optimistic]);
    setInput('');
    setAttachment(null);
    setReplyTo(null);
    setIsAtBottom(true);
    if (fileRef.current) fileRef.current.value = '';

    try {
      const uploaded = await uploadAttachment();
      const res = await fetch(messagesEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: optimisticId,
          content: text,
          userName: self.userName,
          avatarColor: self.avatarColor,
          avatarUrl: self.avatarUrl,
          replyToMessageId: optimistic.replyToMessageId,
          attachment: uploaded,
        }),
      });
      if (!res.ok) throw new Error('Failed to send message');
      const { message } = await res.json();
      updateMessages((prev) => prev.map((m) => (m.id === optimisticId ? message : m)));
      getSocket().emit('chat:message', message);
    } catch (err) {
      console.error('[chat] send failed:', err);
      updateMessages((prev) => prev.filter((m) => m.id !== optimisticId));
      setError('Failed to send message');
      setTimeout(() => setError(null), 3000);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [attachment, editing, input, messagesEndpoint, roomId, self, updateMessages, uploadAttachment, uploading, replyTo]);

  const removeMessage = useCallback(async (msg: ChatMessage) => {
    const res = await fetch(messagesEndpoint, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messageId: msg.id }),
    });
    if (!res.ok) return setError('Failed to delete message');
    updateMessages((prev) => prev.filter((m) => m.id !== msg.id));
    getSocket().emit('chat:delete', { roomId, messageId: msg.id });
  }, [messagesEndpoint, roomId, updateMessages]);

  const toggleReaction = useCallback(async (msg: ChatMessage, emoji: string) => {
    if (!self || !canUseAdvancedApi) return;
    const selfBaseId = self.userId.split('_')[0];
    const active = !(msg.reactions ?? []).some((r) => r.userId === selfBaseId && r.emoji === emoji);
    updateMessages((prev) => prev.map((m) => {
      if (m.id !== msg.id) return m;
      const reactions = (m.reactions ?? []).filter((r) => !(r.userId === selfBaseId && r.emoji === emoji));
      return { ...m, reactions: active ? [...reactions, { messageId: msg.id, userId: selfBaseId, emoji }] : reactions };
    }));
    await fetch(messagesEndpoint, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reaction', messageId: msg.id, emoji, active }),
    });
    getSocket().emit('chat:reaction', { roomId, messageId: msg.id, userId: selfBaseId, emoji, active });
  }, [canUseAdvancedApi, messagesEndpoint, roomId, self, updateMessages]);

  const clearForMe = useCallback(async () => {
    if (!canUseAdvancedApi) return;
    const res = await fetch(messagesEndpoint, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'clear' }),
    });
    if (res.ok) {
      updateMessages(() => []);
      loadedRooms.delete(roomId);
      setUnreadCount(0);
    }
  }, [canUseAdvancedApi, messagesEndpoint, roomId, updateMessages]);

  const openMedia = useCallback(async () => {
    setMediaOpen(true);
    const res = await fetch(`${messagesEndpoint}?limit=120&media=1`);
    if (res.ok) {
      const { messages: loaded } = await res.json();
      setMediaMessages(loaded);
    }
  }, [messagesEndpoint]);

  const jumpTo = useCallback((id: string) => {
    const el = document.getElementById(`chat-msg-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('ring-2', 'ring-blue-400/70');
      setTimeout(() => el.classList.remove('ring-2', 'ring-blue-400/70'), 1200);
    } else {
      setError('Original message is outside the loaded history');
      setTimeout(() => setError(null), 2500);
    }
  }, []);

  const clearComposerContext = useCallback(() => {
    setReplyTo(null);
    setEditing(null);
    setAttachment(null);
    setInput('');
    if (fileRef.current) fileRef.current.value = '';
  }, []);

  const startLongPress = useCallback((messageId: string) => {
    if (longPressRef.current) clearTimeout(longPressRef.current);
    longPressRef.current = setTimeout(() => setActiveActionsId(messageId), 450);
  }, []);

  const cancelLongPress = useCallback(() => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  }, []);

  const resolvedTyping = Object.values(typing).map((t) => t.name).slice(0, 2).join(', ');

  const mediaByKind = useMemo(() => ({
    images: mediaMessages.filter((m) => m.attachmentType === 'image'),
    videos: mediaMessages.filter((m) => m.attachmentType === 'video'),
    files: mediaMessages.filter((m) => m.attachmentType === 'file'),
    pdfs: mediaMessages.filter((m) => m.attachmentType === 'pdf'),
  }), [mediaMessages]);
  const visibleMediaSections = useMemo(() => (
    (['images', 'videos', 'pdfs', 'files'] as const).filter((kind) => mediaByKind[kind].length > 0)
  ), [mediaByKind]);

  const renderAttachment = (msg: ChatMessage) => {
    const attachmentData = msg.attachments?.[0];
    const hasAttachment = Boolean(attachmentData || msg.attachmentUrl || msg.attachmentName || msg.storagePath || msg.attachmentType);
    if (!hasAttachment) return null;
    const url = attachmentData?.url ?? msg.attachmentUrl;
    const name = attachmentData?.name ?? msg.attachmentName ?? 'Attachment';
    const kind = attachmentData?.kind ?? msg.attachmentType;
    if (kind === 'image' && url) {
      return <a href={url} target="_blank" rel="noopener noreferrer"><img src={url} alt={name} loading="lazy" className="mt-2 max-h-56 rounded-lg object-cover border border-room-border" /></a>;
    }
    if (kind === 'video' && url) {
      return <video src={url} controls preload="metadata" className="mt-2 max-h-56 w-full rounded-lg border border-room-border" />;
    }
    const Icon = attachmentIcon(kind);
    return (
      <a href={url ?? '#'} target={url ? '_blank' : undefined} rel={url ? 'noopener noreferrer' : undefined} className="mt-2 flex items-center gap-2 rounded-lg border border-room-border bg-room-bg/70 px-3 py-2 text-xs text-room-text hover:border-blue-400/50">
        <Icon size={16} className="text-blue-300" />
        <span className="min-w-0 flex-1 truncate">{name}</span>
        {url && <Download size={14} className="text-room-muted" />}
      </a>
    );
  };

  return (
    <div className="relative flex h-full flex-col bg-room-surface">
      <div className="flex flex-none items-center gap-1 border-b border-room-border px-3 py-2">
        <button onClick={() => setSearchOpen((v) => !v)} className="rounded-lg p-2 text-room-muted hover:bg-room-bg hover:text-room-text" aria-label="Search messages"><Search size={16} /></button>
        {canUseAdvancedApi && <button onClick={openMedia} className="rounded-lg p-2 text-room-muted hover:bg-room-bg hover:text-room-text" aria-label="Media and files"><ImageIcon size={16} /></button>}
        {canUseAdvancedApi && <button onClick={clearForMe} className="rounded-lg p-2 text-room-muted hover:bg-room-bg hover:text-room-text" aria-label="Clear chat for me"><Trash2 size={16} /></button>}
        <div className="min-w-0 flex-1 text-center text-xs font-semibold uppercase tracking-wide text-room-muted">Chat</div>
        {onClose && <button onClick={onClose} className="rounded-lg p-2 text-room-muted hover:bg-room-bg hover:text-room-text" aria-label="Close chat"><X size={16} /></button>}
      </div>

      {searchOpen && (
        <div className="flex flex-none items-center gap-2 border-b border-room-border px-3 py-2">
          <Search size={15} className="text-room-muted" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search text, sender, files" className="min-w-0 flex-1 bg-transparent text-sm text-room-text outline-none placeholder:text-room-muted" />
          {search && <button onClick={() => setSearch('')} className="text-room-muted hover:text-room-text" aria-label="Clear search"><X size={15} /></button>}
        </div>
      )}

      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-3 py-3">
        {!search && messages.length > 0 && hasOlder && (
          <button onClick={loadOlder} disabled={loadingOlder} className="mx-auto mb-3 block rounded-full border border-room-border px-3 py-1 text-xs text-room-muted hover:text-room-text disabled:opacity-50">
            {loadingOlder ? 'Loading…' : 'Load older'}
          </button>
        )}
        {loading && <p className="py-8 text-center text-xs text-room-muted">Loading messages…</p>}
        {!loading && messages.length === 0 && <p className="py-8 text-center text-xs text-room-muted">{search ? 'No matching messages' : 'No messages yet. Say hello!'}</p>}

        {messages.map((msg, index) => {
          const prev = messages[index - 1];
          const sameUser = prev?.userId === msg.userId;
          const closeTime = prev ? msg.ts - prev.ts < 2 * 60 * 1000 : false;
          const grouped = sameUser && closeTime && formatDay(prev.ts) === formatDay(msg.ts);
          const showDay = !prev || formatDay(prev.ts) !== formatDay(msg.ts);
          const isSelf = Boolean(self?.userId && msg.userId.startsWith(self.userId.split('_')[0]));
          const displayName = isSelf ? self?.userName ?? msg.userName : msg.userName;
          const avatar = isSelf ? self : Array.from(users.values()).find((u) => u.userId.startsWith(msg.userId.split('_')[0]));
          const receipts = msg.receipts ?? [];
          const read = isSelf && receipts.some((r) => r.userId !== self?.userId && r.readAt);
          const delivered = isSelf && receipts.some((r) => r.userId !== self?.userId && (r.deliveredAt || r.readAt));
          const actionsOpen = activeActionsId === msg.id;

          return (
            <React.Fragment key={msg.id}>
              {showDay && <div className="sticky top-2 z-10 mx-auto my-3 w-fit rounded-full bg-room-bg/90 px-3 py-1 text-[10px] font-medium text-room-muted shadow-sm">{formatDay(msg.ts)}</div>}
              {firstUnreadId === msg.id && <div className="my-3 border-t border-blue-400/40 pt-2 text-center text-[10px] font-semibold uppercase tracking-wide text-blue-300">Unread</div>}
              <div
                id={`chat-msg-${msg.id}`}
                tabIndex={0}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setActiveActionsId((id) => (id === msg.id ? null : msg.id));
                }}
                onTouchStart={() => startLongPress(msg.id)}
                onTouchMove={cancelLongPress}
                onTouchEnd={cancelLongPress}
                onFocus={() => setActiveActionsId(msg.id)}
                onBlur={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setActiveActionsId(null);
                }}
                className={`group flex gap-2.5 rounded-lg px-1.5 py-1 outline-none transition ${grouped ? 'mt-0.5' : 'mt-3'} ${isSelf ? 'flex-row-reverse' : ''}`}
              >
                {!grouped ? (
                  <div className="mt-0.5 h-7 w-7 flex-shrink-0 overflow-hidden rounded-full ring-1 ring-room-border" style={avatar?.avatarUrl ? {} : { backgroundColor: avatar?.avatarColor ?? msg.avatarColor }}>
                    {avatar?.avatarUrl || msg.avatarUrl ? <img src={avatar?.avatarUrl ?? msg.avatarUrl ?? ''} alt={displayName} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-[11px] font-semibold text-white">{avatar?.avatarInitials ?? '?'}</div>}
                  </div>
                ) : <div className="h-7 w-7 flex-shrink-0" />}

                <div className={`min-w-0 max-w-[86%] ${isSelf ? 'items-end' : 'items-start'} flex flex-col`}>
                  {!grouped && (
                    <div className={`mb-0.5 flex items-baseline gap-2 ${isSelf ? 'flex-row-reverse' : ''}`}>
                      <span className="truncate text-sm font-semibold text-room-text">{isSelf ? 'You' : displayName}</span>
                      <span className="text-[10px] text-room-muted">{formatTime(msg.ts)}</span>
                    </div>
                  )}
                  <div className={`rounded-xl border px-3 py-2 text-sm leading-relaxed shadow-sm ${isSelf ? 'border-blue-500/30 bg-blue-500/15 text-room-text' : 'border-room-border bg-room-bg text-room-text/95'}`}>
                    {msg.replyTo && (
                      <button onClick={() => jumpTo(msg.replyTo!.id)} className="mb-2 block w-full rounded-md border-l-2 border-blue-400 bg-room-surface/60 px-2 py-1 text-left">
                        <span className="block truncate text-[11px] font-semibold text-blue-300">{msg.replyTo.userName}</span>
                        <span className="line-clamp-2 text-xs text-room-muted">{summarize(msg.replyTo as ChatMessage)}</span>
                      </button>
                    )}
                    {msg.content && <p className="break-words whitespace-pre-wrap">{msg.content}</p>}
                    {renderAttachment(msg)}
                    <div className="mt-1 flex items-center justify-end gap-1 text-[10px] text-room-muted">
                      {msg.editedAt && <span>edited</span>}
                      {grouped && <span>{formatTime(msg.ts)}</span>}
                      {isSelf && (read ? <CheckCheck size={13} className="text-blue-300" /> : delivered ? <CheckCheck size={13} /> : <Check size={13} />)}
                    </div>
                  </div>

                  <div className={`mt-1 flex flex-wrap items-center gap-1 ${isSelf ? 'justify-end' : 'justify-start'}`}>
                    {canUseAdvancedApi && (
                      <button onClick={() => setReplyTo(msg)} className="rounded-full bg-room-bg p-1 text-room-muted hover:text-room-text" aria-label="Reply">
                        <Reply size={13} />
                      </button>
                    )}
                    <div className={`${actionsOpen ? 'flex' : 'hidden md:group-hover:flex md:group-focus-within:flex'} flex-wrap items-center gap-1`}>
                      {canUseAdvancedApi && isSelf && <button onClick={() => { setEditing(msg); setInput(msg.content); setActiveActionsId(null); inputRef.current?.focus(); }} className="rounded-full bg-room-bg p-1 text-room-muted hover:text-room-text" aria-label="Edit"><Edit3 size={13} /></button>}
                      {canUseAdvancedApi && isSelf && <button onClick={() => { setActiveActionsId(null); removeMessage(msg); }} className="rounded-full bg-room-bg p-1 text-room-muted hover:text-red-300" aria-label="Delete"><Trash2 size={13} /></button>}
                      {canUseAdvancedApi && <div className="flex rounded-full bg-room-bg px-1">
                        {EMOJIS.map((emoji) => <button key={emoji} onClick={() => { setActiveActionsId(null); toggleReaction(msg, emoji); }} className="px-1 py-0.5 text-xs" aria-label={`React ${emoji}`}>{emoji}</button>)}
                      </div>}
                    </div>
                  </div>

                  {reactionGroups(msg.reactions).length > 0 && (
                    <div className={`mt-1 flex flex-wrap gap-1 ${isSelf ? 'justify-end' : 'justify-start'}`}>
                      {reactionGroups(msg.reactions).map(([emoji, items]) => (
                        <button key={emoji} onClick={() => toggleReaction(msg, emoji)} className="rounded-full border border-room-border bg-room-bg px-2 py-0.5 text-xs text-room-text">{emoji} {items.length}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </React.Fragment>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {unreadCount > 0 && <button onClick={() => { setIsAtBottom(true); bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }} className="absolute bottom-24 right-4 rounded-full bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white shadow-lg">Jump to latest ({unreadCount})</button>}

      {resolvedTyping && <div className="flex-none px-3 py-1 text-xs italic text-room-muted">{resolvedTyping} {Object.keys(typing).length === 1 ? 'is' : 'are'} typing…</div>}
      {error && <div className="flex-none border-t border-red-900/50 bg-red-900/20 px-3 py-2 text-xs text-red-200">{error}</div>}

      {(replyTo || editing || attachment) && (
        <div className="flex flex-none items-center gap-2 border-t border-room-border bg-room-bg/60 px-3 py-2">
          <div className="min-w-0 flex-1 text-xs text-room-muted">
            {editing ? <span>Editing message</span> : replyTo ? <span>Replying to <b className="text-room-text">{replyTo.userName}</b>: {summarize(replyTo)}</span> : null}
            {attachment && <span className="block truncate text-room-text"><Paperclip size={12} className="mr-1 inline" />{attachment.name}</span>}
          </div>
          <button onClick={clearComposerContext} className="rounded-lg p-1 text-room-muted hover:text-room-text" aria-label="Cancel"><X size={16} /></button>
        </div>
      )}

      <div className="flex-none border-t border-room-border p-3">
        <div className="flex items-end gap-2 rounded-xl border border-room-border bg-room-bg px-2 transition-colors focus-within:border-blue-500/50">
          <input ref={fileRef} type="file" className="hidden" onChange={(e) => setAttachment(e.target.files?.[0] ?? null)} accept="image/*,video/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip" />
          {canUseAdvancedApi && <button onClick={() => { if (fileRef.current) fileRef.current.value = ''; fileRef.current?.click(); }} className="mb-1.5 rounded-lg p-2 text-room-muted hover:bg-room-surface hover:text-room-text" aria-label="Attach file"><Paperclip size={18} /></button>}
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => { setInput(e.target.value); emitTyping(e.target.value); }}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
            placeholder="Message the room…"
            rows={1}
            maxLength={2000}
            className="max-h-28 min-h-[42px] flex-1 resize-none bg-transparent py-2.5 text-sm text-room-text outline-none placeholder:text-room-muted"
          />
          <button onClick={send} onMouseDown={(e) => e.preventDefault()} disabled={(!input.trim() && !attachment) || uploading} className="mb-1 rounded-xl p-2 text-blue-400 transition-colors hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-30" aria-label="Send">
            {uploading ? <SmilePlus size={18} className="animate-pulse" /> : <Send size={18} />}
          </button>
        </div>
      </div>

      {mediaOpen && (
        <div className="absolute inset-0 z-20 flex flex-col bg-room-surface">
          <div className="flex items-center gap-2 border-b border-room-border px-3 py-2">
            <h3 className="flex-1 text-sm font-semibold text-room-text">Media and Files</h3>
            <button onClick={() => setMediaOpen(false)} className="rounded-lg p-2 text-room-muted hover:bg-room-bg hover:text-room-text" aria-label="Close media"><X size={16} /></button>
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            {visibleMediaSections.length === 0 && (
              <p className="py-8 text-center text-xs text-room-muted">No media or files yet</p>
            )}
            {visibleMediaSections.map((kind) => (
              <section key={kind} className="mb-5">
                <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-room-muted">{kind}</h4>
                <div className={kind === 'images' || kind === 'videos' ? 'grid grid-cols-3 gap-2' : 'space-y-2'}>
                    {mediaByKind[kind].map((m) => {
                      const a = m.attachments?.[0];
                      const url = a?.url ?? m.attachmentUrl ?? '#';
                      const name = a?.name ?? m.attachmentName ?? 'Attachment';
                      return kind === 'images' ? (
                        <a key={m.id} href={url} target="_blank" rel="noopener noreferrer" className="aspect-square overflow-hidden rounded-lg border border-room-border bg-room-bg"><img src={url} alt={name} loading="lazy" className="h-full w-full object-cover" /></a>
                      ) : (
                        <a key={m.id} href={url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-lg border border-room-border bg-room-bg px-3 py-2 text-xs text-room-text hover:border-blue-400/50">
                          {React.createElement(attachmentIcon(m.attachmentType), { size: 16, className: 'text-blue-300' })}
                          <span className="min-w-0 flex-1 truncate">{name}</span>
                          <Download size={14} className="text-room-muted" />
                        </a>
                      );
                    })}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
