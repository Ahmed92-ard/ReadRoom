'use client';

// Chat.tsx — Permanent Supabase-backed chat with stable mount lifecycle.
// Key design decisions:
//   1. Messages are loaded from Supabase (permanent) via the channel messages API.
//   2. The component is intentionally kept mounted via CSS visibility, not unmounted,
//      so scroll position and loaded messages survive panel open/close.
//   3. Realtime updates come via Socket.IO (same as before).
//   4. Profile data (name, avatar) is resolved from the centralized presence store
//      which is kept in sync with Supabase profiles.

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Send, Trash2 } from 'lucide-react';
import { usePresenceStore } from '@/store/presenceStore';
import { getSocket } from '@/lib/socket/client';
import type { ChatMessage } from '@/types';
import { useParams } from 'next/navigation';

interface ChatProps {
  roomId: string;
  onClose?: () => void;
}

// ── Message cache: survives panel open/close without remounting ───────────────
// Keyed by roomId so switching rooms still fetches fresh data.
const messageCache = new Map<string, ChatMessage[]>();
const loadedRooms = new Set<string>();

export function Chat({ roomId, onClose }: ChatProps) {
  const self = usePresenceStore((s) => s.self);
  const users = usePresenceStore((s) => s.users);
  const params = useParams();
  const libraryId = params?.libraryId as string | undefined;
  const channelId = params?.channelId as string | undefined;

  const [messages, setMessages] = useState<ChatMessage[]>(() => messageCache.get(roomId) ?? []);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(!loadedRooms.has(roomId));
  const [error, setError] = useState<string | null>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // ── Determine the messages API endpoint ──────────────────────────────────
  // Prefer the new Supabase-backed channel messages endpoint when we have
  // libraryId + channelId. Fall back to the legacy Redis endpoint otherwise.
  const messagesEndpoint = libraryId && channelId
    ? `/api/libraries/${libraryId}/channels/${channelId}/messages`
    : `/api/rooms/${roomId}/messages`;

  // ── Load initial messages ─────────────────────────────────────────────────
  useEffect(() => {
    if (loadedRooms.has(roomId)) {
      setMessages(messageCache.get(roomId) ?? []);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const load = async () => {
      try {
        const res = await fetch(`${messagesEndpoint}?limit=100`);
        if (!res.ok) throw new Error('Failed to load messages');
        const { messages: loaded } = await res.json();
        if (cancelled) return;
        const sorted = (loaded as ChatMessage[]).sort((a, b) => a.ts - b.ts);
        messageCache.set(roomId, sorted);
        loadedRooms.add(roomId);
        setMessages(sorted);
        setError(null);
      } catch (err) {
        if (!cancelled) {
          console.error('[chat] load failed:', err);
          setError('Failed to load messages');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
  }, [roomId, messagesEndpoint]);

  // ── Socket listener — stable, never torn down while roomId is the same ────
  useEffect(() => {
    const socket = getSocket();

    const handleMessage = (msg: ChatMessage) => {
      if (msg.roomId !== roomId) return;
      setMessages((prev) => {
        if (prev.some((m) => m.id === msg.id)) return prev;
        const next = [...prev, msg];
        const trimmed = next.length > 500 ? next.slice(-500) : next;
        messageCache.set(roomId, trimmed);
        return trimmed;
      });
    };

    // On reconnect: fetch any messages missed while disconnected
    const handleReconnect = async () => {
      try {
        const res = await fetch(`${messagesEndpoint}?limit=30`);
        if (!res.ok) return;
        const { messages: refreshed } = await res.json();
        setMessages((prev) => {
          const existingIds = new Set(prev.map((m) => m.id));
          const newMsgs = (refreshed as ChatMessage[]).filter((m) => !existingIds.has(m.id));
          if (newMsgs.length === 0) return prev;
          const merged = [...prev, ...newMsgs].sort((a, b) => a.ts - b.ts);
          const trimmed = merged.length > 500 ? merged.slice(-500) : merged;
          messageCache.set(roomId, trimmed);
          return trimmed;
        });
      } catch { /* best-effort */ }
    };

    socket.on('chat:message', handleMessage);
    socket.on('connect', handleReconnect);
    return () => {
      socket.off('chat:message', handleMessage);
      socket.off('connect', handleReconnect);
    };
  }, [roomId, messagesEndpoint]);

  // ── Profile updates: refresh displayed names/avatars in real time ─────────
  useEffect(() => {
    const socket = getSocket();
    const handleProfileUpdate = (payload: { userId: string; userName: string; avatarUrl: string | null }) => {
      // Update any messages from this user with the new name/avatar
      setMessages((prev) => {
        const baseId = payload.userId.split('_')[0];
        const needsUpdate = prev.some((m) => m.userId.startsWith(baseId) && (m.userName !== payload.userName || m.avatarUrl !== payload.avatarUrl));
        if (!needsUpdate) return prev;
        const next = prev.map((m) =>
          m.userId.startsWith(baseId)
            ? { ...m, userName: payload.userName, avatarUrl: payload.avatarUrl }
            : m
        );
        messageCache.set(roomId, next);
        return next;
      });
    };
    socket.on('profile:updated', handleProfileUpdate);
    return () => { socket.off('profile:updated', handleProfileUpdate); };
  }, [roomId]);

  // ── Auto-scroll to bottom on new messages (only if already at bottom) ─────
  useEffect(() => {
    if (isAtBottom) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isAtBottom]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    setIsAtBottom(atBottom);
  }, []);

  // ── Send message ──────────────────────────────────────────────────────────
  const send = useCallback(async () => {
    if (!self || !input.trim()) return;

    const messageId = crypto.randomUUID();
    const now = Date.now();

    const payload: ChatMessage = {
      id: messageId,
      roomId,
      userId: self.userId,
      userName: self.userName,
      avatarColor: self.avatarColor,
      avatarUrl: self.avatarUrl ?? null,
      content: input.trim().slice(0, 2000),
      ts: now,
    };

    // Optimistic UI
    setMessages((prev) => {
      const next = [...prev, payload];
      messageCache.set(roomId, next);
      return next;
    });
    setInput('');
    setIsAtBottom(true);

    requestAnimationFrame(() => { inputRef.current?.focus(); });

    // Persist first so the canonical DB row and realtime payload share one ID.
    try {
      const res = await fetch(messagesEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: payload.content,
          userName: payload.userName,
          avatarColor: payload.avatarColor,
          avatarUrl: payload.avatarUrl,
        }),
      });

      if (!res.ok) {
        // Rollback optimistic update
        setMessages((prev) => {
          const next = prev.filter((m) => m.id !== messageId);
          messageCache.set(roomId, next);
          return next;
        });
        setError('Failed to send message');
        setTimeout(() => setError(null), 3000);
        return;
      }

      const { message: persisted } = await res.json();
      const finalMessage: ChatMessage = persisted ?? payload;
      setMessages((prev) => {
        const next = prev.map((m) => (m.id === messageId ? finalMessage : m));
        messageCache.set(roomId, next);
        return next;
      });

      // Broadcast the persisted message to other users after the DB write.
      getSocket().emit('chat:message', finalMessage);
    } catch (err) {
      console.error('[chat] send failed:', err);
      setMessages((prev) => {
        const next = prev.filter((m) => m.id !== messageId);
        messageCache.set(roomId, next);
        return next;
      });
      setError('Failed to send message');
      setTimeout(() => setError(null), 3000);
    }
  }, [self, input, roomId, messagesEndpoint]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  // ── Name / avatar resolution (live from presence store) ──────────────────
  const resolveName = useCallback((msgUserId: string, fallback: string) => {
    const baseId = msgUserId.split('_')[0];
    if (self?.userId.startsWith(baseId)) return self.userName;
    return (
      Array.from(users.values()).find((u) => u.userId.startsWith(baseId) && u.userName !== 'Reader')?.userName ??
      fallback
    );
  }, [self, users]);

  const resolveAvatar = useCallback((msgUserId: string, fallbackColor: string, fallbackUrl?: string | null) => {
    const baseId = msgUserId.split('_')[0];
    if (self?.userId.startsWith(baseId)) {
      return { color: self.avatarColor, initials: self.avatarInitials, url: self.avatarUrl };
    }
    const user = Array.from(users.values()).find((u) => u.userId.startsWith(baseId));
    if (user) return { color: user.avatarColor, initials: user.avatarInitials, url: user.avatarUrl };
    return { color: fallbackColor, initials: '?', url: fallbackUrl };
  }, [self, users]);

  return (
    <div className="flex flex-col h-full bg-room-surface">
      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-3 py-3 space-y-3"
      >
        {loading && (
          <p className="text-center text-xs text-room-muted py-8">Loading messages…</p>
        )}

        {!loading && messages.length === 0 && (
          <p className="text-center text-xs text-room-muted py-8">No messages yet. Say hello!</p>
        )}

        {messages.map((msg) => {
          if (msg.deleted) return null;
          const currentName = resolveName(msg.userId, msg.userName);
          const av = resolveAvatar(msg.userId, msg.avatarColor, msg.avatarUrl);
          const isSelf = self?.userId.startsWith(msg.userId.split('_')[0]);

          return (
            <div key={msg.id} className="flex items-start gap-2.5 group">
              {/* Avatar */}
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[11px] font-semibold flex-shrink-0 mt-0.5 overflow-hidden ring-1 ring-room-border"
                style={av.url ? {} : { backgroundColor: av.color }}
              >
                {av.url ? (
                  <img src={av.url} alt={currentName} className="w-full h-full object-cover" />
                ) : (
                  av.initials
                )}
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold text-room-text truncate">{currentName}</span>
                  <span className="text-[10px] text-room-muted flex-shrink-0">
                    {new Date(msg.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p className="text-sm text-room-text/90 mt-0.5 break-words whitespace-pre-wrap leading-relaxed">
                  {msg.content}
                </p>
                {msg.attachmentUrl && (
                  <a
                    href={msg.attachmentUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 inline-block text-xs text-blue-400 hover:underline"
                  >
                    📎 Attachment
                  </a>
                )}
              </div>
            </div>
          );
        })}

        <div ref={bottomRef} />
      </div>

      {/* Error */}
      {error && (
        <div className="flex-none px-3 py-2 bg-red-900/20 border-t border-red-900/50 text-xs text-red-200">
          {error}
        </div>
      )}

      {/* Input */}
      <div className="flex-none p-3 border-t border-room-border">
        <div className="flex items-center gap-2 bg-room-bg rounded-xl border border-room-border px-3 focus-within:border-blue-500/50 transition-colors">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Message the room…"
            maxLength={2000}
            className="flex-1 bg-transparent py-2.5 text-sm text-room-text placeholder:text-room-muted outline-none"
          />
          <button
            onClick={send}
            onMouseDown={(e) => e.preventDefault()}
            disabled={!input.trim()}
            className="p-2 rounded-xl text-blue-400 hover:bg-blue-500/20 disabled:opacity-30 disabled:cursor-not-allowed transition-colors min-w-[36px] min-h-[36px] md:min-w-[40px] md:min-h-[40px] flex items-center justify-center"
            aria-label="Send"
          >
            <Send size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
