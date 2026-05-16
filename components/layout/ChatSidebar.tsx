// components/layout/ChatSidebar.tsx
'use client';

import React from 'react';
import { useUIStore } from '@/store/uiStore';
import { Chat } from '@/components/room/Chat';
import { MessageSquare, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useIsMobile } from '@/lib/hooks/useIsMobile';

export function ChatSidebar({ roomId, onClose }: { roomId: string; onClose?: () => void }) {
  const { chatSidebarCollapsed, toggleChatSidebar } = useUIStore();
  const isMobile = useIsMobile();

  return (
    <div className={`flex flex-col bg-room-surface flex-shrink-0 border-l border-room-border h-full transition-all duration-300 relative ${isMobile ? 'w-full' : (chatSidebarCollapsed ? 'w-0 overflow-hidden opacity-0 border-none' : 'w-72 xl:w-80')}`}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-room-border flex-shrink-0">
        <div className="flex items-center gap-2">
          <MessageSquare size={16} className="text-blue-400" />
          <h2 className="font-bold text-room-text text-sm tracking-wider">CHAT</h2>
        </div>
        {onClose && (
          <button 
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-room-hover text-room-muted transition-colors"
          >
            <X size={18} />
          </button>
        )}
      </div>

      <div className="flex-1 min-h-0">
        <Chat roomId={roomId} onClose={onClose} />
      </div>

    </div>
  );
}
