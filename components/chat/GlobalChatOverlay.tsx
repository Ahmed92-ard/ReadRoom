'use client';

import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquare, X } from 'lucide-react';
import { GlobalChat } from '@/components/chat/GlobalChat';

interface GlobalChatOverlayProps {
  open: boolean;
  onClose: () => void;
}

export function GlobalChatOverlay({ open, onClose }: GlobalChatOverlayProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open, onClose]);

  if (!mounted || !open) return null;

  const target = document.fullscreenElement || document.body;

  return createPortal(
    <div className="fixed inset-0 z-[120] bg-black/70 md:flex md:justify-end" role="dialog" aria-modal="true" aria-label="Global chat">
      <button
        type="button"
        className="absolute inset-0 hidden md:block"
        aria-label="Close chat overlay"
        onClick={onClose}
      />
      <section className="relative flex h-[100dvh] w-full flex-col border-room-border bg-room-bg shadow-2xl animate-in slide-in-from-right duration-200 md:max-w-[460px] md:border-l">
        <div className="flex h-12 flex-none items-center justify-between border-b border-room-border bg-room-surface px-3">
          <MessageSquare size={18} className="text-blue-400" aria-hidden />
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-room-muted hover:bg-room-hover hover:text-room-text"
            aria-label="Close chat"
          >
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1">
          <GlobalChat />
        </div>
      </section>
    </div>,
    target
  );
}

export function LibraryChatLauncher({ hidden = false }: { hidden?: boolean }) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const openChat = () => setOpen(true);
    window.addEventListener('readroom:open-global-chat', openChat);
    window.addEventListener('toggle-fullscreen-chat', openChat);
    return () => {
      window.removeEventListener('readroom:open-global-chat', openChat);
      window.removeEventListener('toggle-fullscreen-chat', openChat);
    };
  }, []);

  return (
    <>
      {!hidden && !open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-20 right-4 z-[80] flex h-14 w-14 items-center justify-center rounded-full bg-blue-600 text-white shadow-2xl shadow-black/40 transition hover:bg-blue-500 active:scale-95 md:bottom-6 md:right-6"
          aria-label="Open chat"
          title="Open chat"
        >
          <MessageSquare size={24} />
        </button>
      )}
      <GlobalChatOverlay open={open} onClose={() => setOpen(false)} />
    </>
  );
}
