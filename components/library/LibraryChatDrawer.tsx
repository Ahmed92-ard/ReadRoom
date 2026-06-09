'use client';

// components/library/LibraryChatDrawer.tsx
// Slide-in drawer that provides library-scoped chat.
// Reuses Chat.tsx unchanged via the existing ChatSidebar pattern:
//   - Calls POST /api/libraries/[libraryId]/chat-room/ensure once to resolve the room ID.
//   - Keeps Chat mounted at all times (CSS visibility) to preserve scroll + subscriptions.
//   - Scrim backdrop dismisses on click.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { X, MessageSquare } from 'lucide-react';
import { Chat } from '@/components/room/Chat';

interface LibraryChatDrawerProps {
  libraryId: string;
  open: boolean;
  onClose: () => void;
  /** Called whenever the unread count changes (used to badge the FAB). */
  onUnreadChange?: (count: number) => void;
}

export function LibraryChatDrawer({ libraryId, open, onClose, onUnreadChange }: LibraryChatDrawerProps) {
  const [libraryChatRoomId, setLibraryChatRoomId] = useState<string | null>(null);
  const [ensureError, setEnsureError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const ensuredLibraryIdRef = useRef<string | null>(null);

  // Resolve the library chat room ID once per libraryId.
  // Uses POST (mutation) — never GET — to ensure the room is created.
  useEffect(() => {
    if (!libraryId || ensuredLibraryIdRef.current === libraryId) return;

    setLoading(true);
    setEnsureError(null);

    fetch(`/api/libraries/${libraryId}/chat-room/ensure`, { method: 'POST' })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error ?? 'Failed to load library chat');
        ensuredLibraryIdRef.current = libraryId;
        setLibraryChatRoomId(data.roomId);
      })
      .catch((err) => {
        console.error('[LibraryChatDrawer] ensure failed:', err);
        setEnsureError(err.message ?? 'Could not open library chat');
      })
      .finally(() => setLoading(false));
  }, [libraryId]);

  // Trap focus inside drawer when open (accessibility)
  const drawerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) drawerRef.current?.focus();
  }, [open]);

  // Close on Escape key
  useEffect(() => {
    if (!open) return;
    const handle = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [open, onClose]);

  const handleUnreadChange = useCallback((count: number) => {
    onUnreadChange?.(count);
  }, [onUnreadChange]);

  return (
    <>
      {/* Scrim — always rendered so the fade transition is smooth */}
      <div
        aria-hidden
        className={`fixed inset-0 z-[64] bg-black/50 transition-opacity duration-200 ${
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
      />

      {/* Drawer panel — stays mounted for scroll preservation */}
      <div
        ref={drawerRef}
        tabIndex={-1}
        aria-label="Library Chat"
        role="dialog"
        className={`fixed inset-y-0 right-0 z-[65] flex flex-col w-full max-w-[420px]
                    bg-room-surface border-l border-room-border shadow-2xl
                    transition-transform duration-300 outline-none
                    ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Header */}
        <div className="flex-none flex items-center justify-between px-4 py-3 border-b border-room-border">
          <div className="flex items-center gap-2 text-room-text">
            <MessageSquare size={18} className="text-blue-400" />
            <span className="text-sm font-semibold">Library Chat</span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-room-muted hover:text-room-text hover:bg-room-hover transition-colors"
            title="Close chat"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 min-h-0">
          {loading && (
            <div className="flex h-full items-center justify-center">
              <div className="flex flex-col items-center gap-3">
                <div className="w-6 h-6 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
                <span className="text-xs text-room-muted">Loading chat…</span>
              </div>
            </div>
          )}

          {ensureError && (
            <div className="flex h-full items-center justify-center px-6">
              <div className="text-center">
                <p className="text-sm text-red-400 font-medium">Failed to load chat</p>
                <p className="text-xs text-room-muted mt-1">{ensureError}</p>
                <button
                  onClick={() => { ensuredLibraryIdRef.current = null; setEnsureError(null); }}
                  className="mt-3 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs hover:bg-blue-500"
                >
                  Retry
                </button>
              </div>
            </div>
          )}

          {/* Chat stays mounted once resolved — CSS hidden prevents double subscription */}
          {libraryChatRoomId && (
            <Chat
              roomId={libraryChatRoomId}
              onClose={onClose}
              onUnreadChange={handleUnreadChange}
            />
          )}
        </div>
      </div>
    </>
  );
}
