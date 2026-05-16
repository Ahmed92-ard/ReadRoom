// components/layout/ChatSidebar.tsx
'use client';

import React from 'react';
import { useUIStore } from '@/store/uiStore';
import { Chat } from '@/components/room/Chat';
import { MessageSquare, X, GripVertical } from 'lucide-react';
import { useIsMobile } from '@/lib/hooks/useIsMobile';

interface ChatSidebarProps {
  roomId: string;
  onClose?: () => void;
  /** Desktop only: controlled width in px */
  width?: number;
  /** Desktop only: mousedown handler for right-edge resize handle */
  onResizeMouseDown?: (e: React.MouseEvent) => void;
}

export function ChatSidebar({ roomId, onClose, width, onResizeMouseDown }: ChatSidebarProps) {
  const { chatSidebarCollapsed } = useUIStore();
  const isMobile = useIsMobile();

  if (!isMobile && chatSidebarCollapsed) {
    return null;
  }

  return (
    <div
      className={`flex flex-col bg-room-surface flex-shrink-0 border-r border-room-border h-full relative ${
        isMobile ? 'w-full' : ''
      }`}
      style={!isMobile && width ? { width } : undefined}
    >
      {/* Header */}
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

      {/* Chat content */}
      <div className="flex-1 min-h-0">
        <Chat roomId={roomId} onClose={onClose} />
      </div>

      {/* Drag-to-resize handle on right edge (desktop only) */}
      {!isMobile && onResizeMouseDown && (
        <div
          className="absolute right-0 top-0 bottom-0 w-1 cursor-ew-resize z-10 group flex items-center justify-center hover:bg-blue-500/20 transition-colors"
          onMouseDown={onResizeMouseDown}
          title="Drag to resize chat"
        >
          <GripVertical
            size={12}
            className="text-room-border group-hover:text-blue-400 transition-colors opacity-0 group-hover:opacity-100"
          />
        </div>
      )}
    </div>
  );
}
