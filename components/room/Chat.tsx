'use client';

// Chat.tsx — persistent WhatsApp/Discord-style room chat.

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
import { useParams } from 'next/navigation';

import { createClient } from '@/lib/supabase/client';
import { usePresenceStore } from '@/store/presenceStore';
import { Avatar } from '@/components/ui/Avatar';
import type { ChatAttachment, ChatMessage, ChatReaction } from '@/types';

interface ChatProps {
  roomId: string;
  onClose?: () => void;
  portalTargetId?: string;
  /** Called whenever unread message count changes. Used to badge the FAB. */
  onUnreadChange?: (count: number) => void;
}

interface FloatingMenu {
  messageId: string;
  top: number;
  left: number;
  placement: 'above' | 'below';
  align: 'left' | 'right';
}

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

export function Chat({ roomId, onClose, portalTargetId, onUnreadChange }: ChatProps) {
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
  const [activeTypers, setActiveTypers] = useState<Record<string, number>>({});
  const [searchOpen, setSearchOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [mediaOpen, setMediaOpen] = useState(false);
  const [mediaMessages, setMediaMessages] = useState<ChatMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null);
  const [hasOlder, setHasOlder] = useState(true);
  const [activeMenu, setActiveMenu] = useState<FloatingMenu | null>(null);
  const [infoMessage, setInfoMessage] = useState<ChatMessage | null>(null);
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const typingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isAtBottomRef = useRef(isAtBottom);
  const selfRef = useRef(self);
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  // Unique per-instance ID so two <Chat roomId={x} /> components never share the same
  // Supabase channel object. Supabase SDK throws if .on() is called after .subscribe().
  const channelInstanceId = useRef(Math.random().toString(36).slice(2));
  // Broadcast channel ref — used for chat:* events emitted to other users
  const chatChannelRef = useRef<any>(null);

  const lastScrollTopRef = useRef<number>(0);
  const isRelocatingRef = useRef<boolean>(false);
  const prevPortalTargetIdRef = useRef<string | undefined>(portalTargetId);

  const messagesEndpoint = canUseAdvancedApi
    ? `/api/libraries/${libraryId}/channels/${channelId}/messages`
    : `/api/rooms/${roomId}/messages`;
  const attachmentsEndpoint = `/api/libraries/${libraryId}/channels/${channelId}/messages/attachments`;

  if (!supabaseRef.current) supabaseRef.current = createClient();

  useEffect(() => { isAtBottomRef.current = isAtBottom; }, [isAtBottom]);
  useEffect(() => { selfRef.current = self; }, [self]);
  useEffect(() => { onUnreadChange?.(unreadCount); }, [unreadCount, onUnreadChange]);

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

  // ── Supabase Realtime broadcast: chat events from other users ──────────────
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`room-broadcast:${roomId}`, {
      config: { broadcast: { self: false } },
    });

    const upsert = (msg: ChatMessage) => {
      if (msg.roomId !== roomId) return;
      updateMessages((prev) => {
        const existing = prev.find((m) => m.id === msg.id);
        return existing
          ? prev.map((m) => (m.id === msg.id ? { ...m, ...msg, replyTo: msg.replyTo ?? m.replyTo, replyToMessageId: msg.replyToMessageId ?? m.replyToMessageId } : m))
          : [...prev, msg].sort((a, b) => a.ts - b.ts);
      });
      const currentSelf = selfRef.current;
      const own = currentSelf?.userId && msg.userId && typeof msg.userId === 'string' && msg.userId.startsWith(currentSelf.userId.split('_')[0]);
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
      const receiptUserId = payload.userId ? String(payload.userId).split('_')[0] : '';
      if (!receiptUserId) return;
      const ids = new Set(payload.messageIds);
      updateMessages((prev) => prev.map((m) => {
        if (!ids.has(m.id)) return m;
        const receipts = (m.receipts ?? []).filter((r) => r.userId && String(r.userId).split('_')[0] !== receiptUserId);
        return { ...m, receipts: [...receipts, { roomId, messageId: m.id, userId: receiptUserId, deliveredAt: payload.readAt, readAt: payload.readAt }] };
      }));
    };

    const handleDelivered = (payload: { roomId: string; messageIds: string[]; userId: string; deliveredAt: string }) => {
      if (payload.roomId !== roomId) return;
      const receiptUserId = payload.userId ? String(payload.userId).split('_')[0] : '';
      if (!receiptUserId) return;
      const ids = new Set(payload.messageIds);
      updateMessages((prev) => prev.map((m) => {
        if (!ids.has(m.id)) return m;
        const existing = (m.receipts ?? []).find((r) => r.userId && String(r.userId).split('_')[0] === receiptUserId);
        const receipts = (m.receipts ?? []).filter((r) => r.userId && String(r.userId).split('_')[0] !== receiptUserId);
        return { ...m, receipts: [...receipts, { roomId, messageId: m.id, userId: receiptUserId, deliveredAt: existing?.deliveredAt ?? payload.deliveredAt, readAt: existing?.readAt ?? null }] };
      }));
    };

    const handleTyping = (payload: { roomId: string; userId: string; userName: string; typing: boolean; ts: number }) => {
      const currentSelf = selfRef.current;
      if (payload.roomId !== roomId || payload.userId === currentSelf?.userId) return;
      setActiveTypers((prev) => {
        const next = { ...prev };
        if (payload.typing) {
          next[payload.userId] = Date.now();
        } else {
          delete next[payload.userId];
        }
        return next;
      });
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
      chatChannelRef.current = null;
    };
  }, [roomId, updateMessages, loadMessages]);

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
      .channel(`chat-messages:${roomId}:${channelInstanceId.current}`)
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
      const now = Date.now();
      setActiveTypers((prev) => {
        let changed = false;
        let next = prev;
        for (const uid in prev) {
          if (now - prev[uid] > 2000) {
            if (!changed) {
              changed = true;
              next = { ...prev };
            }
            delete next[uid];
          }
        }
        return next;
      });
    }, 500);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    // Reset typing state on room change
    setActiveTypers({});
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
      typingTimeoutRef.current = null;
    }
    emitThrottleRef.current = 0;

    // Clean up typing state on old room before leaving or on unmount
    return () => {
      if (self && typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
        typingTimeoutRef.current = null;
        chatChannelRef.current?.send({
          type: 'broadcast',
          event: 'chat:typing',
          payload: { roomId, userId: self.userId, userName: self.userName, typing: false, ts: Date.now() },
        }).catch(() => {});
      }
    };
  }, [roomId, self]);


  // Profile updates handled via postgres_changes in usePresence (users table);
  // sync message display names from presence store when it changes
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`chat-profiles:${roomId}:${channelInstanceId.current}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'users' }, (payload) => {
        const updated = payload.new as any;
        const updatedUserId = updated?.id as string | undefined;
        if (!updatedUserId) return;
        const name = updated.display_name || updated.email?.split('@')[0] || 'Reader';
        updateMessages((prev) => prev.map((m) =>
          m.userId && String(m.userId).split('_')[0] === updatedUserId
            ? { ...m, userName: name, avatarUrl: updated.avatar_url ?? m.avatarUrl }
            : m
        ));
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [roomId, updateMessages]);

  useEffect(() => {
    if (isRelocatingRef.current) return;
    if (isAtBottom) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      setUnreadCount(0);
      setFirstUnreadId(null);
    }
  }, [messages, isAtBottom]);

  useEffect(() => {
    if (!self || !self.userId || !isAtBottom || !canUseAdvancedApi) return;
    const selfBaseId = self.userId.split('_')[0];
    const readable = messages.filter((m) => m.userId && !String(m.userId).startsWith(selfBaseId) && !(m.receipts ?? []).some((r) => r.userId && String(r.userId).split('_')[0] === selfBaseId && r.readAt));
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
          ? { ...m, receipts: [...(m.receipts ?? []).filter((r) => r.userId && String(r.userId).split('_')[0] !== selfBaseId), { roomId, messageId: m.id, userId: selfBaseId, deliveredAt: readAt, readAt }] }
          : m));
        chatChannelRef.current?.send({ type: 'broadcast', event: 'chat:read', payload: { roomId, messageIds, userId: selfBaseId, readAt } }).catch(() => {});
      }
    }).catch(() => {});
  }, [canUseAdvancedApi, isAtBottom, messages, messagesEndpoint, roomId, self, updateMessages]);

  useEffect(() => {
    if (!self || !self.userId || !canUseAdvancedApi) return;
    const selfBaseId = self.userId.split('_')[0];
    const deliverable = messages.filter((m) => m.userId && !String(m.userId).startsWith(selfBaseId) && !(m.receipts ?? []).some((r) => r.userId && String(r.userId).split('_')[0] === selfBaseId && (r.deliveredAt || r.readAt)));
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
          ? { ...m, receipts: [...(m.receipts ?? []).filter((r) => r.userId && String(r.userId).split('_')[0] !== selfBaseId), { roomId, messageId: m.id, userId: selfBaseId, deliveredAt, readAt: null }] }
          : m));
        chatChannelRef.current?.send({ type: 'broadcast', event: 'chat:delivered', payload: { roomId, messageIds, userId: selfBaseId, deliveredAt } }).catch(() => {});
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
    if (isRelocatingRef.current) {
      console.log('[Chat Scroll Debug] Ignoring scroll event during relocation/restoration. scrollTop:', el.scrollTop);
      return;
    }
    if (activeMenu) setActiveMenu(null);
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setIsAtBottom(atBottom);
    lastScrollTopRef.current = el.scrollTop;
    console.log('[Chat Scroll Debug] handleScroll: updated lastScrollTop to:', el.scrollTop, 'isAtBottom:', atBottom);
    if (el.scrollTop < 120 && hasOlder && !loadingOlder && !search) {
      loadOlder();
    }
  }, [activeMenu, hasOlder, loadingOlder, loadOlder, search]);

  useEffect(() => {
    if (prevPortalTargetIdRef.current !== portalTargetId) {
      const prev = prevPortalTargetIdRef.current;
      prevPortalTargetIdRef.current = portalTargetId;
      
      const el = scrollRef.current;
      if (!el) return;

      console.log('[Chat Scroll Debug] portalTargetId changed from:', prev, 'to:', portalTargetId, 'isAtBottom:', isAtBottomRef.current, 'lastScrollTop:', lastScrollTopRef.current);

      isRelocatingRef.current = true;
      const wasAtBottom = isAtBottomRef.current;
      const targetScrollTop = lastScrollTopRef.current;

      let lastHeight = el.scrollHeight;
      let stableFrames = 0;
      let checkCount = 0;

      const checkStabilization = () => {
        const container = scrollRef.current;
        if (!container) {
          isRelocatingRef.current = false;
          return;
        }

        const currentHeight = container.scrollHeight;
        console.log('[Chat Scroll Debug] Stabilization check. currentHeight:', currentHeight, 'lastHeight:', lastHeight, 'stableFrames:', stableFrames);

        if (currentHeight === lastHeight && currentHeight > 0) {
          stableFrames++;
        } else {
          stableFrames = 0;
          lastHeight = currentHeight;
        }

        checkCount++;
        // Wait until height has been identical for 3 consecutive frames, or fallback to a safety limit (60 frames ~ 1 second)
        if (stableFrames >= 3 || checkCount > 60) {
          console.log('[Chat Scroll Debug] scrollHeight stabilized at:', currentHeight, 'after checkCount:', checkCount);
          
          if (wasAtBottom) {
            console.log('[Chat Scroll Debug] Restoring scroll to bottom.');
            container.scrollTop = container.scrollHeight;
            setIsAtBottom(true);
          } else {
            console.log('[Chat Scroll Debug] Restoring scroll to targetScrollTop:', targetScrollTop);
            container.scrollTop = targetScrollTop;
            setIsAtBottom(false);
          }

          // Keep isRelocatingRef active for another 100ms to absorb any trailing layout/rendering scroll events
          setTimeout(() => {
            isRelocatingRef.current = false;
            console.log('[Chat Scroll Debug] Relocation complete. Final container.scrollTop:', container.scrollTop);
          }, 100);
        } else {
          requestAnimationFrame(checkStabilization);
        }
      };

      requestAnimationFrame(checkStabilization);
    }
  }, [portalTargetId]);

  useEffect(() => {
    if (!activeMenu) return;
    const close = () => setActiveMenu(null);
    window.addEventListener('resize', close);
    window.addEventListener('orientationchange', close);
    return () => {
      window.removeEventListener('resize', close);
      window.removeEventListener('orientationchange', close);
    };
  }, [activeMenu]);

  // Click-away listener for the message context menu (prevents backdrop mouseup bug)
  useEffect(() => {
    if (!activeMenu) return;

    const handleWindowClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      // If the click is on the trigger button itself or its icons, ignore it to prevent race conditions
      if (target.closest('[data-chat-menu-trigger="true"]')) {
        return;
      }
      const menuEl = document.getElementById('chat-message-context-menu');
      if (menuEl && !menuEl.contains(target)) {
        setActiveMenu(null);
      }
    };

    const timer = setTimeout(() => {
      window.addEventListener('click', handleWindowClick);
    }, 0);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('click', handleWindowClick);
    };
  }, [activeMenu]);

  const emitThrottleRef = useRef(0);
  const isTypingRef = useRef(false);

  const handleTypingStart = useCallback(() => {
    if (!self) return;
    
    const now = Date.now();
    if (now - emitThrottleRef.current > 1000) {
      chatChannelRef.current?.send({ type: 'broadcast', event: 'chat:typing', payload: { roomId, userId: self.userId, userName: self.userName, typing: true, ts: now } }).catch(() => {});
      emitThrottleRef.current = now;
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    
    typingTimeoutRef.current = setTimeout(() => {
      chatChannelRef.current?.send({ type: 'broadcast', event: 'chat:typing', payload: { roomId, userId: self.userId, userName: self.userName, typing: false, ts: Date.now() } }).catch(() => {});
      typingTimeoutRef.current = null;
      emitThrottleRef.current = 0;
    }, 1500);
  }, [roomId, self]);

  const handleTypingStop = useCallback(() => {
    if (!self || !typingTimeoutRef.current) return;
    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = null;
    emitThrottleRef.current = 0;
    chatChannelRef.current?.send({ type: 'broadcast', event: 'chat:typing', payload: { roomId, userId: self.userId, userName: self.userName, typing: false, ts: Date.now() } }).catch(() => {});
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
      chatChannelRef.current?.send({ type: 'broadcast', event: 'chat:update', payload: { roomId, message } }).catch(() => {});
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

    handleTypingStop();

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
      const finalMessage = {
        ...message,
        replyTo: message.replyTo ?? optimistic.replyTo,
        replyToMessageId: message.replyToMessageId ?? optimistic.replyToMessageId,
      };
      updateMessages((prev) => prev.map((m) => (m.id === optimisticId ? finalMessage : m)));
      chatChannelRef.current?.send({ type: 'broadcast', event: 'chat:message', payload: finalMessage }).catch(() => {});
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
    chatChannelRef.current?.send({ type: 'broadcast', event: 'chat:delete', payload: { roomId, messageId: msg.id } }).catch(() => {});
  }, [messagesEndpoint, roomId, updateMessages]);

  const toggleReaction = useCallback(async (msg: ChatMessage, emoji: string) => {
    if (!self || !self.userId || !canUseAdvancedApi) return;
    const selfBaseId = self.userId.split('_')[0];
    const active = !(msg.reactions ?? []).some((r) => r.userId && String(r.userId).split('_')[0] === selfBaseId && r.emoji === emoji);
    updateMessages((prev) => prev.map((m) => {
      if (m.id !== msg.id) return m;
      const reactions = (m.reactions ?? []).filter((r) => !(r.userId && String(r.userId).split('_')[0] === selfBaseId && r.emoji === emoji));
      return { ...m, reactions: active ? [...reactions, { messageId: msg.id, userId: selfBaseId, emoji }] : reactions };
    }));
    await fetch(messagesEndpoint, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'reaction', messageId: msg.id, emoji, active }),
    });
    chatChannelRef.current?.send({ type: 'broadcast', event: 'chat:reaction', payload: { roomId, messageId: msg.id, userId: selfBaseId, emoji, active } }).catch(() => {});
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

  const confirmClearForMe = useCallback(async () => {
    setClearConfirmOpen(false);
    await clearForMe();
  }, [clearForMe]);

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

  const focusComposer = useCallback(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus({ preventScroll: true });
    const cursor = input.value.length;
    input.setSelectionRange(cursor, cursor);
  }, []);

  const beginReply = useCallback((msg: ChatMessage) => {
    setReplyTo(msg);
    setEditing(null);
    focusComposer();
    requestAnimationFrame(focusComposer);
  }, [focusComposer]);

  const openMessageMenu = useCallback((messageId: string, anchor: DOMRect | { left: number; right: number; top: number; bottom: number }) => {
    setActiveMenu((current) => (
      current?.messageId === messageId
        ? null
        : { messageId, ...positionMenu(anchor) }
    ));
  }, []);

  const startLongPress = useCallback((messageId: string, touch: React.Touch) => {
    if (longPressRef.current) clearTimeout(longPressRef.current);
    const anchor = {
      left: touch.clientX,
      right: touch.clientX,
      top: touch.clientY,
      bottom: touch.clientY,
    };
    longPressRef.current = setTimeout(() => openMessageMenu(messageId, anchor), 450);
  }, [openMessageMenu]);

  const cancelLongPress = useCallback(() => {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  }, []);



  // Build typing user metadata for avatar display
  // Build typing user metadata for avatar display
  const typingUsersList = Object.keys(activeTypers).slice(0, 3).map((uid) => {
    const baseId = uid ? String(uid).split('_')[0] : '';
    const found = baseId ? presenceProfiles.find((u) => u.userId && String(u.userId).split('_')[0] === baseId) : null;
    const name = found?.userName ?? 'Unknown User';
    return {
      userId: uid,
      name,
      avatarUrl: found?.avatarUrl ?? null,
      avatarColor: found?.avatarColor ?? '#6366f1',
      avatarInitials: found?.avatarInitials ?? name.slice(0, 2).toUpperCase(),
    };
  });

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
      <div className="flex flex-none items-center gap-1 border-b border-room-border px-3 py-2">
        <button onClick={() => setSearchOpen((v) => !v)} className="rounded-lg p-2 text-room-muted hover:bg-room-bg hover:text-room-text" aria-label="Search messages"><Search size={18} /></button>
        {canUseAdvancedApi && <button onClick={openMedia} className="rounded-lg p-2 text-room-muted hover:bg-room-bg hover:text-room-text" aria-label="Media and files"><ImageIcon size={18} /></button>}
        {canUseAdvancedApi && <button onClick={() => setClearConfirmOpen(true)} className="rounded-lg p-2 text-room-muted hover:bg-room-bg hover:text-room-text" aria-label="Clear chat for me"><Trash2 size={18} /></button>}
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('readroom-join-call'))}
          className="rounded-lg p-2 text-room-muted hover:bg-room-bg hover:text-room-text transition-colors"
          aria-label="Join voice/video call"
          title="Join Call"
        >
          <Phone size={18} className="text-indigo-400 hover:text-indigo-300" />
        </button>
        <div className="min-w-0 flex-1 text-center text-xs font-semibold uppercase tracking-wide text-room-muted">Chat</div>
        {onClose && <button onClick={onClose} className="rounded-lg p-2 text-room-muted hover:bg-room-bg hover:text-room-text" aria-label="Close chat"><X size={18} /></button>}
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

          // Border radius logic for connected bubbles
          const bubbleRadius = isSelf
            ? `${grouped ? 'rounded-tr-sm' : 'rounded-tr-xl'} ${nextGrouped ? 'rounded-br-sm' : 'rounded-br-xl'} rounded-l-xl`
            : `${grouped ? 'rounded-tl-sm' : 'rounded-tl-xl'} ${nextGrouped ? 'rounded-bl-sm' : 'rounded-bl-xl'} rounded-r-xl`;

          return (
            <React.Fragment key={msg.id}>
              {showDay && <div className="relative mx-auto my-3 block w-fit rounded-full bg-room-bg/95 border border-room-border/40 px-3 py-1 text-[10px] font-medium text-room-muted shadow-sm">{formatDay(msg.ts)}</div>}
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
                    <div className={`min-w-0 border px-3 py-1 text-sm leading-relaxed shadow-sm ${bubbleRadius} ${
                      isSelf 
                        ? 'border-blue-500/50 bg-blue-600/30 dark:bg-blue-600/45 text-white hover:bg-blue-600/35 dark:hover:bg-blue-600/50 backdrop-blur-md transition-all duration-200' 
                        : 'border-room-border/80 bg-black/20 dark:bg-black/50 text-white hover:bg-black/35 dark:hover:bg-black/65 backdrop-blur-md transition-all duration-200'
                    }`}>
                      {msg.replyTo && (
                        <button onClick={() => jumpTo(msg.replyTo!.id)} className="mb-1 block w-full rounded-md border-l-2 border-blue-400 bg-black/40 dark:bg-black/60 px-2 py-1 text-left backdrop-blur-sm">
                          <span className="block truncate text-[10px] font-semibold text-blue-300">{msg.replyTo.userName}</span>
                          <span className="line-clamp-2 text-[11px] text-room-muted">{summarize(msg.replyTo as ChatMessage)}</span>
                        </button>
                      )}
                      {msg.content && <p className="whitespace-pre-wrap [word-break:break-word] sm:break-normal sm:[overflow-wrap:anywhere] text-white">{msg.content}</p>}
                      {renderAttachment(msg)}
                      <div className="mt-0.5 flex items-center justify-end gap-1 text-[9px] text-room-muted">
                        {msg.editedAt && <span>edited</span>}
                        {isSelf && (read ? <CheckCheck size={11} className="text-blue-300" /> : delivered ? <CheckCheck size={11} /> : <Check size={11} />)}
                      </div>
                    </div>

                    <div className={`invisible relative flex shrink-0 items-center gap-0.5 pt-0.5 group-hover:visible ${activeMenu?.messageId === msg.id ? '!visible' : ''}`}>
                      <button onClick={() => beginReply(msg)} className="rounded-full bg-room-bg/80 p-1 text-room-muted hover:text-room-text" aria-label="Reply">
                        <Reply size={12} />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          openMessageMenu(msg.id, e.currentTarget.getBoundingClientRect());
                        }}
                        data-chat-menu-trigger="true"
                        className="rounded-full bg-room-bg/80 p-1 text-room-muted hover:text-room-text"
                        aria-label="Message actions"
                      >
                        <MoreVertical size={12} />
                      </button>
                    </div>
                  </div>

                  {reactionGroups(msg.reactions).length > 0 && (
                    <div className={`mt-0.5 flex flex-wrap gap-1 ${isSelf ? 'justify-end' : 'justify-start'}`}>
                      {reactionGroups(msg.reactions).map(([emoji, items]) => (
                        <button key={emoji} onClick={() => toggleReaction(msg, emoji)} className="rounded-full border border-room-border bg-room-bg px-1.5 py-0.5 text-[10px] text-room-text">{emoji} {items.length}</button>
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

      {typingUsersList.length > 0 && (
        <div className="flex-none flex items-center gap-1.5 px-3 py-1.5 min-h-[28px]">
          {/* Stacked avatars */}
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
          {/* Animated 3-dot indicator */}
          <div className="flex items-center gap-[3px] px-2 py-1 rounded-full bg-room-bg border border-room-border">
            <span className="w-1.5 h-1.5 rounded-full bg-room-muted animate-pulse" style={{ animationDelay: '0ms', animationDuration: '900ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-room-muted animate-pulse" style={{ animationDelay: '150ms', animationDuration: '900ms' }} />
            <span className="w-1.5 h-1.5 rounded-full bg-room-muted animate-pulse" style={{ animationDelay: '300ms', animationDuration: '900ms' }} />
          </div>
        </div>
      )}
      {error && <div className="flex-none border-t border-red-900/50 bg-red-900/20 px-3 py-2 text-xs text-red-200">{error}</div>}

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

      {(replyTo || editing || attachment) && (
        <div className="flex flex-none items-center gap-2 border-t border-room-border bg-room-bg/60 px-3 py-2">
          <div className="min-w-0 flex-1 text-xs text-room-muted">
            {editing ? <span>Editing message</span> : replyTo ? <span>Replying to <b className="text-room-text">{replyTo.userName}</b>: {summarize(replyTo)}</span> : null}
            {attachment && <span className="block truncate text-room-text"><Paperclip size={12} className="mr-1 inline" />{attachment.name}</span>}
          </div>
          <button onClick={clearComposerContext} className="rounded-lg p-1 text-room-muted hover:text-room-text" aria-label="Cancel"><X size={18} /></button>
        </div>
      )}

      <div className="flex-none border-t border-room-border p-3">
        <div className="flex items-end gap-2 rounded-xl border border-room-border bg-room-bg px-2 transition-colors focus-within:border-blue-500/50">
          <input ref={fileRef} type="file" className="hidden" onChange={(e) => setAttachment(e.target.files?.[0] ?? null)} accept="image/*,video/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip" />
          {canUseAdvancedApi && <button onClick={() => { if (fileRef.current) fileRef.current.value = ''; fileRef.current?.click(); }} className="mb-1.5 rounded-lg p-2 text-room-muted hover:bg-room-surface hover:text-room-text" aria-label="Attach file"><Paperclip size={18} /></button>}
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
            <div className="flex-1 overflow-y-auto p-4">
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
