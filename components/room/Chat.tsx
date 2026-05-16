// components/room/Chat.tsx
'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Send, MessageSquare, X } from 'lucide-react';
import { usePresenceStore } from '@/store/presenceStore';
import { connectSocket } from '@/lib/socket/client';
import type { ChatMessage } from '@/types';

interface ChatProps {
  roomId: string;
  onClose?: () => void;
}

export function Chat({ roomId, onClose }: ChatProps) {
  const self = usePresenceStore((s) => s.self);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef(connectSocket());
  const sentIdsRef = useRef(new Set<string>());

  // Load initial messages from API
  useEffect(() => {
    const loadMessages = async () => {
      try {
        setLoading(true);
        const res = await fetch(`/api/rooms/${roomId}/messages?limit=50`);
        if (!res.ok) throw new Error('Failed to load messages');
        const { messages: loaded } = await res.json();
        setMessages(loaded.sort((a: ChatMessage, b: ChatMessage) => a.ts - b.ts));
        setError(null);
      } catch (err) {
        console.error('[chat] load failed:', err);
        setError('Failed to load messages');
      } finally {
        setLoading(false);
      }
    };

    loadMessages();
  }, [roomId]);

  // Listen for new messages from socket — re-register when roomId changes
  useEffect(() => {
    const socket = socketRef.current;

    const handler = (msg: ChatMessage) => {
      console.log('[chat] received message:', msg.id, 'room:', msg.roomId);
      // Only handle messages for this room
      if (msg.roomId !== roomId) {
        console.warn('[chat] message room mismatch:', msg.roomId, 'vs', roomId);
        return;
      }
      // Skip messages we sent optimistically (already in the list)
      if (sentIdsRef.current.has(msg.id)) {
        sentIdsRef.current.delete(msg.id);
        return;
      }
      setMessages((prev) => {
        // Avoid duplicates
        if (prev.some((m) => m.id === msg.id)) return prev;
        const next = [...prev, msg];
        return next.length > 500 ? next.slice(-500) : next;
      });
    };

    socket.on('chat:message', handler);
    return () => {
      socket.off('chat:message', handler);
    };
  }, [roomId]);

  // Auto-scroll to bottom
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

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
      content: input.trim().slice(0, 500),
      ts: now,
    };

    try {
      // Track this ID so we skip the socket echo
      sentIdsRef.current.add(messageId);

      // Optimistic UI update
      setMessages((prev) => [...prev, payload]);
      setInput('');

      // Emit via socket for real-time broadcast
      console.log('[chat] emitting message:', messageId, 'to room:', roomId);
      socketRef.current.emit('chat:message', payload);

      // Persist to database via API
      const res = await fetch(`/api/rooms/${roomId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        // Remove from optimistic update if save failed
        setMessages((prev) => prev.filter((m) => m.id !== messageId));
        sentIdsRef.current.delete(messageId);
        setError('Failed to send message');
        setTimeout(() => setError(null), 3000);
      }
    } catch (err) {
      console.error('[chat] send failed:', err);
      setMessages((prev) => prev.filter((m) => m.id !== messageId));
      sentIdsRef.current.delete(messageId);
      setError('Failed to send message');
      setTimeout(() => setError(null), 3000);
    }
  }, [self, input, roomId]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="flex flex-col h-full bg-room-surface">
      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
        {loading && (
          <p className="text-center text-xs text-room-muted py-8">
            Loading messages...
          </p>
        )}

        {!loading && messages.length === 0 && (
          <p className="text-center text-xs text-room-muted py-8">
            No messages yet. Say hello!
          </p>
        )}

        {messages.map((msg) => {
          // Resolve current name from presence store (reactive identity)
          // Note: usePresenceStore.getState() is valid — it's NOT a hook call
          const users = usePresenceStore.getState().users;
          const selfState = usePresenceStore.getState().self;
          
          // Helper to find name by base userId (handles multiple tabs)
          const resolveName = (id: string, fallback: string) => {
            const baseId = id.split('_')[0];
            if (selfState?.userId.startsWith(baseId)) return selfState.userName;
            
            // Search active users map
            const userList = Array.from(users.values());
            for (const u of userList) {
              if (u.userId.startsWith(baseId) && u.userName !== 'Reader') {
                return u.userName;
              }
            }
            return fallback;
          };

          const currentName = resolveName(msg.userId, msg.userName);

          return (
            <div key={msg.id} className="flex items-start gap-2">
              <div
                className="w-6 h-6 rounded-full flex items-center justify-center text-white text-[10px] font-semibold flex-shrink-0 mt-0.5"
                style={{ backgroundColor: msg.avatarColor }}
              >
                {currentName[0]?.toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-medium text-room-text truncate">{currentName}</span>
                  <span className="text-[10px] text-room-muted flex-shrink-0">
                    {new Date(msg.ts).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <p className="text-xs text-room-text mt-1 break-words whitespace-pre-wrap">
                  {msg.content}
                </p>
              </div>
            </div>
          );
        })}

        <div ref={bottomRef} />
      </div>

      {/* Error message */}
      {error && (
        <div className="flex-none px-3 py-2 bg-red-900/20 border-t border-red-900/50 text-xs text-red-200">
          {error}
        </div>
      )}

      {/* Input */}
      <div className="flex-none p-3 border-t border-room-border">
        <div className="flex items-center gap-2 bg-room-bg rounded-xl border border-room-border px-3 focus-within:border-blue-500/50 transition-colors">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Message the room…"
            maxLength={500}
            className="flex-1 bg-transparent py-2.5 text-sm text-room-text placeholder:text-room-muted outline-none"
          />
          <button
            onClick={send}
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
