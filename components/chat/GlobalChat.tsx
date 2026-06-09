'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Check,
  CheckCheck,
  Download,
  Edit3,
  File,
  Info,
  Image as ImageIcon,
  MoreVertical,
  Paperclip,
  Reply,
  Search,
  Send,
  SmilePlus,
  Trash2,
  Phone,
  X,
} from 'lucide-react';

import { createClient } from '@/lib/supabase/client';
import { usePresenceStore } from '@/store/presenceStore';
import { Avatar } from '@/components/ui/Avatar';
import type { ChatAttachment, ChatMessage, ChatReaction } from '@/types';

interface FloatingMenu {
  messageId: string;
  top: number;
  left: number;
  placement: 'above' | 'below';
  align: 'left' | 'right';
}

const GLOBAL_ROOM_ID = 'global-chat';
const messageCache = new Map<string, ChatMessage[]>();
const loadedRooms = new Set<string>();
const EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
const MENU_WIDTH = 176;
const MENU_HEIGHT = 190;
const MENU_MARGIN = 8;

function formatTime(ts: number) {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(value?: string | null) {
  if (!value) return 'Not yet';
  return new Date(value).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function positionMenu(anchor: DOMRect | { left: number; right: number; top: number; bottom: number }): Omit<FloatingMenu, 'messageId'> {
  const viewportWidth = typeof window === 'undefined' ? 390 : window.innerWidth;
  const viewportHeight = typeof window === 'undefined' ? 720 : window.innerHeight;
  const openAbove = anchor.bottom + MENU_HEIGHT + MENU_MARGIN > viewportHeight && anchor.top > MENU_HEIGHT;
  const alignRight = anchor.left + MENU_WIDTH > viewportWidth - MENU_MARGIN;
  const maxLeft = Math.max(MENU_MARGIN, viewportWidth - MENU_WIDTH - MENU_MARGIN);
  const maxTop = Math.max(MENU_MARGIN, viewportHeight - MENU_HEIGHT - MENU_MARGIN);
  const left = alignRight
    ? clamp(anchor.right - MENU_WIDTH, MENU_MARGIN, maxLeft)
    : clamp(anchor.left, MENU_MARGIN, maxLeft);
  const top = openAbove
    ? clamp(anchor.top - MENU_HEIGHT - 4, MENU_MARGIN, maxTop)
    : clamp(anchor.bottom + 4, MENU_MARGIN, maxTop);
  return { top, left, placement: openAbove ? 'above' : 'below', align: alignRight ? 'right' : 'left' };
}

export function GlobalChat() {
  const self = usePresenceStore((s) => s.self);
  const presenceProfiles = usePresenceStore(
    (s) => Array.from(s.users.values()).map(u => ({
      userId: u.userId,
      userName: u.userName,
      avatarUrl: u.avatarUrl,
      avatarColor: u.avatarColor,
      avatarInitials: u.avatarInitials
    })),
    (a, b) => {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) {
        if (a[i].userId !== b[i].userId) return false;
        if (a[i].userName !== b[i].userName) return false;
        if (a[i].avatarUrl !== b[i].avatarUrl) return false;
        if (a[i].avatarColor !== b[i].avatarColor) return false;
        if (a[i].avatarInitials !== b[i].avatarInitials) return false;
      }
      return true;
    }
  );

  const [messages, setMessages] = useState<ChatMessage[]>(() => messageCache.get(GLOBAL_ROOM_ID) ?? []);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(!loadedRooms.has(GLOBAL_ROOM_ID));
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const [editing, setEditing] = useState<ChatMessage | null>(null);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [activeTypers, setActiveTypers] = useState<Record<string, number>>({});
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [hasOlder, setHasOlder] = useState(true);
  const [activeMenu, setActiveMenu] = useState<FloatingMenu | null>(null);
  const [infoMessage, setInfoMessage] = useState<ChatMessage | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [mediaMessages, setMediaMessages] = useState<ChatMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);

  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chatChannelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null);
  const isAtBottomRef = useRef(true);
  const selfRef = useRef(self);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);

  const messagesEndpoint = '/api/chat/messages';
  const attachmentsEndpoint = '/api/chat/messages/attachments';

  if (!supabaseRef.current) supabaseRef.current = createClient();

  useEffect(() => { isAtBottomRef.current = isAtBottom; }, [isAtBottom]);
  useEffect(() => { selfRef.current = self; }, [self]);

  // Focus & Visibility change → isFocused & isActive + Redis heartbeat
  useEffect(() => {
    const syncRedis = (isFocused: boolean) => {
      fetch('/api/presence/focus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: 'global-chat', libraryId: 'global-library', isFocused }),
      }).catch(() => {}); // never block the UI
    };

    const handle = () => {
      const isActive = document.visibilityState === 'visible';
      const isFocused = isActive && document.hasFocus();
      syncRedis(isFocused);
    };

    document.addEventListener('visibilitychange', handle);
    window.addEventListener('focus', handle);
    window.addEventListener('blur', handle);

    // Initial sync
    syncRedis(typeof document !== 'undefined' ? (document.visibilityState === 'visible' && document.hasFocus()) : true);

    // 30-second heartbeat
    const heartbeat = setInterval(() => {
      const isActive = document.visibilityState === 'visible';
      const isFocused = isActive && document.hasFocus();
      if (isFocused) syncRedis(true);
    }, 30_000);

    return () => {
      document.removeEventListener('visibilitychange', handle);
      window.removeEventListener('focus', handle);
      window.removeEventListener('blur', handle);
      clearInterval(heartbeat);
      syncRedis(false);
    };
  }, []);

  const updateMessages = useCallback((updater: (prev: ChatMessage[]) => ChatMessage[]) => {
    setMessages((prev) => {
      const next = updater(prev);
      messageCache.set(GLOBAL_ROOM_ID, next);
      return next;
    });
  }, []);

  const loadMessages = useCallback(async (before?: string) => {
    try {
      const beforeQuery = before ? `&before=${encodeURIComponent(before)}` : '';
      const searchQuery = search ? `&search=${encodeURIComponent(search)}` : '';
      const res = await fetch(`${messagesEndpoint}?limit=80${beforeQuery}${searchQuery}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to load messages');
      
      const newMessages: ChatMessage[] = data.messages ?? [];
      const clearedTimeStr = data.clearedAt;
      const clearedTime = clearedTimeStr ? new Date(clearedTimeStr).getTime() : 0;

      const filtered = newMessages.filter((m) => m.ts > clearedTime);

      if (before) {
        updateMessages((prev) => {
          const merged = [...filtered, ...prev];
          const unique = Array.from(new Map(merged.map((m) => [m.id, m])).values());
          return unique.sort((a, b) => a.ts - b.ts);
        });
        setHasOlder(filtered.length >= 80);
      } else {
        updateMessages(() => filtered);
        setHasOlder(filtered.length >= 80);
        loadedRooms.add(GLOBAL_ROOM_ID);
      }
    } catch (err: any) {
      setError(err.message ?? 'Failed to load messages');
    }
  }, [messagesEndpoint, search, updateMessages]);

  // Initial load
  useEffect(() => {
    setLoading(true);
    setError(null);
    loadMessages().finally(() => setLoading(false));
  }, [loadMessages]);

  // Search trigger with debounce
  useEffect(() => {
    if (!search) return;
    const timer = setTimeout(() => {
      setLoading(true);
      loadMessages().finally(() => setLoading(false));
    }, 400);
    return () => clearTimeout(timer);
  }, [search, loadMessages]);

  const typingStopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isTypingRef = useRef(false);
  const typingTimerRefs = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const handleTypingStart = useCallback(() => {
    if (!self) return;

    if (!isTypingRef.current) {
      isTypingRef.current = true;
      chatChannelRef.current?.send({
        type: 'broadcast',
        event: 'chat:typing',
        payload: { roomId: GLOBAL_ROOM_ID, userId: self.userId, userName: self.userName, typing: true, ts: Date.now() }
      }).catch(() => {});
    }

    if (typingStopTimeoutRef.current) {
      clearTimeout(typingStopTimeoutRef.current);
    }

    typingStopTimeoutRef.current = setTimeout(() => {
      isTypingRef.current = false;
      chatChannelRef.current?.send({
        type: 'broadcast',
        event: 'chat:typing',
        payload: { roomId: GLOBAL_ROOM_ID, userId: self.userId, userName: self.userName, typing: false, ts: Date.now() }
      }).catch(() => {});
      typingStopTimeoutRef.current = null;
    }, 3000); // 3 seconds inactivity debounce
  }, [self]);

  const handleTypingStop = useCallback(() => {
    if (!self) return;
    if (typingStopTimeoutRef.current) {
      clearTimeout(typingStopTimeoutRef.current);
      typingStopTimeoutRef.current = null;
    }
    if (isTypingRef.current) {
      isTypingRef.current = false;
      chatChannelRef.current?.send({
        type: 'broadcast',
        event: 'chat:typing',
        payload: { roomId: GLOBAL_ROOM_ID, userId: self.userId, userName: self.userName, typing: false, ts: Date.now() }
      }).catch(() => {});
    }
  }, [self]);

  // Realtime subscription setup
  useEffect(() => {
    const supabase = supabaseRef.current;
    if (!supabase) return;

    const channel = supabase.channel(`chat-room:${GLOBAL_ROOM_ID}`);

    const upsert = (msg: ChatMessage) => {
      if (msg.roomId !== GLOBAL_ROOM_ID) return;
      updateMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === msg.id);
        const next = [...prev];
        if (idx !== -1) {
          next[idx] = { ...next[idx], ...msg };
        } else {
          next.push(msg);
        }
        return next.sort((a, b) => a.ts - b.ts);
      });

      // Handle unread badges
      const currentSelf = selfRef.current;
      const isSenderSelf = currentSelf?.userId && msg.userId && msg.userId.startsWith(currentSelf.userId.split('_')[0]);
      if (!isSenderSelf) {
        if (!isAtBottomRef.current) {
          setUnreadCount((c) => c + 1);
        } else {
          // Auto-mark read
          fetch(messagesEndpoint, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'read', messageIds: [msg.id] }),
          }).catch(() => {});
        }
      }
    };

    const handleDelete = (payload: { messageId: string }) => {
      updateMessages((prev) => prev.map((m) => m.id === payload.messageId ? { ...m, deleted: true, content: '' } : m));
    };

    const handleReaction = (payload: { messageId: string; userId: string; emoji: string; active: boolean }) => {
      updateMessages((prev) => prev.map((m) => {
        if (m.id !== payload.messageId) return m;
        const reactions = m.reactions ?? [];
        const filtered = reactions.filter((r) => !(r.userId === payload.userId && r.emoji === payload.emoji));
        if (payload.active) {
          filtered.push({ messageId: payload.messageId, userId: payload.userId, emoji: payload.emoji, createdAt: new Date().toISOString() });
        }
        return { ...m, reactions: filtered };
      }));
    };

    const handleDelivered = (payload: { messageIds: string[]; deliveredAt: string; userId: string }) => {
      const ids = new Set(payload.messageIds);
      const receiptUserId = payload.userId;
      updateMessages((prev) => prev.map((m) => {
        if (!ids.has(m.id)) return m;
        const existing = (m.receipts ?? []).find((r) => r.userId && String(r.userId).split('_')[0] === receiptUserId);
        const receipts = (m.receipts ?? []).filter((r) => r.userId && String(r.userId).split('_')[0] !== receiptUserId);
        return { ...m, receipts: [...receipts, { roomId: GLOBAL_ROOM_ID, messageId: m.id, userId: receiptUserId, deliveredAt: payload.deliveredAt, readAt: existing?.readAt ?? null }] };
      }));
    };

    const handleRead = (payload: { messageIds: string[]; readAt: string; userId: string }) => {
      const ids = new Set(payload.messageIds);
      const receiptUserId = payload.userId;
      updateMessages((prev) => prev.map((m) => {
        if (!ids.has(m.id)) return m;
        const existing = (m.receipts ?? []).find((r) => r.userId && String(r.userId).split('_')[0] === receiptUserId);
        const receipts = (m.receipts ?? []).filter((r) => r.userId && String(r.userId).split('_')[0] !== receiptUserId);
        return { ...m, receipts: [...receipts, { roomId: GLOBAL_ROOM_ID, messageId: m.id, userId: receiptUserId, deliveredAt: existing?.deliveredAt ?? payload.readAt, readAt: payload.readAt }] };
      }));
    };

    const handleTyping = (payload: { roomId: string; userId: string; userName: string; typing: boolean; ts: number }) => {
      const currentSelf = selfRef.current;
      if (payload.roomId !== GLOBAL_ROOM_ID || payload.userId === currentSelf?.userId) return;

      if (typingTimerRefs.current[payload.userId]) {
        clearTimeout(typingTimerRefs.current[payload.userId]);
        delete typingTimerRefs.current[payload.userId];
      }

      if (payload.typing) {
        setActiveTypers((prev) => ({ ...prev, [payload.userId]: Date.now() }));
        
        typingTimerRefs.current[payload.userId] = setTimeout(() => {
          setActiveTypers((prev) => {
            const next = { ...prev };
            delete next[payload.userId];
            return next;
          });
          delete typingTimerRefs.current[payload.userId];
        }, 5000);
      } else {
        setActiveTypers((prev) => {
          const next = { ...prev };
          delete next[payload.userId];
          return next;
        });
      }
    };

    channel
      .on('broadcast', { event: 'chat:message' }, ({ payload }) => upsert(payload as ChatMessage))
      .on('broadcast', { event: 'chat:update' }, ({ payload }: any) => upsert(payload.message as ChatMessage))
      .on('broadcast', { event: 'chat:delete' }, ({ payload }) => handleDelete(payload as any))
      .on('broadcast', { event: 'chat:reaction' }, ({ payload }) => handleReaction(payload as any))
      .on('broadcast', { event: 'chat:delivered' }, ({ payload }) => handleDelivered(payload as any))
      .on('broadcast', { event: 'chat:read' }, ({ payload }) => handleRead(payload as any))
      .on('broadcast', { event: 'chat:typing' }, ({ payload }) => handleTyping(payload as any))
      .subscribe();

    chatChannelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      // Clean up all typing timeouts
      Object.values(typingTimerRefs.current).forEach(clearTimeout);
      typingTimerRefs.current = {};
    };
  }, [updateMessages, messagesEndpoint]);

  // Auto-scroll logic
  useEffect(() => {
    if (isAtBottom) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto' });
    }
  }, [messages, isAtBottom]);

  // Mark messages delivered/read when focusing
  useEffect(() => {
    const unread = messages.filter((m) => {
      const isSelf = self?.userId && m.userId && m.userId.startsWith(self.userId.split('_')[0]);
      if (isSelf) return false;
      const receipts = m.receipts ?? [];
      const selfBaseId = self?.userId?.split('_')[0] || '';
      const read = receipts.some((r) => r.userId && String(r.userId).split('_')[0] === selfBaseId && r.readAt);
      return !read;
    });

    if (unread.length > 0 && isAtBottom) {
      const ids = unread.map((m) => m.id);
      fetch(messagesEndpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'read', messageIds: ids }),
      }).catch(() => {});
    }
  }, [messages, isAtBottom, self, messagesEndpoint]);

  const loadOlder = useCallback(async () => {
    if (loadingOlder || messages.length === 0) return;
    setLoadingOlder(true);
    const first = messages[0];
    await loadMessages(first.createdAt ?? new Date(first.ts).toISOString());
    setLoadingOlder(false);
  }, [loadingOlder, messages, loadMessages]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    const isClose = target.scrollHeight - target.scrollTop - target.clientHeight < 120;
    setIsAtBottom(isClose);
    if (isClose) {
      setUnreadCount(0);
    }
  }, []);

  const firstUnreadId = useMemo(() => {
    if (unreadCount <= 0) return null;
    const unreadMessages = messages.filter((m) => {
      const isSelf = self?.userId && m.userId && m.userId.startsWith(self.userId.split('_')[0]);
      if (isSelf) return false;
      const receipts = m.receipts ?? [];
      const selfBaseId = self?.userId?.split('_')[0] || '';
      const read = receipts.some((r) => r.userId && String(r.userId).split('_')[0] === selfBaseId && r.readAt);
      return !read;
    });
    return unreadMessages[0]?.id ?? null;
  }, [messages, unreadCount, self]);

  const uploadAttachment = useCallback(async () => {
    if (!attachment) return null;
    setUploading(true);
    try {
      const form = new FormData();
      form.append('file', attachment);
      const res = await fetch(attachmentsEndpoint, { method: 'POST', body: form });
      if (!res.ok) throw new Error('Failed to upload attachment');
      const data = await res.json();
      return data.attachment;
    } catch (err: any) {
      setError(err.message ?? 'Attachment upload failed');
      return null;
    } finally {
      setUploading(false);
      setAttachment(null);
    }
  }, [attachment, attachmentsEndpoint]);

  const send = useCallback(async () => {
    if (!self) return;
    const text = input.trim();
    if (!text && !attachment) return;

    setInput('');
    handleTypingStop();

    let uploaded = null;
    if (attachment) {
      uploaded = await uploadAttachment();
      if (!uploaded) return; // Keep composition context on fail
    }

    const clientMsgId = crypto.randomUUID();
    const tempMsg: ChatMessage = {
      id: clientMsgId,
      roomId: GLOBAL_ROOM_ID,
      userId: self.userId,
      userName: self.userName,
      avatarColor: self.avatarColor,
      avatarUrl: self.avatarUrl,
      content: text || uploaded?.name || 'Attachment',
      ts: Date.now(),
      replyToMessageId: replyTo?.id ?? null,
      replyTo: replyTo ? {
        id: replyTo.id,
        userId: replyTo.userId,
        userName: replyTo.userName,
        content: replyTo.content,
        attachmentType: replyTo.attachmentType,
      } : null,
      attachmentUrl: uploaded?.url ?? null,
      attachmentType: uploaded?.kind ?? null,
      attachmentName: uploaded?.name ?? null,
      attachmentSize: uploaded?.sizeBytes ?? null,
      attachmentMime: uploaded?.mimeType ?? null,
      storagePath: uploaded?.storagePath ?? null,
      reactions: [],
      receipts: [],
      createdAt: new Date().toISOString(),
    };

    // Optimistic insert
    updateMessages((prev) => [...prev, tempMsg]);
    setIsAtBottom(true);
    setReplyTo(null);

    try {
      const res = await fetch(messagesEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: clientMsgId,
          content: text,
          replyToMessageId: replyTo?.id ?? null,
          attachment: uploaded,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Failed to send message');

      updateMessages((prev) => prev.map((m) => m.id === clientMsgId ? data.message : m));
      chatChannelRef.current?.send({ type: 'broadcast', event: 'chat:message', payload: data.message }).catch(() => {});
    } catch (err: any) {
      setError(err.message ?? 'Failed to send');
      updateMessages((prev) => prev.filter((m) => m.id !== clientMsgId));
    }
  }, [attachment, input, messagesEndpoint, replyTo, self, updateMessages, uploadAttachment, handleTypingStop]);

  const beginReply = (msg: ChatMessage) => {
    setReplyTo(msg);
    setEditing(null);
    inputRef.current?.focus();
  };

  const clearComposerContext = () => {
    setReplyTo(null);
    setEditing(null);
    setAttachment(null);
    if (editing) setInput('');
  };

  const removeMessage = async (msg: ChatMessage) => {
    try {
      const res = await fetch(messagesEndpoint, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: msg.id }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Failed to delete message');
      }

      updateMessages((prev) => prev.map((m) => m.id === msg.id ? { ...m, deleted: true, content: '' } : m));
      chatChannelRef.current?.send({ type: 'broadcast', event: 'chat:delete', payload: { messageId: msg.id } }).catch(() => {});
    } catch (err: any) {
      setError(err.message ?? 'Delete failed');
    }
  };

  const toggleReaction = async (msg: ChatMessage, emoji: string) => {
    if (!self) return;
    const selfBaseId = self.userId.split('_')[0];
    const reactions = msg.reactions ?? [];
    const hasReacted = reactions.some((r) => r.userId && String(r.userId).split('_')[0] === selfBaseId && r.emoji === emoji);
    const nextActive = !hasReacted;

    updateMessages((prev) => prev.map((m) => {
      if (m.id !== msg.id) return m;
      const nextReactions = reactions.filter((r) => !(r.userId && String(r.userId).split('_')[0] === selfBaseId && r.emoji === emoji));
      if (nextActive) {
        nextReactions.push({ messageId: msg.id, userId: self.userId, emoji, createdAt: new Date().toISOString() });
      }
      return { ...m, reactions: nextReactions };
    }));

    try {
      const res = await fetch(messagesEndpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reaction', messageId: msg.id, emoji, active: nextActive }),
      });
      if (!res.ok) throw new Error('Reaction failed');

      chatChannelRef.current?.send({
        type: 'broadcast',
        event: 'chat:reaction',
        payload: { messageId: msg.id, userId: self.userId, emoji, active: nextActive },
      }).catch(() => {});
    } catch (err: any) {
      setError(err.message ?? 'Reaction request failed');
      // Rollback reaction state
      updateMessages((prev) => prev.map((m) => {
        if (m.id !== msg.id) return m;
        const nextReactions = (m.reactions ?? []).filter((r) => !(r.userId === self.userId && r.emoji === emoji));
        if (hasReacted) {
          nextReactions.push({ messageId: msg.id, userId: self.userId, emoji, createdAt: new Date().toISOString() });
        }
        return { ...m, reactions: nextReactions };
      }));
    }
  };

  const jumpTo = (messageId: string) => {
    const el = document.getElementById(`chat-msg-${messageId}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.classList.add('bg-blue-500/10');
      setTimeout(() => el.classList.remove('bg-blue-500/10'), 2000);
    }
  };

  const openMessageMenu = (messageId: string, anchor: DOMRect | { left: number; right: number; top: number; bottom: number }) => {
    const menuCoords = positionMenu(anchor);
    setActiveMenu({ messageId, ...menuCoords });
  };

  const startLongPress = (messageId: string, touch: React.Touch) => {
    if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = setTimeout(() => {
      openMessageMenu(messageId, { left: touch.clientX, right: touch.clientX, top: touch.clientY, bottom: touch.clientY });
    }, 600);
  };

  const cancelLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const openMedia = async () => {
    setMediaOpen(true);
    try {
      const res = await fetch(`${messagesEndpoint}?limit=120&media=1`);
      const data = await res.json();
      if (res.ok) setMediaMessages(data.messages ?? []);
    } catch (err) {
      console.warn('[GlobalChat] failed to load media history:', err);
    }
  };

  const confirmClearForMe = async () => {
    setClearConfirmOpen(false);
    try {
      const res = await fetch(messagesEndpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'clear' }),
      });
      if (!res.ok) throw new Error('Clear failed');
      updateMessages(() => []);
    } catch (err: any) {
      setError(err.message ?? 'Clear failed');
    }
  };

  useEffect(() => {
    if (!activeMenu) return;
    const handleWindowClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('#chat-message-context-menu') && !target.closest('[data-chat-menu-trigger="true"]')) {
        setActiveMenu(null);
      }
    };
    window.addEventListener('click', handleWindowClick);
    return () => window.removeEventListener('click', handleWindowClick);
  }, [activeMenu]);

  const typingUsersList = useMemo(() => {
    return Object.keys(activeTypers).map((uid) => {
      const found = presenceProfiles.find((u) => u.userId && String(u.userId).split('_')[0] === uid.split('_')[0]);
      const name = found?.userName ?? 'Reader';
      return {
        userId: uid,
        name,
        avatarUrl: found?.avatarUrl ?? null,
        avatarColor: found?.avatarColor ?? '#6366f1',
        avatarInitials: found?.avatarInitials ?? name.slice(0, 2).toUpperCase(),
      };
    });
  }, [activeTypers, presenceProfiles]);

  const resolveReceiptName = useCallback((userId: string) => {
    const baseId = userId ? String(userId).split('_')[0] : '';
    if (!baseId) return 'Reader';
    if (self?.userId && self.userId.split('_')[0] === baseId) return 'You';
    const found = presenceProfiles.find((u) => u.userId && String(u.userId).split('_')[0] === baseId);
    return found?.userName ?? 'Reader';
  }, [self, presenceProfiles]);

  const mediaByKind = useMemo(() => ({
    images: mediaMessages.filter((m) => m.attachmentType === 'image'),
    videos: mediaMessages.filter((m) => m.attachmentType === 'video'),
    files: mediaMessages.filter((m) => m.attachmentType === 'file'),
    pdfs: mediaMessages.filter((m) => m.attachmentType === 'pdf'),
  }), [mediaMessages]);

  const visibleMediaSections = useMemo(() => (
    (['images', 'videos', 'pdfs', 'files'] as const).filter((kind) => mediaByKind[kind].length > 0)
  ), [mediaByKind]);

  const activeInfoMessage = infoMessage
    ? messages.find((m) => m.id === infoMessage.id) ?? infoMessage
    : null;
  const activeMenuMessage = activeMenu
    ? messages.find((m) => m.id === activeMenu.messageId) ?? null
    : null;

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
        {url && <Download size={16} className="text-room-muted" />}
      </a>
    );
  };

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = inputRef.current.scrollHeight + 'px';
    }
  }, [input]);

  return (
    <div className="relative flex h-full flex-col bg-transparent">
      {/* Header */}
      <div className="flex flex-none items-center gap-1 border-b border-room-border px-3 py-2 bg-room-surface">
        <button onClick={() => setSearchOpen((v) => !v)} className="rounded-lg p-2 text-room-muted hover:bg-room-bg hover:text-room-text" aria-label="Search messages"><Search size={18} /></button>
        <button onClick={openMedia} className="rounded-lg p-2 text-room-muted hover:bg-room-bg hover:text-room-text" aria-label="Media and files"><ImageIcon size={18} /></button>
        <button onClick={() => setClearConfirmOpen(true)} className="rounded-lg p-2 text-room-muted hover:bg-room-bg hover:text-room-text" aria-label="Clear chat for me"><Trash2 size={18} /></button>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('readroom-join-call'))}
          className="rounded-lg p-2 text-room-muted hover:bg-room-bg hover:text-room-text transition-colors"
          aria-label="Join voice/video call"
          title="Join Call"
        >
          <Phone size={18} className="text-indigo-400 hover:text-indigo-300" />
        </button>
        <div className="min-w-0 flex-1 text-center text-xs font-semibold uppercase tracking-wide text-room-muted">Global Chat</div>
      </div>

      {searchOpen && (
        <div className="flex flex-none items-center gap-2 border-b border-room-border px-3 py-2 bg-room-surface">
          <Search size={15} className="text-room-muted" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search text, sender, files" className="min-w-0 flex-1 bg-transparent text-sm text-room-text outline-none placeholder:text-room-muted" />
          {search && <button onClick={() => setSearch('')} className="text-room-muted hover:text-room-text" aria-label="Clear search"><X size={15} /></button>}
        </div>
      )}

      {/* Messages */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto px-3 py-3 bg-room-bg/30">
        {!search && messages.length > 0 && hasOlder && (
          <button onClick={loadOlder} disabled={loadingOlder} className="mx-auto mb-3 block rounded-full border border-room-border px-3 py-1 text-xs text-room-muted hover:text-room-text disabled:opacity-50">
            {loadingOlder ? 'Loading…' : 'Load older'}
          </button>
        )}
        {loading && <p className="py-8 text-center text-xs text-room-muted">Loading messages…</p>}
        {!loading && messages.length === 0 && <p className="py-8 text-center text-xs text-room-muted">{search ? 'No matching messages' : 'No messages yet. Say hello!'}</p>}

        {messages.map((msg, index) => {
          const prev = messages[index - 1];
          const next = messages[index + 1];
          const sameUser = prev?.userId === msg.userId;
          const closeTime = prev ? msg.ts - prev.ts < 2 * 60 * 1000 : false;
          const grouped = sameUser && closeTime && formatDay(prev.ts) === formatDay(msg.ts);

          const sameUserNext = next?.userId === msg.userId;
          const closeTimeNext = next ? next.ts - msg.ts < 2 * 60 * 1000 : false;
          const nextGrouped = sameUserNext && closeTimeNext && formatDay(next.ts) === formatDay(msg.ts);

          const showDay = !prev || formatDay(prev.ts) !== formatDay(msg.ts);
          const msgUserId = msg.userId || '';
          const isSelf = Boolean(self?.userId && msgUserId && msgUserId.startsWith(self.userId.split('_')[0]));
          const displayName = (isSelf ? self?.userName ?? msg.userName : msg.userName) || 'Reader';
          const avatar = isSelf ? self : presenceProfiles.find((u) => u.userId && msgUserId && u.userId.startsWith(msgUserId.split('_')[0]));
          const avatarUser = {
            userId: avatar?.userId ?? msgUserId,
            userName: displayName,
            avatarColor: avatar?.avatarColor ?? msg.avatarColor ?? '#6366f1',
            avatarInitials: avatar?.avatarInitials ?? displayName.slice(0, 2).toUpperCase(),
            avatarUrl: avatar?.avatarUrl ?? msg.avatarUrl ?? null,
            joinedAt: 0,
            isFollowing: false,
          };
          const receipts = msg.receipts ?? [];
          const selfBaseId = self?.userId?.split('_')[0] || '';
          const read = isSelf && receipts.some((r) => r?.userId && String(r.userId).split('_')[0] !== selfBaseId && r.readAt);
          const delivered = isSelf && receipts.some((r) => r?.userId && String(r.userId).split('_')[0] !== selfBaseId && (r.deliveredAt || r.readAt));

          const bubbleRadius = isSelf
            ? `${grouped ? 'rounded-tr-sm' : 'rounded-tr-xl'} ${nextGrouped ? 'rounded-br-sm' : 'rounded-br-xl'} rounded-l-xl`
            : `${grouped ? 'rounded-tl-sm' : 'rounded-tl-xl'} ${nextGrouped ? 'rounded-bl-sm' : 'rounded-bl-xl'} rounded-r-xl`;

          return (
            <React.Fragment key={msg.id}>
              {showDay && <div className="relative mx-auto my-3 block w-fit rounded-full bg-room-surface border border-room-border/40 px-3 py-1 text-[10px] font-medium text-room-muted shadow-sm">{formatDay(msg.ts)}</div>}
              {firstUnreadId === msg.id && <div className="my-3 border-t border-blue-400/40 pt-2 text-center text-[10px] font-semibold uppercase tracking-wide text-blue-300">Unread</div>}
              <div
                id={`chat-msg-${msg.id}`}
                tabIndex={0}
                onContextMenu={(e) => {
                  e.preventDefault();
                  openMessageMenu(msg.id, { left: e.clientX, right: e.clientX, top: e.clientY, bottom: e.clientY });
                }}
                onTouchStart={(e) => {
                  const touch = e.touches[0];
                  if (touch) startLongPress(msg.id, touch);
                }}
                onTouchMove={cancelLongPress}
                onTouchEnd={cancelLongPress}
                className={`group flex gap-x-2 px-1 outline-none transition ${grouped ? 'mt-[1.5px] py-0' : 'mt-2.5 py-0.5'} ${isSelf ? 'flex-row-reverse' : ''}`}
              >
                <div className="flex w-8 flex-shrink-0 flex-col items-center">
                  {!grouped ? (
                    <div className="mt-0.5">
                      <Avatar user={avatarUser} size="md" showTooltip={false} />
                    </div>
                  ) : (
                    <div className="invisible flex h-full items-center justify-center text-[9px] text-room-muted/60 group-hover:visible">
                      {new Date(msg.ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: false })}
                    </div>
                  )}
                </div>

                <div className={`min-w-0 max-w-[85%] ${isSelf ? 'items-end' : 'items-start'} flex flex-col`}>
                  {!grouped && (
                    <div className={`mb-0.5 flex items-baseline gap-2 ${isSelf ? 'flex-row-reverse' : ''}`}>
                      <span className="truncate text-sm font-semibold text-room-text">{isSelf ? 'You' : displayName}</span>
                      <span className="text-[10px] text-room-muted">{formatTime(msg.ts)}</span>
                    </div>
                  )}
                  <div className={`relative flex items-start gap-1 w-full ${isSelf ? 'flex-row-reverse' : ''}`}>
                    <div className={`min-w-0 border px-3 py-1.5 text-sm leading-relaxed shadow-sm ${bubbleRadius} ${
                      isSelf 
                        ? 'border-blue-500/50 bg-blue-600/30 dark:bg-blue-600/45 text-white hover:bg-blue-600/35 dark:hover:bg-blue-600/50 transition-all duration-200' 
                        : 'border-room-border/85 bg-room-surface text-room-text hover:bg-room-hover transition-all duration-200'
                    }`}>
                      {msg.replyTo && (
                        <button onClick={() => jumpTo(msg.replyTo!.id)} className="mb-1 block w-full rounded-md border-l-2 border-blue-400 bg-black/30 dark:bg-black/50 px-2 py-1 text-left">
                          <span className="block truncate text-[10px] font-semibold text-blue-300">{msg.replyTo.userName}</span>
                          <span className="line-clamp-2 text-[11px] text-room-muted">{summarize(msg.replyTo as ChatMessage)}</span>
                        </button>
                      )}
                      {msg.content && <p className="whitespace-pre-wrap [word-break:break-word] sm:break-normal sm:[overflow-wrap:anywhere]">{msg.content}</p>}
                      {renderAttachment(msg)}
                      <div className="mt-0.5 flex items-center justify-end gap-1 text-[9px] text-room-muted">
                        {msg.editedAt && <span>edited</span>}
                        {isSelf && (read ? <CheckCheck size={11} className="text-blue-300" /> : delivered ? <CheckCheck size={11} /> : <Check size={11} />)}
                      </div>
                    </div>

                    <div className={`invisible relative flex shrink-0 items-center gap-0.5 pt-0.5 group-hover:visible ${activeMenu?.messageId === msg.id ? '!visible' : ''}`}>
                      <button onClick={() => beginReply(msg)} className="rounded-full bg-room-surface p-1 text-room-muted hover:text-room-text border border-room-border" aria-label="Reply">
                        <Reply size={12} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          openMessageMenu(msg.id, e.currentTarget.getBoundingClientRect());
                        }}
                        data-chat-menu-trigger="true"
                        className="rounded-full bg-room-surface p-1 text-room-muted hover:text-room-text border border-room-border"
                        aria-label="Message actions"
                      >
                        <MoreVertical size={12} />
                      </button>
                    </div>
                  </div>

                  {reactionGroups(msg.reactions).length > 0 && (
                    <div className={`mt-0.5 flex flex-wrap gap-1 ${isSelf ? 'justify-end' : 'justify-start'}`}>
                      {reactionGroups(msg.reactions).map(([emoji, items]) => (
                        <button key={emoji} onClick={() => toggleReaction(msg, emoji)} className="rounded-full border border-room-border bg-room-surface px-1.5 py-0.5 text-[10px] text-room-text">{emoji} {items.length}</button>
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

      {unreadCount > 0 && <button onClick={() => { setIsAtBottom(true); bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }} className="absolute bottom-24 right-4 rounded-full bg-blue-500 px-3 py-1.5 text-xs font-semibold text-white shadow-lg z-10">Jump to latest ({unreadCount})</button>}

      {/* Typing Indicator */}
      {typingUsersList.length > 0 && (
        <div className="flex-none flex items-center gap-1.5 px-3 py-1.5 min-h-[28px] bg-room-surface border-t border-room-border">
          <div className="flex -space-x-1.5">
            {typingUsersList.map((u) => (
              <div
                key={u.userId}
                className="w-5 h-5 rounded-full ring-2 ring-room-surface overflow-hidden flex items-center justify-center text-[8px] font-bold text-white flex-shrink-0"
                style={u.avatarUrl ? {} : { backgroundColor: u.avatarColor }}
                title={u.name}
              >
                {u.avatarUrl
                  ? <img src={u.avatarUrl} alt={u.name} className="w-full h-full object-cover" />
                  : u.avatarInitials}
              </div>
            ))}
          </div>
          <div className="flex items-center gap-[3px] px-2 py-1 rounded-full bg-room-bg border border-room-border">
            <span className="w-1.5 h-1.5 rounded-full bg-room-muted animate-pulse" style={{ animationDelay: '0ms', animationDuration: '900ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-room-muted animate-pulse" style={{ animationDelay: '150ms', animationDuration: '900ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-room-muted animate-pulse" style={{ animationDelay: '300ms', animationDuration: '900ms' }} />
          </div>
        </div>
      )}

      {error && <div className="flex-none border-t border-red-900/50 bg-red-900/20 px-3 py-2 text-xs text-red-200">{error}</div>}

      {/* Message Options Portal */}
      {activeMenu && activeMenuMessage && typeof document !== 'undefined' && createPortal(
        <div
          id="chat-message-context-menu"
          className="fixed z-[9999] w-44 rounded-lg border border-room-border bg-room-surface p-1.5 shadow-2xl"
          style={{ top: activeMenu.top, left: activeMenu.left }}
        >
          <div className="mb-1 flex flex-wrap gap-1 border-b border-room-border pb-1">
            {EMOJIS.map((emoji) => (
              <button
                key={emoji}
                onClick={() => { setActiveMenu(null); toggleReaction(activeMenuMessage, emoji); }}
                className="rounded-md px-1.5 py-1 text-sm hover:bg-room-bg"
                aria-label={`React ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
          <button onClick={() => { beginReply(activeMenuMessage); setActiveMenu(null); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-room-text hover:bg-room-bg">
            <Reply size={13} /> Reply
          </button>
          {self?.userId && activeMenuMessage.userId && typeof activeMenuMessage.userId === 'string' && activeMenuMessage.userId.startsWith(self.userId.split('_')[0]) && (
            <button onClick={() => { setEditing(activeMenuMessage); setInput(activeMenuMessage.content); setActiveMenu(null); inputRef.current?.focus(); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-room-text hover:bg-room-bg">
              <Edit3 size={13} /> Edit
            </button>
          )}
          {self?.userId && activeMenuMessage.userId && typeof activeMenuMessage.userId === 'string' && activeMenuMessage.userId.startsWith(self.userId.split('_')[0]) && (
            <button onClick={() => { setInfoMessage(activeMenuMessage); setActiveMenu(null); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-room-text hover:bg-room-bg">
              <Info size={13} /> Message info
            </button>
          )}
          {self?.userId && activeMenuMessage.userId && typeof activeMenuMessage.userId === 'string' && activeMenuMessage.userId.startsWith(self.userId.split('_')[0]) && (
            <button onClick={() => { setActiveMenu(null); removeMessage(activeMenuMessage); }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-red-300 hover:bg-room-bg">
              <Trash2 size={13} /> Delete
            </button>
          )}
        </div>,
        document.fullscreenElement || document.body
      )}

      {/* Composer Context (Reply, Edit, Attachment details) */}
      {(replyTo || editing || attachment) && (
        <div className="flex flex-none items-center gap-2 border-t border-room-border bg-room-surface px-3 py-2">
          <div className="min-w-0 flex-1 text-xs text-room-muted">
            {editing ? <span>Editing message</span> : replyTo ? <span>Replying to <b className="text-room-text">{replyTo.userName}</b>: {summarize(replyTo)}</span> : null}
            {attachment && <span className="block truncate text-room-text"><Paperclip size={12} className="mr-1 inline" />{attachment.name}</span>}
          </div>
          <button onClick={clearComposerContext} className="rounded-lg p-1 text-room-muted hover:text-room-text" aria-label="Cancel"><X size={18} /></button>
        </div>
      )}

      {/* Footer / Input */}
      <div className="flex-none border-t border-room-border p-3 bg-room-surface">
        <div className="flex items-end gap-2 rounded-xl border border-room-border bg-room-bg px-2 transition-colors focus-within:border-blue-500/50">
          <input ref={fileRef} type="file" className="hidden" onChange={(e) => setAttachment(e.target.files?.[0] ?? null)} accept="image/*,video/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip" />
          <button onClick={() => { if (fileRef.current) fileRef.current.value = ''; fileRef.current?.click(); }} className="mb-1.5 rounded-lg p-2 text-room-muted hover:bg-room-surface hover:text-room-text" aria-label="Attach file"><Paperclip size={18} /></button>
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => {
              const val = e.target.value;
              setInput(val);
              if (val.trim()) handleTypingStart();
              else handleTypingStop();
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                const isMobile = window.matchMedia('(max-width: 768px)').matches || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
                if (!isMobile && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }
            }}
            placeholder="Message the room…"
            rows={1}
            maxLength={2000}
            className="max-h-28 min-h-[42px] flex-1 resize-none bg-transparent py-2.5 text-sm text-room-text outline-none placeholder:text-room-muted"
            style={{ overflowY: 'auto' }}
          />
          <button onClick={send} onMouseDown={(e) => e.preventDefault()} disabled={(!input.trim() && !attachment) || uploading} className="mb-1 rounded-xl p-2 text-blue-400 transition-colors hover:bg-blue-500/20 disabled:cursor-not-allowed disabled:opacity-30" aria-label="Send">
            {uploading ? <SmilePlus size={18} className="animate-pulse" /> : <Send size={18} />}
          </button>
        </div>
      </div>

      {/* Dialogs */}
      {clearConfirmOpen && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/45 px-4">
          <div className="w-full max-w-sm rounded-xl border border-room-border bg-room-surface p-4 shadow-2xl">
            <h3 className="text-sm font-semibold text-room-text">Clear chat for me?</h3>
            <p className="mt-2 text-xs leading-relaxed text-room-muted">
              This removes the visible chat history only for you. Other people will still keep their messages.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setClearConfirmOpen(false)} className="rounded-lg px-3 py-2 text-xs text-room-muted hover:bg-room-bg hover:text-room-text">Cancel</button>
              <button onClick={confirmClearForMe} className="rounded-lg bg-red-500/15 px-3 py-2 text-xs font-semibold text-red-200 hover:bg-red-500/25">Clear</button>
            </div>
          </div>
        </div>
      )}

      {activeInfoMessage && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/45 px-4">
          <div className="flex max-h-[82%] w-full max-w-md flex-col rounded-xl border border-room-border bg-room-surface shadow-2xl">
            <div className="flex items-center gap-2 border-b border-room-border px-4 py-3">
              <h3 className="flex-1 text-sm font-semibold text-room-text">Message info</h3>
              <button onClick={() => setInfoMessage(null)} className="rounded-lg p-1.5 text-room-muted hover:bg-room-bg hover:text-room-text" aria-label="Close message info">
                <X size={18} />
              </button>
            </div>
            <div className="overflow-y-auto p-4">
              <div className="mb-4 rounded-lg border border-room-border bg-room-bg px-3 py-2 text-sm text-room-text">
                <p className="line-clamp-3 whitespace-pre-wrap break-words">{summarize(activeInfoMessage)}</p>
                <p className="mt-1 text-[10px] text-room-muted">Sent {formatDateTime(activeInfoMessage.createdAt ?? new Date(activeInfoMessage.ts).toISOString())}</p>
              </div>
              {(() => {
                const selfBaseId = self?.userId?.split('_')[0] || '';
                const receipts = (activeInfoMessage.receipts ?? []).filter((r) => r.userId && String(r.userId).split('_')[0] !== selfBaseId);
                const readReceipts = receipts.filter((r) => r.readAt);
                const deliveredReceipts = receipts.filter((r) => r.deliveredAt || r.readAt);
                const renderRows = (items: typeof receipts, field: 'deliveredAt' | 'readAt') => (
                  items.length === 0
                    ? <p className="rounded-lg border border-room-border bg-room-bg px-3 py-2 text-xs text-room-muted">No users yet</p>
                    : <div className="space-y-1.5">
                        {items.map((receipt) => (
                          <div key={`${field}:${receipt.userId}`} className="flex items-center justify-between gap-3 rounded-lg border border-room-border bg-room-bg px-3 py-2">
                            <span className="min-w-0 truncate text-xs font-medium text-room-text">{resolveReceiptName(receipt.userId)}</span>
                            <span className="shrink-0 text-[10px] text-room-muted">{formatDateTime(receipt[field])}</span>
                          </div>
                        ))}
                      </div>
                );
                return (
                  <div className="space-y-4">
                    <section>
                      <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-room-muted"><CheckCheck size={13} /> Read by</h4>
                      {renderRows(readReceipts, 'readAt')}
                    </section>
                    <section>
                      <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-room-muted"><Check size={13} /> Delivered to</h4>
                      {renderRows(deliveredReceipts, 'deliveredAt')}
                    </section>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {mediaOpen && typeof document !== 'undefined' && createPortal(
        <div 
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4 animate-in fade-in duration-200"
          onClick={() => setMediaOpen(false)}
        >
          <div 
            className="flex h-[80vh] w-full max-w-md flex-col rounded-xl border border-room-border bg-room-surface shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex flex-none items-center gap-2 border-b border-room-border px-4 py-3">
              <h3 className="flex-1 text-sm font-semibold text-room-text">Media and Files</h3>
              <button onClick={() => setMediaOpen(false)} className="rounded-lg p-1.5 text-room-muted hover:bg-room-bg hover:text-room-text" aria-label="Close media"><X size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto p-4 bg-room-surface">
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
                            <Download size={16} className="text-room-muted" />
                          </a>
                        );
                      })}
                  </div>
                </section>
              ))}
            </div>
          </div>
        </div>,
        document.fullscreenElement || document.body
      )}
    </div>
  );
}
