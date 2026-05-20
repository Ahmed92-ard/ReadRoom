'use client';

// ChatSidebar.tsx
// The Chat component is ALWAYS mounted (never unmounted) to preserve:
//   - scroll position
//   - loaded messages
//   - active socket subscriptions
// Visibility is controlled via CSS (display:none / flex) rather than conditional rendering.

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
  forceVisible?: boolean;
}

export function ChatSidebar({ roomId, onClose, width, onResizeMouseDown, forceVisible }: ChatSidebarProps) {
  const { chatSidebarCollapsed } = useUIStore();
  const isMobile = useIsMobile();

  // On desktop: hide via CSS when collapsed so Chat stays mounted.
  // On mobile: the parent controls visibility via a slide-in drawer; always render.
  const hidden = !isMobile && chatSidebarCollapsed && !forceVisible;

  return (
    <div
      className={`flex flex-col bg-transparent flex-shrink-0 border-r border-room-border h-full relative ${
        isMobile ? 'w-full' : ''
      } ${hidden ? 'hidden' : 'flex'}`}
      style={!isMobile && width ? { width } : undefined}
    >
      

      {/* Chat — always mounted, never unmounted */}
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
