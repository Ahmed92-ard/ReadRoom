'use client';

import React, {
  useCallback, useEffect, useRef, useState, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useParams, useRouter } from 'next/navigation';
import { Plus, Menu, X, MessageSquare, Layers, Users, FileText, FolderOpen, LayoutGrid, Pencil, GripVertical, Settings , Folder as FolderTreeIcon, PanelRight } from 'lucide-react';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { useShallow } from 'zustand/react/shallow';
import { useUIStore } from '@/store/uiStore';
import { useRoomStore } from '@/store/roomStore';
import { usePDFStore } from '@/store/pdfStore';
import { PDFViewer, type PDFViewerState } from '@/components/pdf/PDFViewer';
import { Avatar } from '@/components/ui/Avatar';
import { Notes } from './Notes';
import { PresenceList } from './PresenceList';
import { GooglePicker } from '@/components/drive/GooglePicker';
import { FolderTree } from '@/components/room/FolderTree';
import { LibrarySidebar } from '@/components/layout/LibrarySidebar';
import { ChannelSidebar } from '@/components/layout/ChannelSidebar';
import { SettingsOverlay } from '@/components/room/SettingsOverlay';
import { CallOverlay } from '@/components/room/CallOverlay';
import { LibraryChatLauncher } from '@/components/chat/GlobalChatOverlay';
import { usePDFSync } from '@/lib/hooks/usePDFSync';
import { usePresence } from '@/lib/hooks/usePresence';

import { createClient } from '@/lib/supabase/client';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { usePresenceStore } from '@/store/presenceStore';
import type { PDFMeta, ChannelPDF, RoomActivity, PDFFolder } from '@/types';

import { useIsMobile } from '@/lib/hooks/useIsMobile';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Recursively collect all PDFs from a folder tree + root PDFs into a flat array */
function collectAllPdfs(folders: import('@/types').PDFFolder[], rootPdfs: ChannelPDF[]): ChannelPDF[] {
  const result: ChannelPDF[] = [...rootPdfs];
  const walk = (nodes: import('@/types').PDFFolder[]) => {
    for (const f of nodes) {
      result.push(...f.pdfs);
      walk(f.children);
    }
  };
  walk(folders);
  return result;
}

function flattenFolders(folders: PDFFolder[]): Array<{ id: string | null; name: string; depth: number }> {
  const result: Array<{ id: string | null; name: string; depth: number }> = [
    { id: null, name: 'Room root', depth: 0 },
  ];
  const walk = (nodes: PDFFolder[], depth: number) => {
    nodes.forEach((folder) => {
      result.push({ id: folder.id, name: folder.name, depth });
      walk(folder.children, depth + 1);
    });
  };
  walk(folders, 0);
  return result;
}

function collectFolderPdfIds(folders: PDFFolder[], folderId: string): Set<string> {
  const ids = new Set<string>();
  const walk = (folder: PDFFolder) => {
    folder.pdfs.forEach((pdf) => ids.add(pdf.id));
    folder.children.forEach(walk);
  };
  const find = (nodes: PDFFolder[]): PDFFolder | null => {
    for (const node of nodes) {
      if (node.id === folderId) return node;
      const child = find(node.children);
      if (child) return child;
    }
    return null;
  };
  const start = find(folders);
  if (start) walk(start);
  return ids;
}

function previewMessage(value?: string | null) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > 96 ? `${text.slice(0, 93)}...` : text || 'Attachment';
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-5 px-8 text-center">
      <div className="w-20 h-20 rounded-2xl bg-room-surface border border-room-border flex items-center justify-center text-4xl">
        📖
      </div>
      <div>
        <h2 className="text-lg font-semibold text-room-text mb-1">No PDF loaded</h2>
        <p className="text-sm text-room-muted max-w-xs">
          Upload a PDF from your device to start a shared reading session.
        </p>
      </div>
      <button
        onClick={onOpen}
        className="flex items-center gap-2 px-5 py-3 rounded-xl bg-blue-600 text-white font-medium text-sm hover:bg-blue-500 transition-colors min-h-[44px]"
      >
        <FolderOpen size={16} />
        Upload PDF
      </button>
    </div>
  );
}

// ── Mobile bottom sheet ───────────────────────────────────────────────────────

interface BottomSheetProps {
  children: React.ReactNode;
  expanded: boolean;
  setExpanded: (v: boolean) => void;
  fullHeight?: boolean;
}

function MobileBottomSheet({ children, expanded, setExpanded, fullHeight }: BottomSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef<number | null>(null);

  const handleTouchStart = (e: React.TouchEvent) => {
    dragStartY.current = e.touches[0].clientY;
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (dragStartY.current === null) return;
    const dy = e.changedTouches[0].clientY - dragStartY.current;
    if (dy < -40) {
      setExpanded(true);
    } else if (dy > 40) {
      setExpanded(false);
    }
    dragStartY.current = null;
  };

  return (
    <>
      {/* Backdrop */}
      {expanded && (
        <div 
          className="fixed inset-0 bg-black/70 z-30 animate-in fade-in"
          onClick={() => setExpanded(false)}
        />
      )}
      
      <div 
        ref={sheetRef}
        className={`
          absolute bottom-0 left-0 right-0 z-40
          bg-room-surface border-t border-room-border
          rounded-t-2xl shadow-2xl
          transition-[height] duration-300 ease-out
          ${expanded ? (fullHeight ? 'h-[100dvh] rounded-none' : 'h-[75dvh]') : 'h-0 overflow-hidden'}
        `}
        style={{ transform: 'translate3d(0,0,0)' }}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {expanded && (
          <>
            {/* Drag handle */}
            <div
              className="flex items-center justify-between px-6 py-3 cursor-pointer"
              onClick={() => setExpanded(false)}
            >
              <div className="w-10" />
              <div className="w-10 h-1.5 rounded-full bg-room-border" />
              <div className="w-10 flex justify-end">
                <div className="p-1 rounded-full bg-room-hover text-room-muted">
                  <X size={18} />
                </div>
              </div>
            </div>
            <div className="h-[calc(100%-48px)] overflow-hidden">
              {children}
            </div>
          </>
        )}
      </div>
    </>
  );
}


function SidebarToggle({
  active,
  onClick,
  icon,
  title,
  badgeCount = 0,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  title: string;
  badgeCount?: number;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`relative p-2 rounded-xl transition-all flex items-center justify-center ${active ? 'text-blue-400 bg-blue-500/10 shadow-sm' : 'text-room-muted hover:text-room-text hover:bg-room-hover'}`}
    >
      {React.cloneElement(icon as React.ReactElement, { size: 18 })}
      {badgeCount > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold leading-[18px] text-center shadow-lg shadow-red-950/30">
          {badgeCount > 99 ? '99+' : badgeCount}
        </span>
      )}
    </button>
  );
}

// ── ResizablePaneWrapper ────────────────────────────────────────────────────────

const ResizablePaneWrapper = React.memo(({ 
  paneKey,
  element,
  draggedPaneKey, 
  dragOverPaneKey, 
  onDragStart, 
  onDragEnd, 
  onDragOver, 
  onDragLeave, 
  onDrop 
}: {
  paneKey: string;
  element: React.ReactNode;
  draggedPaneKey: string | null;
  dragOverPaneKey: string | null;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: () => void;
}) => {
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    console.log('[ResizablePaneWrapper] Pane mounted', { paneKey });
    return () => {
      console.log('[ResizablePaneWrapper] Pane UNMOUNTED', { paneKey });
    };
  }, [paneKey]);
  
  const handleResizeStart = (e: React.MouseEvent, dir: 'r' | 'b' | 'br') => {
    e.preventDefault();
    e.stopPropagation();
    
    if (!wrapperRef.current) return;
    const startW = wrapperRef.current.offsetWidth;
    const startH = wrapperRef.current.offsetHeight;
    const startX = e.clientX;
    const startY = e.clientY;
    
    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (dir === 'r' || dir === 'br') {
        const newW = Math.max(300, startW + (moveEvent.clientX - startX));
        wrapperRef.current.style.width = `${newW}px`;
      }
      if (dir === 'b' || dir === 'br') {
        const newH = Math.max(300, startH + (moveEvent.clientY - startY));
        wrapperRef.current.style.height = `${newH}px`;
      }
    };
    
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  return (
    <div
      ref={wrapperRef}
      data-pane-key={paneKey}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      className={`min-w-0 min-h-0 relative bg-room-bg rounded-lg transition-[transform,opacity,box-shadow] duration-200 focus-within:z-40 active:z-50 hover:z-10 ${
        draggedPaneKey === paneKey ? 'opacity-50 scale-95 border-2 border-dashed border-blue-500/50' : ''
      } ${
        dragOverPaneKey === paneKey ? 'ring-4 ring-blue-500 bg-blue-500/10 scale-[0.99] opacity-90 z-40' : ''
      }`}
      style={{ 
        width: '100%', 
        height: '100%', 
        maxWidth: '100%', 
        maxHeight: '100%', 
        overflow: 'hidden' 
      }}
    >
      {element}
      
      {/* Right Resizer */}
      <div 
        className="absolute top-0 right-0 w-2 h-full cursor-col-resize hover:bg-blue-500/20 active:bg-blue-500/40 z-50 transition-colors"
        onMouseDown={(e) => handleResizeStart(e, 'r')}
      />
      {/* Bottom Resizer */}
      <div 
        className="absolute bottom-0 left-0 w-full h-2 cursor-row-resize hover:bg-blue-500/20 active:bg-blue-500/40 z-50 transition-colors"
        onMouseDown={(e) => handleResizeStart(e, 'b')}
      />
      {/* Bottom-Right Corner Resizer */}
      <div 
        className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize hover:bg-blue-500/40 active:bg-blue-500/60 z-50 transition-colors rounded-tl"
        onMouseDown={(e) => handleResizeStart(e, 'br')}
      />
    </div>
  );
});
ResizablePaneWrapper.displayName = 'ResizablePaneWrapper';

// ── RoomShell ─────────────────────────────────────────────────────────────────

interface RoomShellProps {
  roomId: string;
  initialUserId: string;
  initialUserName: string;
  initialRoom?: any;
}

interface OpenViewer {
  key: string;
  pdfId: string;
  pdf: PDFMeta;
  title: string;
  followUserId?: string | null;
  state: PDFViewerState;
}

interface ToastActivity extends RoomActivity {
  toastId: string;
}



export function RoomShell({ roomId, initialUserId, initialUserName, initialRoom }: RoomShellProps) {
  const router = useRouter();
  const { 
    sidebarOpen, setSidebarOpen, activePanel, setActivePanel,
    librarySidebarCollapsed, channelSidebarCollapsed, toggleLibrarySidebar, toggleChannelSidebar,
    toggleNavigation,
    settingsOpen, setSettingsOpen,
  leftSidebarWidth, setLeftSidebarWidth} = useUIStore();

  const params = useParams();
  const libraryId = params?.libraryId as string | undefined;
  const channelId = params?.channelId as string | undefined;

  const room = useRoomStore((s) => s.room);
  const setRoom = useRoomStore((s) => s.setRoom);
  const setRoomName = useRoomStore((s) => s.setName);
  const updateSelf = usePresenceStore((s) => s.updateSelf);
  const self = usePresenceStore((s) => s.self);
  const usersMap = usePresenceStore((s) => s.users);
  const selfRef = useRef(self);

  useEffect(() => {
    if (libraryId && channelId) {
      try {
        localStorage.setItem('readroom:last-active-room', `/libraries/${libraryId}/channels/${channelId}`);
      } catch {}
    }
  }, [libraryId, channelId]);

  const lastNotificationTimeRef = useRef<number>(0);
  const { page, scroll, zoom, setSyncState } = usePDFStore(useShallow((s) => ({
    page: s.page, scroll: s.scroll, zoom: s.zoom, setSyncState: s.setSyncState
  })));
  // Refs so the beforeunload handler always reads latest values without
  // being listed as a dependency (which would cause a PATCH on every scroll)
  const pageRef = useRef(page);
  const scrollRef = useRef(scroll);
  const zoomRef = useRef(zoom);
  pageRef.current = page;
  scrollRef.current = scroll;
  zoomRef.current = zoom;
  const leftSidebarRef = useRef<HTMLDivElement>(null);
  const rightSidebarContainerRef = useRef<HTMLDivElement>(null);
  const followTarget = usePDFStore((s) => s.followTarget);
  const hasRestoredViewers = useRef(false);

  const [channelPDFs, setChannelPDFs] = useState<ChannelPDF[]>([]);
  const [rootPdfs, setRootPdfs] = useState<ChannelPDF[]>([]);
  const [folderTree, setFolderTree] = useState<import('@/types').PDFFolder[]>([]);
  const [currentChannelPdfId, setCurrentChannelPdfId] = useState<string | null>(null);
  const [openViewers, setOpenViewers] = useState<OpenViewer[]>([]);
  const [paneOrder, setPaneOrder] = useState<string[]>([]);

  // ── Transition state (stale-while-loading overlay; no blank flash) ──────────
  const [isTransitioning, setIsTransitioning] = useState(false);

  // ── Folder expansion persistence ────────────────────────────────────────────
  // Set uses two sentinels per folder: "{id}:open" and "{id}:closed".
  // Absent sentinel = unseen folder → defaults to open.
  // Initialised empty; the folderExpandStorageKey effect below loads room-specific
  // data once libraryId/channelId are available.
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(() => new Set<string>());

  // Token incremented on every channel transition; stale async completions compare
  // against this ref and bail out if a newer transition is already in progress.
  const transitionTokenRef = useRef<number>(0);

  // Debounce timers — prevent write storms to localStorage
  const folderExpandPersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const viewerPersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Active viewer key — persisted alongside open viewers
  const [lastActiveViewerKey, setLastActiveViewerKey] = useState<string>('main-workspace');

  const [draggedPaneKey, setDraggedPaneKey] = useState<string | null>(null);
  const [dragOverPaneKey, setDragOverPaneKey] = useState<string | null>(null);
  const [showPicker, setShowPicker] = useState(false);
  const [uploadFolderId, setUploadFolderId] = useState<string | null>(null);
  const [pdfLibraryError, setPdfLibraryError] = useState<string | null>(null);
  const [deletingPdfId, setDeletingPdfId] = useState<string | null>(null);
  const [pendingDeletePdf, setPendingDeletePdf] = useState<ChannelPDF | null>(null);
  const [pendingDeleteFolderId, setPendingDeleteFolderId] = useState<string | null>(null);
  const [movingPdf, setMovingPdf] = useState<ChannelPDF | null>(null);
  const [moveTargetFolderId, setMoveTargetFolderId] = useState<string | null>(null);
  const [movingPdfId, setMovingPdfId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastActivity[]>([]);
  useEffect(() => {
    console.log('[RoomShell Notification Debug] toasts state changed. Current queue length:', toasts.length, 'IDs:', toasts.map(t => t.toastId));
  }, [toasts]);
  const [leftView, setLeftView] = useState<'nav' | 'shelf'>('nav');
  const [mobileSheetExpanded, setMobileSheetExpanded] = useState(false);
  const [isEditingRoomName, setIsEditingRoomName] = useState(false);
  const [roomNameDraft, setRoomNameDraft] = useState('');
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const isMobile = useIsMobile();
  const mainContainerRef = useRef<HTMLDivElement>(null);

  // ── Resizable right sidebar ─────────────────────────────────────────────────
  const SIDEBAR_MIN = 200;
  const SIDEBAR_MAX = 520;
  const SIDEBAR_DEFAULT = 256;
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return SIDEBAR_DEFAULT;
    const stored = parseInt(localStorage.getItem('readroom:sidebar-width') ?? '', 10);
    return isNaN(stored) ? SIDEBAR_DEFAULT : Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, stored));
  });
  const isResizingRef = useRef(false);
  const resizeStartXRef = useRef(0);
  const resizeStartWidthRef = useRef(0);

  
  const handleLeftResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = leftSidebarWidth;

    const onMouseMove = (moveEvent: MouseEvent) => {
      const newWidth = Math.max(200, Math.min(600, startWidth + (moveEvent.clientX - startX)));
      setLeftSidebarWidth(newWidth);
    };

    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  };

  const handleResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    resizeStartXRef.current = e.clientX;
    resizeStartWidthRef.current = sidebarWidth;
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';

    let currentWidth = sidebarWidth;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isResizingRef.current) return;
      const delta = resizeStartXRef.current - ev.clientX;
      currentWidth = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, resizeStartWidthRef.current + delta));
      setSidebarWidth(currentWidth);
    };
    const onMouseUp = () => {
      isResizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try { localStorage.setItem('readroom:sidebar-width', String(currentWidth)); } catch {}
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [sidebarWidth]);

  // Persist width on change (debounced via ref)
  const widthPersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (widthPersistTimer.current) clearTimeout(widthPersistTimer.current);
    widthPersistTimer.current = setTimeout(() => {
      try { localStorage.setItem('readroom:sidebar-width', String(sidebarWidth)); } catch {}
    }, 300);
    return () => { if (widthPersistTimer.current) clearTimeout(widthPersistTimer.current); };
  }, [sidebarWidth]);

  // ── Resizable chat sidebar ───────────────────────────────────────────────────
  const CHAT_MIN = 220;
  const CHAT_MAX = 500;
  const CHAT_DEFAULT = 288;
  const [chatWidth, setChatWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return CHAT_DEFAULT;
    const stored = parseInt(localStorage.getItem('readroom:chat-width') ?? '', 10);
    return isNaN(stored) ? CHAT_DEFAULT : Math.min(CHAT_MAX, Math.max(CHAT_MIN, stored));
  });
  const isChatResizingRef = useRef(false);
  const chatResizeStartXRef = useRef(0);
  const chatResizeStartWidthRef = useRef(0);

  const handleChatResizeMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isChatResizingRef.current = true;
    chatResizeStartXRef.current = e.clientX;
    chatResizeStartWidthRef.current = chatWidth;
    document.body.style.cursor = 'ew-resize';
    document.body.style.userSelect = 'none';

    let currentChatWidth = chatWidth;

    const onMouseMove = (ev: MouseEvent) => {
      if (!isChatResizingRef.current) return;
      // Handle is on RIGHT edge of chat — dragging right increases width
      const delta = chatResizeStartXRef.current - ev.clientX;
      currentChatWidth = Math.min(CHAT_MAX, Math.max(CHAT_MIN, chatResizeStartWidthRef.current + delta));
      setChatWidth(currentChatWidth);
    };
    const onMouseUp = () => {
      isChatResizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      try { localStorage.setItem('readroom:chat-width', String(currentChatWidth)); } catch {}
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [chatWidth]);

  const chatWidthPersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (chatWidthPersistTimer.current) clearTimeout(chatWidthPersistTimer.current);
    chatWidthPersistTimer.current = setTimeout(() => {
      try { localStorage.setItem('readroom:chat-width', String(chatWidth)); } catch {}
    }, 300);
    return () => { if (chatWidthPersistTimer.current) clearTimeout(chatWidthPersistTimer.current); };
  }, [chatWidth]);

  const desktopTabs = [
    { id: 'shelf' as const,    Icon: FolderOpen, label: 'Shelf' },
    { id: 'notes' as const,    Icon: FileText,   label: 'Notes' },
    { id: 'presence' as const, Icon: Users,      label: 'People' },
  ];

  const mobileTabs = [
    { id: 'libraries' as const, Icon: LayoutGrid, label: 'Libraries' },
    { id: 'channels' as const,  Icon: Menu,       label: 'Rooms' },
    { id: 'shelf' as const,     Icon: FolderOpen, label: 'Shelf' },
    { id: 'notes' as const,     Icon: FileText,   label: 'Notes' },
    { id: 'presence' as const,  Icon: Users,      label: 'People' },
  ];

  const activeTabs = isMobile ? mobileTabs : desktopTabs;
  const notificationStorageKey = `readroom:notification-state:${roomId}:${initialUserId}`;
  const isFullscreen = typeof document !== 'undefined' && !!document.fullscreenElement;
  const processedNotificationIdsRef = useRef<Set<string>>(new Set());
  const processedBrowserNotificationIdsRef = useRef<Set<string>>(new Set());
  const isChatVisibleRef = { current: false };



  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      // Avoid closing on mouse down during resize or drag operations
      if (isResizingRef.current || isChatResizingRef.current) return;

      const target = e.target as HTMLElement;
      if (!target) return;
      
      // If clicking inside active dialogs, modals, context menus, or overlay controls, do not close
      if (target.closest('.fixed') || target.closest('[role="dialog"]') || target.closest('.cursor-col-resize') || target.closest('.cursor-row-resize') || target.closest('.cursor-nwse-resize')) {
        return;
      }
      
      // If clicking header or toggle buttons, let their click handlers handle it
      if (target.closest('header') || target.closest('button')) {
        return;
      }

      // If clicking inside the fullscreen portal (chat overlay, calling overlay, etc.), do not close sidebars
      if (target.closest('.readroom-fullscreen-portal')) {
        return;
      }

      // Check Left Sidebar collapse
      if (!librarySidebarCollapsed && leftSidebarRef.current && !leftSidebarRef.current.contains(target)) {
        toggleNavigation();
      }

      // Check Right Sidebars collapse
      if (rightSidebarContainerRef.current && !rightSidebarContainerRef.current.contains(target)) {
        if (sidebarOpen) {
          setSidebarOpen(false);
        }
      }
    };

    document.addEventListener('mousedown', handleOutsideClick);
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
    };
  }, [librarySidebarCollapsed, sidebarOpen, toggleNavigation, setSidebarOpen]);


  const showBrowserNotification = useCallback((activity: RoomActivity) => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    
    const isVisible = document.visibilityState === 'visible';
    const isDocFocused = document.hasFocus();
    const activeEl = document.activeElement?.tagName;

    console.log(`[RoomShell Notification Debug] showBrowserNotification triggered:`, {
      activityId: activity?.id,
      isVisible,
      isDocFocused,
      activeEl,
      permission: Notification.permission
    });

    if (Notification.permission !== 'granted') {
      console.log(`[RoomShell Notification Debug] Browser notification suppressed: permission not granted`);
      return;
    }
    if (!activity?.id) return;

    // Deduplication check
    if (processedBrowserNotificationIdsRef.current.has(activity.id)) {
      console.log(`[RoomShell Notification Debug] Browser notification suppressed: duplicate detected (${activity.id})`);
      return;
    }

    // Throttling check (15 seconds)
    const now = Date.now();
    if (now - lastNotificationTimeRef.current < 15000) {
      console.log(`[RoomShell Notification Debug] Browser notification suppressed: throttle active (time elapsed: ${now - lastNotificationTimeRef.current}ms)`);
      return;
    }

    // Visibility / focus check
    const hasActiveFocus = isVisible && isDocFocused;
    
    if (hasActiveFocus) {
      console.log(`[RoomShell Notification Debug] Browser notification suppressed: app has active focus (hasActiveFocus: true)`);
      return;
    }

    // Apply the throttle and deduplication markers BEFORE invoking Notification()
    lastNotificationTimeRef.current = now;
    processedBrowserNotificationIdsRef.current.add(activity.id);

    console.log(`[RoomShell Notification Debug] Triggering Notification constructor. Title: ${activity.title}`);

    try {
      let icon = '/icons/app_icon_192.png';
      if (activity.userId) {
        const users = usePresenceStore.getState().users;
        const self = usePresenceStore.getState().self;
        const baseId = activity.userId.split('_')[0];
        const target = self?.userId.startsWith(baseId) ? self : Array.from(users.values()).find(u => u.userId.startsWith(baseId));
        if (target?.avatarUrl) icon = target.avatarUrl;
      }

      // For cross-room messages, include the room name in the title
      const isCrossRoom = activity.roomId !== roomId;
      const roomName = activity.metadata?.roomName;
      let notifTitle = activity.title;
      let notifBody = activity.body;

      if (isCrossRoom) {
        if (roomName && activity.userName) {
          notifTitle = `${activity.userName} in #${roomName}`;
        } else if (roomName) {
          notifTitle = `${activity.title} in #${roomName}`;
        }
      }

      // Tag by roomId+id so cross-room notifications don't collapse same-room ones
      const tag = `${activity.roomId}:${activity.id}`;

      const notif = new Notification(notifTitle ?? activity.title, {
        body: notifBody,
        tag,
        icon,
      });

      console.log(`[DesktopNotificationDebug] Notification created successfully! Tag: ${tag}`);

      notif.onclick = () => {
        console.log(`[DesktopNotificationDebug] Notification click event received:`, { roomId: activity.roomId, currentRoomId: roomId });
        window.focus();
        if (activity.roomId) {
          const isOtherRoom = activity.roomId !== roomId;
          if (isOtherRoom && libraryId) {
            console.log(`[DesktopNotificationDebug] Routing to cross-room channel: /libraries/${libraryId}/channels/${activity.roomId}`);
            router.push(`/libraries/${libraryId}/channels/${activity.roomId}`);
          } else if (isOtherRoom) {
            console.log(`[DesktopNotificationDebug] Routing to cross-room space: /rooms/${activity.roomId}`);
            router.push(`/rooms/${activity.roomId}`);
          }
        }
      };
    } catch (err) {
      console.error(`[DesktopNotificationDebug] Constructor failed:`, err);
    }
  }, [roomId, libraryId, router]);

  const pushToast = useCallback((activity: RoomActivity) => {
    console.log('[RoomShell Notification Debug] pushToast() executing. Activity ID:', activity.id, 'Title:', activity.title);
    const toast: ToastActivity = { ...activity, toastId: `${activity.id}:${Date.now()}` };
    setToasts((prev) => {
      const next = [...prev.slice(-3), toast];
      console.log('[RoomShell Notification Debug] Current toasts in stack:', next.map(t => t.toastId));
      return next;
    });
    window.setTimeout(() => {
      console.log('[RoomShell Notification Debug] Auto-removing toast:', toast.toastId);
      setToasts((prev) => prev.filter((item) => item.toastId !== toast.toastId));
    }, 5200);
  }, []);

  useEffect(() => {
    if (!isMobile && (activePanel === 'libraries' || activePanel === 'channels' || activePanel === 'chat')) {
      setActivePanel('shelf');
    }
  }, [isMobile, activePanel, setActivePanel]);

  // First-visit: open Library + Channel sidebars so new users can find their content.
  // Existing users default to Chat + People (right panel) only — library sidebar stays closed.
  useEffect(() => {
    try {
      const visited = localStorage.getItem('readroom:visited');
      if (!visited) {
        localStorage.setItem('readroom:visited', '1');
        // Open the left navigation sidebars for brand-new users
        useUIStore.getState().toggleNavigation();
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(notificationStorageKey);
      if (!stored) return;
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed.recentIds)) {
        processedNotificationIdsRef.current = new Set(parsed.recentIds.slice(0, 100));
      }
    } catch {}
  }, [notificationStorageKey]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== notificationStorageKey || !event.newValue) return;
      try {
        const parsed = JSON.parse(event.newValue);
        if (Array.isArray(parsed.recentIds)) {
          processedNotificationIdsRef.current = new Set(parsed.recentIds.slice(0, 100));
        }
      } catch {}
    };

    const requestPermission = () => {
      if ('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {});
      }
      window.removeEventListener('pointerdown', requestPermission);
      window.removeEventListener('keydown', requestPermission);
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener('pointerdown', requestPermission, { once: true });
    window.addEventListener('keydown', requestPermission, { once: true });
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('pointerdown', requestPermission);
      window.removeEventListener('keydown', requestPermission);
    };
  }, [notificationStorageKey]);

  const handleTouchStartGlobal = (e: React.TouchEvent) => {
    if (!isMobile) return;
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchEndGlobal = (e: React.TouchEvent) => {
    if (touchStartX.current === null || touchStartY.current === null || !isMobile) return;
    
    const deltaX = e.changedTouches[0].clientX - touchStartX.current;
    const deltaY = e.changedTouches[0].clientY - touchStartY.current;
    
    if (Math.abs(deltaY) > Math.abs(deltaX)) {
      touchStartX.current = null;
      touchStartY.current = null;
      return;
    }

    if (Math.abs(deltaX) > 50) {
      if (deltaX > 0 && touchStartX.current < 60) {
        if (channelSidebarCollapsed) toggleChannelSidebar();
        else if (librarySidebarCollapsed) toggleLibrarySidebar();
      }
      else if (deltaX < 0) {
        if (!librarySidebarCollapsed) toggleLibrarySidebar();
        else if (!channelSidebarCollapsed) toggleChannelSidebar();
      }
    }
    
    touchStartX.current = null;
    touchStartY.current = null;
  };

  const { activeLibraryId, channels, updateChannel } = useWorkspaceStore();

  selfRef.current = self;

  const selectionStorageKey = libraryId && channelId
    ? `readroom:selected-pdf:${libraryId}:${channelId}:${initialUserId}`
    : null;
  // ── Session persistence keys (scoped per room + user) ────────────────────
  const viewersStorageKey = libraryId && channelId
    ? `readroom:open-viewers:${libraryId}:${channelId}:${initialUserId}`
    : null;
  const paneOrderStorageKey = libraryId && channelId
    ? `readroom:pane-order:${libraryId}:${channelId}:${initialUserId}`
    : null;
  const activeViewerStorageKey = libraryId && channelId
    ? `readroom:active-viewer:${libraryId}:${channelId}:${initialUserId}`
    : null;
  const folderExpandStorageKey = libraryId && channelId
    ? `readroom:folder-expanded:${libraryId}:${channelId}`
    : null;

  const buildRoomState = useCallback(
    (pdf: PDFMeta | null) => ({
      id: roomId,
      name: room?.name ?? initialRoom?.name ?? 'Reading Room',
      createdBy: room?.createdBy ?? initialRoom?.createdBy ?? initialUserId,
      createdAt: room?.createdAt ?? initialRoom?.createdAt ?? new Date().toISOString(),
      pdf,
      currentPage: 1,
      zoom: 1,
      scrollPct: 0,
    }),
    [roomId, room?.name, room?.createdBy, room?.createdAt, initialRoom?.name, initialRoom?.createdAt, initialUserId]
  );

  const channelPdfToMeta = useCallback((pdf: ChannelPDF): PDFMeta => ({
    fileId: pdf.driveId || pdf.id,
    filename: pdf.filename,
    owner: 'Room Library',
    thumbnail: pdf.thumbnailUrl,
    totalPages: null,
    url: pdf.url ?? (libraryId && channelId ? `/api/libraries/${libraryId}/channels/${channelId}/pdfs/${pdf.id}/file` : null),
  }), [channelId, libraryId]);

  const openPdfViewer = useCallback((pdf: ChannelPDF, options?: { followUserId?: string | null; title?: string }) => {
    const key = options?.followUserId ? `follow:${options.followUserId}` : `pdf:${pdf.id}`;
    const pdfMeta = channelPdfToMeta(pdf);
    setOpenViewers((prev) => {
      const existing = prev.find((viewer) => viewer.key === key);
      if (existing) {
        return prev.map((viewer) =>
          viewer.key === key
            ? { ...viewer, pdfId: pdf.id, pdf: pdfMeta, title: options?.title ?? viewer.title, followUserId: options?.followUserId ?? viewer.followUserId }
            : viewer
        );
      }
      return [
        ...prev,
        {
          key,
          pdfId: pdf.id,
          pdf: pdfMeta,
          title: options?.title ?? pdf.filename,
          followUserId: options?.followUserId ?? null,
          state: { page: 1, scroll: 0, zoom: 1, rotation: 0, totalPages: 0, loadState: 'idle' },
        },
      ];
    });
  }, [channelPdfToMeta]);

  const updateOpenViewerState = useCallback((key: string, patch: Partial<PDFViewerState>) => {
    setOpenViewers((prev) => prev.map((viewer) =>
      viewer.key === key ? { ...viewer, state: { ...viewer.state, ...patch } } : viewer
    ));
  }, []);

  const normalizeChannelPDF = useCallback((raw: any): ChannelPDF => ({
    id: raw.id,
    channelId: raw.channelId ?? raw.channel_id ?? channelId ?? roomId,
    roomId: raw.roomId ?? raw.room_id ?? raw.channelId ?? raw.channel_id ?? channelId ?? roomId,
    driveId: raw.driveId ?? raw.drive_id,
    filename: raw.filename,
    thumbnailUrl: raw.thumbnailUrl ?? raw.thumbnail_url ?? null,
    storagePath: raw.storagePath ?? raw.storage_path ?? null,
    url: raw.url ?? null,
    position: raw.position ?? 0,
    folderId: raw.folderId ?? raw.folder_id ?? null,
    createdAt: raw.createdAt ?? raw.created_at ?? new Date().toISOString(),
  }), [channelId, roomId]);

  const fetchChannelPDFs = useCallback(async () => {
    if (!libraryId || !channelId) return [];
    const res = await fetch(`/api/libraries/${libraryId}/channels/${channelId}/pdfs`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.hint || data.error || 'Failed to load channel PDFs');
    return ((data.pdfs ?? []) as any[]).map(normalizeChannelPDF);
  }, [channelId, normalizeChannelPDF, libraryId]);

  // Fetch folder tree (folders + rootPdfs) and sync into state
  const fetchFolderTree = useCallback(async () => {
    if (!libraryId || !channelId) return;
    try {
      const res = await fetch(`/api/libraries/${libraryId}/channels/${channelId}/folders`);
      if (!res.ok) return;
      const data = await res.json().catch(() => ({}));
      setFolderTree(data.folders ?? []);
      const rp = ((data.rootPdfs ?? []) as any[]).map(normalizeChannelPDF);
      setRootPdfs(rp);
      // Keep flat channelPDFs in sync (used by follow mode, socket handlers, etc.)
      const allPdfs = collectAllPdfs(data.folders ?? [], rp);
      setChannelPDFs(allPdfs);
    } catch { /* non-critical */ }
  }, [libraryId, channelId, normalizeChannelPDF]);

  useEffect(() => {
    if (initialRoom && !room) {
      // In a library/channel context, the active PDF comes from fetchChannelPDFs —
      // not from the server-rendered initialRoom.pdf. Using initialRoom.pdf would
      // briefly show a deleted/stale PDF while the fetch is in-flight (ghost loading).
      const safeRoom = (libraryId && channelId)
        ? { ...initialRoom, pdf: null }
        : initialRoom;
      setRoom(safeRoom);
      setSyncState({
        page: Math.max(1, Number(initialRoom.currentPage ?? 1) || 1),
        scroll: Math.max(0, Number(initialRoom.scrollPct ?? 0) || 0),
        zoom: Math.max(0.5, Number(initialRoom.zoom ?? 1) || 1),
      });
    }
  }, [initialRoom, room, setRoom, setSyncState, libraryId, channelId]);

  useEffect(() => {
    if (initialRoom?.name && room?.name !== initialRoom.name) {
      setRoomName(initialRoom.name);
    }
  }, [initialRoom?.name, room?.name, setRoomName]);

  useEffect(() => {
    setRoomNameDraft(room?.name ?? initialRoom?.name ?? 'Reading Room');
  }, [room?.name, initialRoom?.name]);

  const saveRoomName = useCallback(async () => {
    const nextName = roomNameDraft.trim();
    const currentName = room?.name ?? initialRoom?.name ?? 'Reading Room';
    if (!nextName || nextName === currentName) {
      setIsEditingRoomName(false);
      setRoomNameDraft(currentName);
      return;
    }

    let success = false;
    if (libraryId && channelId) {
      success = await updateChannel(libraryId, channelId, { name: nextName });
    } else {
      const res = await fetch(`/api/rooms/${roomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nextName }),
      });
      success = res.ok;
    }

    if (success) {
      setRoomName(nextName);
      setIsEditingRoomName(false);
    }
  }, [channelId, initialRoom?.name, room?.name, roomId, roomNameDraft, libraryId, setRoomName, updateChannel]);

  const publishActivePdf = useCallback((pdfId: string | null, pdfName: string | null) => {
    const currentSelf = selfRef.current;
    if (!currentSelf) return;
    const patch = {
      activePdfId: pdfId,
      activePdfName: pdfName,
      page: usePDFStore.getState().page,
      scroll: usePDFStore.getState().scroll,
      zoom: usePDFStore.getState().zoom,
      activeLibraryId: libraryId ?? null,
      currentRoomId: roomId,
      currentRoomName: room?.name ?? initialRoom?.name ?? 'ReadRoom',
      isActive: true,
      lastSeen: Date.now(),
    };
    // updateSelf triggers usePresence's Supabase Presence track() automatically
    updateSelf(patch);
  }, [libraryId, roomId, room?.name, initialRoom?.name, updateSelf]);

  // ── Folder expansion state: re-read from storage when room changes ────────
  useEffect(() => {
    if (!folderExpandStorageKey) return;
    try {
      const raw = localStorage.getItem(folderExpandStorageKey);
      setExpandedFolderIds(raw ? new Set<string>(JSON.parse(raw)) : new Set<string>());
    } catch {
      setExpandedFolderIds(new Set<string>());
    }
  // Only re-run when the room context changes (key derivation).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [folderExpandStorageKey]);

  /** Stable callback passed to <FolderTree>. Debounces localStorage writes. */
  const handleFolderToggle = useCallback((folderId: string, expanded: boolean) => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      // Remove both sentinels then write the new one
      next.delete(folderId + ':open');
      next.delete(folderId + ':closed');
      next.add(folderId + (expanded ? ':open' : ':closed'));
      // Debounce the write so rapid clicks don't thrash storage
      if (folderExpandPersistTimer.current) clearTimeout(folderExpandPersistTimer.current);
      folderExpandPersistTimer.current = setTimeout(() => {
        if (!folderExpandStorageKey) return;
        try { localStorage.setItem(folderExpandStorageKey, JSON.stringify(Array.from(next))); } catch {}
      }, 400);
      return next;
    });
  }, [folderExpandStorageKey]);

  // ── Viewer session persistence: write whenever viewers/paneOrder change ───
  useEffect(() => {
    if (!viewersStorageKey || !hasRestoredViewers.current) return;
    if (viewerPersistTimer.current) clearTimeout(viewerPersistTimer.current);
    viewerPersistTimer.current = setTimeout(() => {
      try {
        // Only persist lightweight identifiers — NOT full pdf meta or viewer state
        const lightViewers = openViewers.map((v) => ({ pdfId: v.pdfId, key: v.key, title: v.title }));
        localStorage.setItem(viewersStorageKey, JSON.stringify(lightViewers));
      } catch {}
    }, 400);
    return () => { if (viewerPersistTimer.current) clearTimeout(viewerPersistTimer.current); };
  }, [openViewers, viewersStorageKey]);

  useEffect(() => {
    if (!paneOrderStorageKey) return;
    try { localStorage.setItem(paneOrderStorageKey, JSON.stringify(paneOrder)); } catch {}
  }, [paneOrder, paneOrderStorageKey]);

  useEffect(() => {
    if (!activeViewerStorageKey) return;
    try { localStorage.setItem(activeViewerStorageKey, lastActiveViewerKey); } catch {}
  }, [lastActiveViewerKey, activeViewerStorageKey]);

  useEffect(() => {
    if (!libraryId || !channelId) {
      setChannelPDFs([]);
      setRootPdfs([]);
      setFolderTree([]);
      // Do NOT clear currentChannelPdfId or openViewers here:
      // keep stale content visible while transitioning (no blank flash).
      setIsTransitioning(false);
      return;
    }

    // ── Transition token: incremented on every new channel; stale completions bail ──
    const myToken = ++transitionTokenRef.current;
    setIsTransitioning(true);

    // Fetch folder tree (includes all PDFs organized by folder)
    const loadTree = async () => {
      try {
        const res = await fetch(`/api/libraries/${libraryId}/channels/${channelId}/folders`);
        const data = await res.json().catch(() => ({}));

        // Bail if a newer transition started while this fetch was in-flight
        if (myToken !== transitionTokenRef.current) return;

        const rp = ((data.rootPdfs ?? []) as any[]).map(normalizeChannelPDF);
        const ft = data.folders ?? [];
        setFolderTree(ft);
        setRootPdfs(rp);
        const allPdfs = collectAllPdfs(ft, rp);
        setChannelPDFs(allPdfs);

        const storedPdfId = selectionStorageKey ? localStorage.getItem(selectionStorageKey) : null;
        if (storedPdfId && !allPdfs.some((item) => item.id === storedPdfId)) {
          if (selectionStorageKey) localStorage.removeItem(selectionStorageKey);
        }

        const desiredPdf = allPdfs.find((item) => item.id === storedPdfId) ?? allPdfs[0];

        if (!desiredPdf) {
          setCurrentChannelPdfId(null);
          setRoom(buildRoomState(null));
          // Close any stale viewers that don't belong to this (empty) room
          setOpenViewers([]);
          hasRestoredViewers.current = true;
          setIsTransitioning(false);
          return;
        }

        setCurrentChannelPdfId(desiredPdf.id);
        const desiredMeta = channelPdfToMeta(desiredPdf);
        if (
          room?.pdf?.fileId !== desiredMeta.fileId ||
          room?.pdf?.url !== desiredMeta.url ||
          room?.pdf?.filename !== desiredMeta.filename
        ) {
          setRoom(buildRoomState(desiredMeta));
        }
        publishActivePdf(desiredPdf.id, desiredPdf.filename);

        // ── Close any viewers from the previous room that don't exist here ──────
        // This prevents cross-room PDF leakage without wiping state prematurely.
        const allPdfIds = new Set(allPdfs.map((p) => p.id));
        setOpenViewers((prev) => prev.filter((v) => allPdfIds.has(v.pdfId)));

        // ── Restore secondary viewers from session storage ────────────────────
        // Stagger via requestIdleCallback to avoid PDF.js initialization spikes.
        if (viewersStorageKey && myToken === transitionTokenRef.current) {
          try {
            const rawViewers = localStorage.getItem(viewersStorageKey);
            const storedViewers: Array<{ pdfId: string; key: string; title: string }> =
              rawViewers ? JSON.parse(rawViewers) : [];

            // Only restore viewers whose pdfId exists in this room's PDF registry
            const validViewers = storedViewers.filter(
              (sv) => allPdfIds.has(sv.pdfId) && sv.key !== 'main-workspace'
            );

            // Restore pane order first (cheap, synchronous)
            if (paneOrderStorageKey) {
              try {
                const rawOrder = localStorage.getItem(paneOrderStorageKey);
                if (rawOrder) setPaneOrder(JSON.parse(rawOrder));
              } catch {}
            }

            // Restore active viewer key
            if (activeViewerStorageKey) {
              try {
                const stored = localStorage.getItem(activeViewerStorageKey);
                if (stored) setLastActiveViewerKey(stored);
              } catch {}
            }

            // Stagger viewer reopening: one per idle callback to avoid layout thrashing
            validViewers.forEach((sv, idx) => {
              const schedule = typeof requestIdleCallback !== 'undefined'
                ? (cb: () => void) => requestIdleCallback(cb, { timeout: 2000 + idx * 500 })
                : (cb: () => void) => setTimeout(cb, 300 + idx * 200);

              schedule(() => {
                // Final guard: bail if another transition has started
                if (myToken !== transitionTokenRef.current) return;
                const sourcePdf = allPdfs.find((p) => p.id === sv.pdfId);
                if (!sourcePdf) return;
                openPdfViewer(sourcePdf, { title: sv.title });
              });
            });
          } catch { /* non-critical — viewer restore failure is silent */ }
        }

        hasRestoredViewers.current = true;
        setIsTransitioning(false);
      } catch (err) {
        if (myToken === transitionTokenRef.current) {
          console.error('[RoomShell] failed to fetch folder tree', err);
          setPdfLibraryError(err instanceof Error ? err.message : String(err));
          setIsTransitioning(false);
        }
      }
    };

    loadTree();
    // No cleanup cancel flag needed — transitionTokenRef handles ordering.
  }, [libraryId, channelId, buildRoomState, channelPdfToMeta, normalizeChannelPDF, publishActivePdf, selectionStorageKey, setRoom, viewersStorageKey, paneOrderStorageKey, activeViewerStorageKey, openPdfViewer]);

  // Find which PDF pane is currently at index 0 after sorting according to paneOrder
  const topPane = useMemo(() => {
    const panes: { key: string; pdfId: string; filename: string; isMain: boolean }[] = [];
    if (room?.pdf) {
      panes.push({
        key: 'main-workspace',
        pdfId: currentChannelPdfId || '',
        filename: room.pdf.filename,
        isMain: true,
      });
    }
    openViewers.forEach((viewer) => {
      panes.push({
        key: viewer.key,
        pdfId: viewer.pdfId,
        filename: viewer.pdf.filename,
        isMain: false,
      });
    });

    if (panes.length === 0) return null;

    panes.sort((a, b) => {
      const aIdx = paneOrder.indexOf(a.key);
      const bIdx = paneOrder.indexOf(b.key);
      if (aIdx === -1 && bIdx === -1) return 0;
      if (aIdx === -1) return 1;
      if (bIdx === -1) return -1;
      return aIdx - bIdx;
    });

    return panes[0];
  }, [room?.pdf, currentChannelPdfId, openViewers, paneOrder]);

  const topPaneState = useMemo(() => {
    if (!topPane) return null;
    if (topPane.isMain) {
      return {
        pdfId: topPane.pdfId,
        filename: topPane.filename,
        page: page,
        scroll: scroll,
      };
    } else {
      const viewer = openViewers.find(v => v.key === topPane.key);
      return {
        pdfId: topPane.pdfId,
        filename: topPane.filename,
        page: viewer?.state?.page ?? 1,
        scroll: viewer?.state?.scroll ?? 0,
      };
    }
  }, [topPane, page, scroll, openViewers]);

  usePDFSync(
    roomId,
    mainContainerRef,
    topPaneState ? topPaneState.pdfId : currentChannelPdfId,
    topPaneState ? topPaneState.filename : room?.pdf?.filename,
    topPaneState?.page,
    topPaneState?.scroll,
    topPane?.key,
    libraryId ?? null
  );
  
  usePresence(
    roomId,
    libraryId ?? null,
    initialUserId,
    initialUserName,
    topPaneState ? topPaneState.pdfId : currentChannelPdfId,
    topPaneState ? topPaneState.filename : (room?.pdf?.filename ?? null),
    room?.name ?? initialRoom?.name ?? 'ReadRoom'
  );

  // Expose roomId globally so PresenceList can emit presence:update for avatar changes
  useEffect(() => {
    (window as any).__readroom_roomId = roomId;
    return () => { delete (window as any).__readroom_roomId; };
  }, [roomId]);

  // ── Broadcast channel ref (used by callbacks to emit events) ──────────────
  const broadcastChannelRef = useRef<any>(null);

  // ── Supabase Realtime broadcast listeners ─────────────────────────────────
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase.channel(`room-broadcast:${roomId}`, {
      config: { broadcast: { self: false } },
    });

    const handlePdfAdded = (activity: RoomActivity) => {
      console.log('[RoomShell] pdf:added', activity.id);
      const rawPdf = activity.metadata?.pdf;
      if (!rawPdf || typeof rawPdf !== 'object') return;
      const addedPdf = normalizeChannelPDF(rawPdf);
      setChannelPDFs((prev) =>
        prev.some((item) => item.id === addedPdf.id)
          ? prev.map((item) => item.id === addedPdf.id ? addedPdf : item)
          : [...prev, addedPdf]
      );
      // Auto-open if none selected
      if (!currentChannelPdfId) {
        setCurrentChannelPdfId(addedPdf.id);
        setRoom(buildRoomState(channelPdfToMeta(addedPdf)));
        publishActivePdf(addedPdf.id, addedPdf.filename);
      }
      fetchFolderTree();
    };

    const handleLibraryUpdated = (activity: RoomActivity) => {
      if (activity.roomId !== roomId) return;
      fetchFolderTree();
    };

    const handleActivity = (activity: RoomActivity) => {
      console.log('[RoomShell Notification Debug] handleActivity invoked. Activity ID:', activity?.id, 'Type:', activity?.type, 'Room ID:', activity?.roomId);
      if (!activity?.id) return;
      
      const hasProcessed = processedNotificationIdsRef.current.has(activity.id);
      console.log('[RoomShell Notification Debug] Deduplication check for ID:', activity.id, 'Already processed:', hasProcessed);
      if (hasProcessed) {
        console.log('[RoomShell Notification Debug] Same-room deduplication skip. Activity ID already processed:', activity.id);
        return;
      }

      const isSameRoom = activity.roomId === roomId;
      const activityUserBaseId = activity.userId?.split('_')[0];
      console.log('[RoomShell Notification Debug] Same-room check. isSameRoom:', isSameRoom, 'activity.roomId:', activity.roomId, 'roomId:', roomId, 'activityUserBaseId:', activityUserBaseId, 'initialUserId:', initialUserId);

      // ── Cross-room messages: desktop notification if hidden, in-app toast if focused ──
      if (!isSameRoom && activity.type === 'chat:message') {
        if (activityUserBaseId === initialUserId) {
          console.log('[RoomShell Notification Debug] Cross-room message from self. Skipping.');
          return;
        }
        processedNotificationIdsRef.current.add(activity.id);
        const isFocused = document.visibilityState === 'visible' && document.hasFocus();
        console.log('[RoomShell Notification Debug] Cross-room message activity routed. RoomID:', activity.roomId, 'Activity ID:', activity.id, 'isFocused:', isFocused);
        if (!isFocused) {
          showBrowserNotification(activity);
        } else {
          console.log('[RoomShell Notification Debug] Pushing in-app toast for cross-room message.');
          pushToast(activity);
        }
        return;
      }

      // ── Same-room activities ──────────────────────────────────────────────
      if (!isSameRoom) {
        console.log('[RoomShell Notification Debug] Not same room and not cross-room message. Skipping.');
        return;
      }

      processedNotificationIdsRef.current.add(activity.id);
      console.log('[RoomShell Notification Debug] Added to processedNotificationIdsRef:', activity.id);

      // Skip own activities
      if (activityUserBaseId === initialUserId) {
        console.log('[RoomShell Notification Debug] Same-room activity is from self. Skipping.');
        return;
      }

      // Handle mention logic
      const body = activity.body ?? '';
      const isMention = body.toLowerCase().includes(`@${initialUserName.toLowerCase()}`);
      const nextActivity = isMention && activity.type === 'chat:message'
        ? { ...activity, type: 'mention' as const, title: `${activity.userName ?? 'Someone'} mentioned you` }
        : activity;

      // Activity-type-aware suppression logic
      const isMessage = nextActivity.type === 'chat:message';
      const isMentionActivity = nextActivity.type === 'mention';
      const isSystemActivity = nextActivity.type === 'pdf:added' || nextActivity.type === 'presence:join';

      let shouldPushToast = false;
      if (isMentionActivity) {
        shouldPushToast = true; // Mentions are high priority
      } else if (isMessage || isSystemActivity) {
        shouldPushToast = !isChatVisibleRef.current; // Suppress when chat is open/visible
      }

      console.log('[RoomShell Notification Debug] Same-room activity. ID:', activity.id, 'isChatVisibleRef:', isChatVisibleRef.current, 'activityType:', nextActivity.type, 'shouldPushToast:', shouldPushToast);
      if (shouldPushToast) {
        console.log('[RoomShell Notification Debug] Pushing in-app toast for same-room activity.');
        pushToast(nextActivity);
      }

      // Show browser notification whenever the app is unfocused/minimized —
      // regardless of whether chat was open before the window was minimized.
      const isFocused = document.visibilityState === 'visible' && document.hasFocus();
      console.log('[RoomShell Notification Debug] Same-room focus detection. isFocused:', isFocused);
      if (!isFocused) {
        showBrowserNotification(nextActivity);
      }

    };

    channel
      .on('broadcast', { event: 'pdf:added' }, ({ payload }) => handlePdfAdded(payload as RoomActivity))
      .on('broadcast', { event: 'library:updated' }, ({ payload }) => handleLibraryUpdated(payload as RoomActivity))
      .on('broadcast', { event: 'notification:activity' }, ({ payload }) => handleActivity(payload as RoomActivity))
      .subscribe();

    broadcastChannelRef.current = channel;

    return () => {
      supabase.removeChannel(channel);
      broadcastChannelRef.current = null;
    };
  }, [roomId, initialUserId, initialUserName, buildRoomState, channelPdfToMeta, fetchFolderTree, pushToast, showBrowserNotification, currentChannelPdfId, normalizeChannelPDF, publishActivePdf, setRoom]);

  useEffect(() => {
    if (!libraryId || channels.length === 0) return;
    const roomNames = new Map(channels.map((channel) => [channel.id, channel.name]));
    const supabase = createClient();
    const channel = supabase
      .channel(`cross-room-messages:${libraryId}:${initialUserId}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const row = payload.new as any;
          const messageRoomId = String(row?.room_id ?? '');
          if (!messageRoomId || messageRoomId === roomId || !roomNames.has(messageRoomId)) return;
          if (String(row?.sender_id ?? '').split('_')[0] === initialUserId) return;

          const activityId = `chat:${row.id}`;
          if (processedNotificationIdsRef.current.has(activityId)) {
            console.log('[RoomShell Notification Debug] Cross-room DB subscription deduplication skip. ID:', activityId);
            return;
          }
          processedNotificationIdsRef.current.add(activityId);

          const roomName = roomNames.get(messageRoomId) ?? 'Room';
          const activity: RoomActivity = {
            id: activityId,
            roomId: messageRoomId,
            type: 'chat:message',
            title: row.sender_name || 'New message',
            body: previewMessage(row.content),
            userId: row.sender_id ?? undefined,
            userName: row.sender_name ?? undefined,
            ts: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
            metadata: { roomName, libraryId },
          };

          const isFocused = document.visibilityState === 'visible' && document.hasFocus();
          console.log('[RoomShell Notification Debug] Cross-room DB notification routing. RoomID:', messageRoomId, 'Activity ID:', activityId, 'isFocused:', isFocused);
          pushToast(activity);
          if (!isFocused) showBrowserNotification(activity);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [channels, initialUserId, libraryId, pushToast, roomId, showBrowserNotification]);

  useEffect(() => {
    const handler = (event: Event) => {
      const pdfId = (event as CustomEvent<{ pdfId?: string | null; userName?: string }>).detail?.pdfId;
      if (!pdfId) return;
      const pdf = channelPDFs.find((item) => item.id === pdfId);
      if (pdf) openPdfViewer(pdf, { title: `${(event as CustomEvent<{ userName?: string }>).detail?.userName ?? 'User'}: ${pdf.filename}` });
    };

    window.addEventListener('readroom:open-pdf', handler);
    return () => window.removeEventListener('readroom:open-pdf', handler);
  }, [channelPDFs, openPdfViewer]);

  // ── Follow mode: open viewer when following starts ──────────────────────────
  useEffect(() => {
    if (!followTarget) return;
    const followed = usersMap.get(followTarget);
    if (!followed?.activePdfId) return;

    const openAndSync = (targetPdf: ChannelPDF) => {
      openPdfViewer(targetPdf, { followUserId: followTarget, title: `Following ${followed.userName}` });
      updateOpenViewerState(`follow:${followTarget}`, {
        page: Math.max(1, followed.page ?? 1),
        scroll: Math.max(0, Math.min(1, followed.scroll ?? 0)),
      });
    };

    // Try local channel list first
    const localPdf = channelPDFs.find((item) => item.id === followed.activePdfId);
    if (localPdf) {
      openAndSync(localPdf);
      return;
    }

    // PDF is in a different room — build a synthetic ChannelPDF from presence data.
    // The followed user's presence carries activePdfId and activePdfName.
    // We don't know their exact libraryId/channelId, but we can use the file endpoint
    // with the current libraryId and their activePdfId embedded in the URL.
    // The server will find the PDF by id regardless of which channel it's in.
    if (followed.activePdfId && libraryId) {
      // Try to find the room from presence data (roomId is the socket room they joined)
      // Fall back to current channelId as best-effort
      const sourceRoomId = followed.currentRoomId ?? channelId ?? roomId;
      const syntheticPdf: ChannelPDF = {
        id: followed.activePdfId,
        channelId: sourceRoomId,
        roomId: sourceRoomId,
        driveId: `local:${followed.activePdfId}`,
        filename: followed.activePdfName ?? 'Document',
        thumbnailUrl: null,
        storagePath: null,
        url: `/api/libraries/${libraryId}/channels/${sourceRoomId}/pdfs/${followed.activePdfId}/file`,
        position: 0,
        folderId: null,
        createdAt: new Date().toISOString(),
      };
      openAndSync(syntheticPdf);
    }
  }, [channelPDFs, channelId, followTarget, openPdfViewer, libraryId, roomId, updateOpenViewerState, usersMap]);

  // ── Follow mode: sync viewer as followed user navigates (via Supabase broadcast) ───
  useEffect(() => {
    const supabase = createClient();
    const followChannel = supabase.channel(`room-broadcast:${roomId}`, {
      config: { broadcast: { self: false } },
    });
    const handler = (payload: {
      roomId?: string;
      userId: string;
      activePdfId?: string | null;
      page: number;
      scroll: number;
      zoom: number;
    }) => {
      // CROSS-ROOM FOLLOW: do NOT filter by roomId when in follow mode.
      // The followed user may be in a different room — we still want their sync events.
      // Only filter if this event is from a room we don't care about AND we're not following.
      const key = `follow:${payload.userId}`;
      const isOpenFollow = openViewers.some((viewer) => viewer.key === key);
      const isActiveFollow = followTarget === payload.userId;

      // If not following this user at all, apply the room filter to avoid noise
      if (!isOpenFollow && !isActiveFollow) {
        if ((payload as any).roomId && (payload as any).roomId !== roomId) return;
        return;
      }

      // If PDF changed while following, try to open the new PDF
      if (payload.activePdfId) {
        const alreadyOpen = openViewers.find((v) => v.key === key);
        if (!alreadyOpen || alreadyOpen.pdfId !== payload.activePdfId) {
          const followedUser = usersMap.get(payload.userId);
          const followedUserName = followedUser?.userName ?? 'User';

          // Look for the PDF in the local channel list first
          const localPdf = channelPDFs.find((item) => item.id === payload.activePdfId);

          if (localPdf) {
            openPdfViewer(localPdf, {
              followUserId: payload.userId,
              title: `Following ${followedUserName}`,
            });
          } else {
            // PDF is in a different room — construct a synthetic ChannelPDF using
            // the file endpoint. We know the pdfId; we need to find which room it
            // belongs to. The followed user's presence carries activePdfId but not
            // the libraryId/channelId. Use the payload roomId if available, otherwise
            // fall back to fetching the current channel (best-effort).
            const sourceRoomId = (payload as any).roomId ?? followedUser?.currentRoomId ?? channelId;
            const sourceLibraryId = libraryId; // same library assumed for cross-room follow

            if (sourceRoomId && sourceLibraryId) {
              const syntheticPdf: ChannelPDF = {
                id: payload.activePdfId,
                channelId: sourceRoomId,
                roomId: sourceRoomId,
                driveId: `local:${payload.activePdfId}`,
                filename: followedUser?.activePdfName ?? 'Document',
                thumbnailUrl: null,
                storagePath: null,
                url: `/api/libraries/${sourceLibraryId}/channels/${sourceRoomId}/pdfs/${payload.activePdfId}/file`,
                position: 0,
                folderId: null,
                createdAt: new Date().toISOString(),
              };
              openPdfViewer(syntheticPdf, {
                followUserId: payload.userId,
                title: `Following ${followedUserName}`,
              });
            }
          }
        }
      }

      // Always update position (zoom remains completely independent per user)
      updateOpenViewerState(key, {
        page: Math.max(1, payload.page ?? 1),
        scroll: Math.max(0, Math.min(1, payload.scroll ?? 0)),
      });
    };

    followChannel
      .on('broadcast', { event: 'sync:state' }, ({ payload }) => handler(payload as any))
      .subscribe();

    return () => {
      supabase.removeChannel(followChannel);
    };
  }, [channelId, channelPDFs, followTarget, openPdfViewer, openViewers, roomId, libraryId, updateOpenViewerState, usersMap]);

  useEffect(() => {
    if (!activeLibraryId) return;
    const handleBeforeUnload = () => {
      fetch(`/api/libraries/${activeLibraryId}/channels/${roomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // Read from refs — always current but don't re-trigger the effect
        body: JSON.stringify({ currentPage: pageRef.current, scrollPct: scrollRef.current, zoom: zoomRef.current }),
        keepalive: true,
      }).catch(() => {});
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      handleBeforeUnload(); // Persist on unmount / room switch
    };
  }, [activeLibraryId, roomId]); // ← page/scroll/zoom intentionally excluded; read via refs

  const selectChannelPDF = useCallback(
    async (pdf: ChannelPDF) => {
      const selected = channelPdfToMeta(pdf);
      if (!room?.pdf) {
        setRoom(buildRoomState(selected));
        setSyncState({ page: 1, scroll: 0, zoom: 1 });
        setCurrentChannelPdfId(pdf.id);
        if (selectionStorageKey) localStorage.setItem(selectionStorageKey, pdf.id);
        publishActivePdf(pdf.id, pdf.filename);
      } else {
        // Open as a secondary tab if a PDF is already open in the workspace
        setOpenViewers((prev) => {
          const key = `pdf:${pdf.id}`;
          if (prev.some((v) => v.key === key)) return prev;
          return [...prev, { key, pdfId: pdf.id, pdf: selected, title: pdf.filename, followUserId: null, state: { page: 1, scroll: 0, zoom: 1, rotation: 0, totalPages: 0, loadState: 'idle' } }];
        });
      }
      setShowPicker(false);
    },
    [channelPdfToMeta, setRoom, buildRoomState, setSyncState, selectionStorageKey, publishActivePdf, room, setOpenViewers]
  );

  const performDeleteChannelPDF = useCallback(
    async (pdf: ChannelPDF) => {
      if (!libraryId || !channelId) return;

      setPdfLibraryError(null);
      setDeletingPdfId(pdf.id);

      try {
        const res = await fetch(`/api/libraries/${libraryId}/channels/${channelId}/pdfs/${pdf.id}`, {
          method: 'DELETE',
        });
        const data = await res.json().catch(() => ({}));

        if (!res.ok) {
          throw new Error(data.error || 'Failed to delete PDF');
        }

        const remaining = channelPDFs
          .filter((item) => item.id !== pdf.id)
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
        const nextPdf = remaining[0] ?? null;

        setChannelPDFs(remaining);
        setOpenViewers((prev) => prev.filter((viewer) => viewer.pdfId !== pdf.id));

        if (currentChannelPdfId === pdf.id) {
          if (nextPdf) {
            const nextMeta = channelPdfToMeta(nextPdf);
            setCurrentChannelPdfId(nextPdf.id);
            setRoom(buildRoomState(nextMeta));
            if (selectionStorageKey) localStorage.setItem(selectionStorageKey, nextPdf.id);
            publishActivePdf(nextPdf.id, nextPdf.filename);
          } else {
            setCurrentChannelPdfId(null);
            setRoom(buildRoomState(null));
            if (selectionStorageKey) localStorage.removeItem(selectionStorageKey);
            publishActivePdf(null, null);
          }
          setSyncState({ page: 1, scroll: 0, zoom: 1 });
        }

        broadcastChannelRef.current?.send({
          type: 'broadcast',
          event: 'library:updated',
          payload: {
            id: `library:deleted:${pdf.id}:${Date.now()}`,
            roomId,
            type: 'room:activity',
            title: `${initialUserName || 'Someone'} deleted a PDF`,
            body: pdf.filename,
            userId: initialUserId,
            userName: initialUserName,
            ts: Date.now(),
            metadata: { action: 'deleted', pdfId: pdf.id },
          },
        }).catch(() => {});

        // Refresh folder tree so the deleted PDF disappears from the correct folder
        fetchFolderTree();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[RoomShell] delete PDF failed', err);
        setPdfLibraryError(message);
      } finally {
        setDeletingPdfId(null);
        setPendingDeletePdf(null);
      }
    },
    [
      buildRoomState,
      channelId,
      channelPDFs,
      channelPdfToMeta,
      currentChannelPdfId,
      initialUserId,
      initialUserName,
      publishActivePdf,
      roomId,
      selectionStorageKey,
      libraryId,
      setRoom,
      setSyncState,
      fetchFolderTree,
    ]
  );

  const requestDeleteChannelPDF = useCallback((pdf: ChannelPDF) => {
    setPendingDeletePdf(pdf);
  }, []);

  const handlePDFSelect = useCallback(
    async (pdf: PDFMeta) => {
      // handlePDFSelect is kept for GooglePicker onSelect compat.
      // For local uploads, onLocalUploaded (handleRoomPdfUploaded) is used instead.
      // This path handles any PDFMeta that already has a url (e.g. from local upload fallback).
      setPdfLibraryError(null);
      if (!libraryId || !channelId) return;
      if (!pdf.url) {
        setPdfLibraryError('Only local uploads are supported. Use the Upload button.');
        return;
      }
      // If the PDF already has a url it was uploaded via the upload endpoint —
      // treat it the same as handleRoomPdfUploaded.
      const syntheticPdf = normalizeChannelPDF({
        id: pdf.fileId,
        room_id: channelId,
        drive_id: pdf.fileId,
        filename: pdf.filename,
        thumbnail_url: pdf.thumbnail,
        storage_path: null,
        url: pdf.url,
        position: 0,
        folder_id: null,
        created_at: new Date().toISOString(),
      });
      await handleRoomPdfUploaded(syntheticPdf);
    },
    [libraryId, channelId, normalizeChannelPDF]
  );

  const handleRoomPdfUploaded = useCallback(
    async (rawPdf: any) => {
      const addedPdf = normalizeChannelPDF(rawPdf);
      setPdfLibraryError(null);
      // Refresh the full folder tree so the new PDF appears in the right folder
      await fetchFolderTree();
      // Auto-select if nothing is open
      if (!currentChannelPdfId) {
        await selectChannelPDF(addedPdf);
      }
      broadcastChannelRef.current?.send({
        type: 'broadcast',
        event: 'pdf:added',
        payload: {
          id: `pdf:added:${addedPdf.id}`,
          roomId,
          type: 'pdf:added',
          title: `${initialUserName || 'Someone'} added a PDF`,
          body: addedPdf.filename,
          userId: initialUserId,
          userName: initialUserName,
          ts: Date.now(),
          metadata: { pdf: addedPdf },
        },
      }).catch(() => {});
    },
    [initialUserId, initialUserName, normalizeChannelPDF, roomId, selectChannelPDF, fetchFolderTree, currentChannelPdfId]
  );

  // ── Folder operation handlers ─────────────────────────────────────────────

  const performDeleteFolder = useCallback(async (folderId: string) => {
    if (!libraryId || !channelId) return;
    try {
      const deletedPdfIds = collectFolderPdfIds(folderTree, folderId);
      const res = await fetch(`/api/libraries/${libraryId}/channels/${channelId}/folders`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setPdfLibraryError(d.error || 'Failed to delete folder');
        return;
      }
      await fetchFolderTree();
      const remaining = channelPDFs.filter((pdf) => !deletedPdfIds.has(pdf.id));
      if (currentChannelPdfId && !remaining.some((pdf) => pdf.id === currentChannelPdfId)) {
        const nextPdf = remaining[0] ?? null;
        setCurrentChannelPdfId(nextPdf?.id ?? null);
        setRoom(buildRoomState(nextPdf ? channelPdfToMeta(nextPdf) : null));
        publishActivePdf(nextPdf?.id ?? null, nextPdf?.filename ?? null);
        setSyncState({ page: 1, scroll: 0, zoom: 1 });
      }
      broadcastChannelRef.current?.send({
        type: 'broadcast',
        event: 'library:updated',
        payload: {
          id: `library:folder-deleted:${folderId}:${Date.now()}`,
          roomId,
          type: 'library:updated',
          title: `${initialUserName || 'Someone'} deleted a folder`,
          userId: initialUserId,
          userName: initialUserName,
          ts: Date.now(),
        },
      }).catch(() => {});
    } catch (err) {
      setPdfLibraryError(err instanceof Error ? err.message : String(err));
    } finally {
      setPendingDeleteFolderId(null);
    }
  }, [libraryId, channelId, folderTree, fetchFolderTree, roomId, initialUserId, initialUserName, channelPDFs, currentChannelPdfId, setRoom, buildRoomState, channelPdfToMeta, publishActivePdf, setSyncState]);

  const handleDeleteFolder = useCallback((folderId: string) => {
    setPendingDeleteFolderId(folderId);
  }, []);

  const handleRenameFolder = useCallback(async (folderId: string, newName: string) => {
    if (!libraryId || !channelId) return;
    try {
      const res = await fetch(`/api/libraries/${libraryId}/channels/${channelId}/folders`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId, name: newName }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setPdfLibraryError(d.error || 'Failed to rename folder');
        return;
      }
      await fetchFolderTree();
    } catch (err) {
      setPdfLibraryError(err instanceof Error ? err.message : String(err));
    }
  }, [libraryId, channelId, fetchFolderTree]);

  const handleCreateFolder = useCallback(async (name: string, parentId: string | null) => {
    if (!libraryId || !channelId) return;
    try {
      const res = await fetch(`/api/libraries/${libraryId}/channels/${channelId}/folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, parentId }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        setPdfLibraryError(d.error || 'Failed to create folder');
        return;
      }
      await fetchFolderTree();
      broadcastChannelRef.current?.send({
        type: 'broadcast',
        event: 'library:updated',
        payload: {
          id: `library:folder-created:${Date.now()}`,
          roomId,
          type: 'library:updated',
          title: `${initialUserName || 'Someone'} created a folder`,
          userId: initialUserId,
          userName: initialUserName,
          ts: Date.now(),
        },
      }).catch(() => {});
    } catch (err) {
      setPdfLibraryError(err instanceof Error ? err.message : String(err));
    }
  }, [libraryId, channelId, fetchFolderTree, roomId, initialUserId, initialUserName]);

  const handleUploadToFolder = useCallback((folderId: string | null) => {
    setUploadFolderId(folderId);
    setPdfLibraryError(null);
    setShowPicker(true);
  }, []);

  const requestMovePdf = useCallback((pdf: ChannelPDF) => {
    setMovingPdf(pdf);
    setMoveTargetFolderId(pdf.folderId ?? null);
  }, []);

  const performMovePdf = useCallback(async () => {
    if (!libraryId || !channelId || !movingPdf) return;
    setMovingPdfId(movingPdf.id);
    setPdfLibraryError(null);
    try {
      const res = await fetch(`/api/libraries/${libraryId}/channels/${channelId}/pdfs/${movingPdf.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId: moveTargetFolderId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to move PDF');
      await fetchFolderTree();
      broadcastChannelRef.current?.send({
        type: 'broadcast',
        event: 'library:updated',
        payload: {
          id: `library:pdf-moved:${movingPdf.id}:${Date.now()}`,
          roomId,
          type: 'library:updated',
          title: `${initialUserName || 'Someone'} moved a PDF`,
          body: movingPdf.filename,
          userId: initialUserId,
          userName: initialUserName,
          ts: Date.now(),
          metadata: { action: 'moved', pdfId: movingPdf.id, folderId: moveTargetFolderId },
        },
      }).catch(() => {});
      setMovingPdf(null);
    } catch (err) {
      setPdfLibraryError(err instanceof Error ? err.message : String(err));
    } finally {
      setMovingPdfId(null);
    }
  }, [libraryId, channelId, movingPdf, moveTargetFolderId, fetchFolderTree, roomId, initialUserName, initialUserId]);

  const handleReorderItem = useCallback(async (
    type: 'pdf' | 'folder',
    id: string,
    newParentId: string | null,
    newPosition: number
  ) => {
    try {
      if (type === 'folder') {
        const res = await fetch(`/api/libraries/${libraryId}/channels/${channelId}/folders`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folderId: id, parentId: newParentId, position: newPosition }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to move folder');
      } else {
        const res = await fetch(`/api/libraries/${libraryId}/channels/${channelId}/pdfs/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ folderId: newParentId, position: newPosition }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to move PDF');
      }
      
      await fetchFolderTree();
      
      broadcastChannelRef.current?.send({
        type: 'broadcast',
        event: 'library:updated',
        payload: {
          id: `library:reorder:${id}:${Date.now()}`,
          roomId,
          type: 'library:updated',
          title: `${initialUserName || 'Someone'} rearranged the shelf`,
          body: type === 'folder' ? 'Moved a folder' : 'Moved a PDF',
          userId: initialUserId,
          userName: initialUserName,
          ts: Date.now(),
          metadata: { action: 'reorder', type, itemId: id, parentId: newParentId, position: newPosition },
        },
      }).catch(() => {});

    } catch (err) {
      console.error('[FolderTree] reorder error:', err);
      pushToast({
        id: `reorder-err-${Date.now()}`,
        roomId,
        type: 'presence:join',
        title: 'Error moving item',
        body: err instanceof Error ? err.message : String(err),
        userId: initialUserId,
        userName: initialUserName,
        ts: Date.now(),
      });
    }
  }, [libraryId, channelId, fetchFolderTree, roomId, initialUserId, initialUserName, pushToast]);

  const folderOptions = flattenFolders(folderTree);
  const pendingDeleteFolderName = folderOptions.find((folder) => folder.id === pendingDeleteFolderId)?.name ?? 'this folder';

  const AuxRightSidebar = (
    <div className="flex flex-col h-full bg-transparent w-full pointer-events-auto">
      <div className="flex items-center p-2 border-b border-room-border gap-1">
        <button 
          onClick={() => setActivePanel('presence')}
          className={`flex-1 flex justify-center py-2 rounded-lg transition-colors ${activePanel === 'presence' ? 'bg-blue-500/20 text-blue-400' : 'text-room-muted hover:bg-room-hover hover:text-room-text'}`}
          title="People"
        >
          <Users size={18} />
        </button>
        <button 
          onClick={() => setActivePanel('notes')}
          className={`flex-1 flex justify-center py-2 rounded-lg transition-colors ${activePanel === 'notes' ? 'bg-blue-500/20 text-blue-400' : 'text-room-muted hover:bg-room-hover hover:text-room-text'}`}
          title="Notes"
        >
          <FileText size={18} />
        </button>
        <div className="w-[1px] h-6 bg-room-border mx-1" />
        <button
          onClick={() => setSidebarOpen(false)}
          className="p-2 rounded-lg text-room-muted hover:text-room-text hover:bg-room-hover transition-colors"
          title="Close Sidebar"
        >
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">
        {activePanel === 'presence' && <PresenceList roomId={roomId} roomName={room?.name ?? 'ReadRoom'} />}
        {activePanel === 'notes' && <Notes roomId={roomId} />}
      </div>
    </div>
  );


  const ShelfContent = (
          <div className="flex flex-col h-full p-3">
            {/* Header */}
            <div className="flex items-center justify-between mb-3 flex-shrink-0 border-b border-room-border/30 pb-2">
              <h2 className="text-sm font-bold text-room-text tracking-wider uppercase">Shelf</h2>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => handleUploadToFolder(null)}
                  className="text-blue-400 hover:text-blue-300 text-xs font-medium px-2 py-1 rounded-lg hover:bg-blue-400/10 transition-all flex items-center gap-1"
                >
                  <Plus size={16} /> Upload
                </button>
                <button onClick={() => toggleNavigation()} className="p-1.5 rounded-lg text-room-muted hover:text-room-text hover:bg-room-hover">
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Error */}
            {pdfLibraryError && (
              <div className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300 flex-shrink-0">
                {pdfLibraryError}
              </div>
            )}

            {/* Folder tree */}
            <div className="flex-1 overflow-y-auto min-h-0">
              <FolderTree
                folders={folderTree}
                rootPdfs={rootPdfs}
                activePdfId={currentChannelPdfId}
                deletingPdfId={deletingPdfId}
                onSelectPdf={selectChannelPDF}
                onDeletePdf={requestDeleteChannelPDF}
                onMovePdf={requestMovePdf}
                onOpenSideViewer={openPdfViewer}
                onDeleteFolder={handleDeleteFolder}
                onUploadToFolder={handleUploadToFolder}
                onRenameFolder={handleRenameFolder}
                onCreateFolder={handleCreateFolder}
                libraryId={libraryId}
                channelId={channelId}
                onReorderItem={handleReorderItem}
                expandedFolderIds={expandedFolderIds}
                onFolderToggle={handleFolderToggle}
              />
            </div>
          </div>
  );
  const RightSidebarContent = (
    <div className="flex flex-col h-full">
      {!isMobile && (
        <div className="flex-none px-4 py-3 border-b border-room-border flex items-center gap-2">
          {isEditingRoomName ? (
            <input
              autoFocus
              className="min-w-0 flex-1 bg-room-bg border border-blue-500/50 rounded-lg px-2 py-1 text-sm text-room-text outline-none"
              value={roomNameDraft}
              onChange={(e) => setRoomNameDraft(e.target.value)}
              onBlur={saveRoomName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveRoomName();
                if (e.key === 'Escape') setIsEditingRoomName(false);
              }}
              maxLength={64}
            />
          ) : (
            <h1 className="text-sm font-semibold text-room-text truncate flex-1">
              {room?.name ?? 'ReadRoom'}
            </h1>
          )}
          <button
            onClick={() => setIsEditingRoomName(true)}
            className="p-1.5 rounded-lg text-room-muted hover:text-room-text hover:bg-room-hover"
            title="Rename room"
          >
            <Pencil size={16} />
          </button>
        </div>
      )}

      <div className={`flex-none flex border-b border-room-border ${isMobile ? 'overflow-x-auto scrollbar-hide' : ''}`}>
        {activeTabs.map(({ id, Icon, label }) => (
          <button
            key={id}
            onClick={() => setActivePanel(id)}
            className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 ${isMobile ? 'px-3 min-w-[70px]' : ''} text-[11px] font-medium transition-colors min-h-[44px]
              ${activePanel === id
                ? 'text-blue-400 border-b-2 border-blue-400'
                : 'text-room-muted hover:text-room-text border-b-2 border-transparent'
              }`}
          >
            <Icon size={15} />
            {label}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 relative">
        {/* Note: Chat is intentionally NOT rendered here.
            Desktop: always lives in <ChatSidebar /> (right side, always mounted).
            Mobile: lives in the dedicated mobileChatOpen slide-in drawer.
            Rendering a second <Chat> here caused dual socket listeners + split message state on desktop. */}


        <div className={activePanel === 'libraries' ? 'flex flex-col h-full overflow-y-auto' : 'hidden'}>
          <LibrarySidebar inBottomSheet={true} onClose={() => setMobileSheetExpanded(false)} />
        </div>

        <div className={activePanel === 'channels' ? 'flex flex-col h-full overflow-y-auto' : 'hidden'}>
          <ChannelSidebar inBottomSheet={true} onClose={() => setMobileSheetExpanded(false)} />
        </div>

        <div className={activePanel === 'notes' ? 'flex flex-col h-full' : 'hidden'}>
          <Notes roomId={roomId} />
        </div>

        <div className={activePanel === 'presence' ? 'flex flex-col h-full' : 'hidden'}>
          <PresenceList roomId={roomId} roomName={room?.name ?? 'ReadRoom'} />
        </div>

        <div className={activePanel === 'shelf' ? 'flex flex-col h-full overflow-y-auto' : 'hidden'}>
          {ShelfContent}
        </div>








































      </div>
    </div>
  );

  const isFullscreenActive = typeof document !== 'undefined' && !!document.fullscreenElement;
  console.log('[RoomShell Notification Debug] Evaluating toastStack JSX. Active toasts count:', toasts.length, 'isFullscreenActive:', isFullscreenActive);

  const toastStack = (
    <div 
      className={`pointer-events-none ${isFullscreenActive ? 'absolute' : 'fixed'} right-4 top-20 z-[2147483647] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2`}
      data-testid="toast-stack"
    >
      {toasts.map((toast) => {
        console.log('[RoomShell Notification Debug] Rendering individual toast JSX in stack:', toast.toastId, 'title:', toast.title);
        const toastRoomName = typeof toast.metadata?.roomName === 'string'
          ? toast.metadata.roomName
          : room?.name;
        const isOtherRoom = toast.roomId !== roomId;

        return (
          <button
            key={toast.toastId}
            type="button"
            onClick={() => {
              setToasts((prev) => prev.filter((item) => item.toastId !== toast.toastId));
              if (isOtherRoom && libraryId) {
                router.push(`/libraries/${libraryId}/channels/${toast.roomId}`);
                return;
              }
              if (toast.type === 'chat:message' || toast.type === 'mention') {
                router.push('/chat');
              }
            }}
            className="pointer-events-auto w-full rounded-lg border border-room-border bg-room-surface px-4 py-3 text-left shadow-2xl shadow-black/30 transition hover:bg-room-hover"
          >
            <div className="flex items-start gap-3">
              <span className={`mt-1 h-2.5 w-2.5 flex-none rounded-full ${
                toast.type === 'mention' ? 'bg-red-400' :
                toast.type === 'pdf:added' ? 'bg-blue-400' :
                toast.type === 'presence:join' ? 'bg-emerald-400' :
                'bg-room-muted'
              }`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-room-text">{toast.title}</span>
                {toastRoomName && (toast.type === 'chat:message' || toast.type === 'mention') && (
                  <span className="mt-0.5 block truncate text-[11px] font-medium text-blue-300">{toastRoomName}</span>
                )}
                {toast.body && (
                  <span className="mt-0.5 block line-clamp-2 text-xs text-room-muted">{toast.body}</span>
                )}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );




  return (
    <div 
      className="flex flex-col flex-1 h-[100dvh] bg-room-bg overflow-hidden relative"
      style={{ overscrollBehaviorX: 'none' }}
      onTouchStart={handleTouchStartGlobal}
      onTouchEnd={handleTouchEndGlobal}
    >
      {/* Glassmorphic voice/video calling overlay (completely isolated) */}
      <CallOverlay roomId={roomId} userId={initialUserId} userName={initialUserName} />

      {/* Settings overlay — rendered in-place, keeps RoomShell mounted */}
      {settingsOpen && <SettingsOverlay />}

      {/* Persistent Workspace Topbar */}
      <header className="flex-none flex items-center justify-between h-14 px-4 border-b border-room-border bg-room-surface z-[60]">
        
        {/* Left Nav */}
        <div className="flex items-center gap-1">
          {isMobile && (
            <button 
              onClick={() => {
                setActivePanel('libraries');
                setMobileSheetExpanded(!mobileSheetExpanded || activePanel !== 'libraries');
              }} 
              className="p-2 rounded-xl text-room-muted hover:text-room-text hover:bg-room-hover"
              title="Libraries"
            >
              <LayoutGrid size={20} />
            </button>
          )}
          {!isMobile && (
            <>
              <button 
                onClick={() => { setLeftView('nav'); if (librarySidebarCollapsed) toggleNavigation(); }} 
                className={`p-2 rounded-xl transition-all ${leftView === 'nav' && !librarySidebarCollapsed ? 'bg-blue-500/20 text-blue-400' : 'text-room-muted hover:text-room-text hover:bg-room-hover'}`} 
                title="Rooms & Libraries"
              >
                <Layers size={20} />
              </button>
              <button 
                onClick={() => { setLeftView('shelf'); if (librarySidebarCollapsed) toggleNavigation(); }} 
                className={`p-2 rounded-xl transition-all ${leftView === 'shelf' && !librarySidebarCollapsed ? 'bg-blue-500/20 text-blue-400' : 'text-room-muted hover:text-room-text hover:bg-room-hover'}`} 
                title="Files & Folders"
              >
                <FolderTreeIcon size={20} />
              </button>
            </>
          )}
        </div>

        {/* Center Title */}
        <div className="flex-1 min-w-0 flex justify-center pointer-events-none">
          <h1 className="text-sm font-bold text-room-text uppercase tracking-widest pointer-events-auto">
            ReadRoom
          </h1>
        </div>

        {/* Right Nav */}
        <div className="flex items-center gap-1">
          {isMobile ? (
            <>
              <button 
                onClick={() => setSettingsOpen(true)}
                className={`p-2 rounded-xl transition-all ${settingsOpen ? 'bg-blue-500/20 text-blue-400' : 'text-room-muted hover:text-room-text hover:bg-room-hover'}`}
                title="Settings"
              >
                <Settings size={20} />
              </button>
            </>
          ) : (
            <>
              <button 
                onClick={() => {
                  if (sidebarOpen && (activePanel === 'presence' || activePanel === 'notes')) setSidebarOpen(false);
                  else { setSidebarOpen(true); setActivePanel('presence'); }
                }} 
                className={`p-2 rounded-xl transition-all ${sidebarOpen && (activePanel === 'presence' || activePanel === 'notes') ? 'bg-blue-500/20 text-blue-400' : 'text-room-muted hover:text-room-text hover:bg-room-hover'}`} 
                title="People & Notes"
              >
                <PanelRight size={20} />
              </button>
              <button 
                onClick={() => setSettingsOpen(true)}
                className={`p-2 rounded-xl transition-all ${settingsOpen ? 'bg-blue-500/20 text-blue-400' : 'text-room-muted hover:text-room-text hover:bg-room-hover'}`}
                title="Settings"
              >
                <Settings size={20} />
              </button>
            </>
          )}
        </div>
      </header>

      <LibraryChatLauncher hidden={settingsOpen || showPicker || Boolean(pendingDeletePdf || pendingDeleteFolderId || movingPdf)} />

      {/* Main Workspace Area (Constrained below Topbar) */}
      <div className="flex-1 relative min-h-0 w-full overflow-hidden">

      {/* Unified Left Sidebar Overlay */}
      {!isMobile && !librarySidebarCollapsed && (
        <div className="absolute top-0 left-0 bottom-0 z-[55] flex pointer-events-none transition-all duration-300">
          <div ref={leftSidebarRef} className="flex h-full bg-room-surface shadow-2xl pointer-events-auto border-r border-room-border">
            
            {/* Sidebar Content */}
            <div className="flex flex-col bg-transparent border-l border-room-border/30" style={{ width: leftSidebarWidth }}>
               {leftView === 'nav' && (
                 <>
                   <div className="flex-1 overflow-y-auto min-h-0 flex">
                     <LibrarySidebar onClose={toggleNavigation} />
                     <div className="flex-1 border-l border-room-border min-w-0">
                       <ChannelSidebar onClose={toggleNavigation} />
                     </div>
                   </div>
                 </>
               )}
               {leftView === 'shelf' && (
                 <div className="flex-1 overflow-y-auto min-h-0 relative">
                   {ShelfContent}
                 </div>
               )}
            </div>
          </div>
          {/* Left Sidebar Resize Handle */}
          <div 
            className="w-2 cursor-col-resize pointer-events-auto hover:bg-blue-500/20 active:bg-blue-500/40 z-50 transition-colors" 
            onMouseDown={handleLeftResizeMouseDown}
          />
        </div>
      )}
{/* Main area - Persistent Fullscreen Canvas */}
      <main className="absolute inset-0 flex flex-col min-w-0 h-full z-0">

        {/* ── Room transition overlay ─────────────────────────────────────────
             Shown while loadTree is in-flight on channel switch.
             Sits above existing PDF content so it stays visible (no blank flash).
             Fades out once isTransitioning becomes false. */}
        {isTransitioning && (
          <div
            key="room-transition-overlay"
            aria-hidden
            className="absolute inset-0 z-[45] flex items-center justify-center
                       bg-room-bg pointer-events-none
                       animate-in fade-in duration-150"
          >
            <div className="flex flex-col items-center gap-3">
              <div className="w-6 h-6 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
              <span className="text-xs text-room-muted select-none">Switching room…</span>
            </div>
          </div>
        )}

        <div key="workspace-grid-container" className="flex-1 min-h-0 relative">
          {room?.pdf || openViewers.length > 0 ? (() => {
            const totalViewers = (room?.pdf ? 1 : 0) + openViewers.length;
            const allPanes: { key: string; element: React.ReactNode }[] = [];
            
            if (room?.pdf) {
              allPanes.push({
                key: 'main-workspace',
                element: (
                  <section key="main-workspace-section" className="min-h-0 h-full flex flex-col overflow-hidden rounded-lg border border-room-border bg-room-bg">
                    <div className="flex-none flex items-center justify-between gap-3 px-3 py-2 border-b border-room-border bg-room-surface">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold text-room-text">{room.pdf.filename}</p>
                        <p className="text-[10px] text-room-muted">Your workspace</p>
                      </div>
                      <button
                        onClick={() => {
                          setRoom({ ...room, pdf: null });
                          setCurrentChannelPdfId(null);
                          publishActivePdf(null, null);
                          setSyncState({ page: 1, scroll: 0, zoom: 1 });
                        }}
                        className="p-1.5 rounded-lg text-room-muted hover:text-room-text hover:bg-room-hover"
                        title="Close workspace"
                      >
                        <X size={18} />
                      </button>
                    </div>
                    <div className="flex-1 min-h-0">
                      <PDFViewer key="main-workspace-pdfviewer" pdf={room.pdf} accessToken={null} onRetry={() => {}} externalContainerRef={mainContainerRef} roomId={roomId} />
                    </div>
                  </section>
                )
              });
            }

            openViewers.forEach((viewer) => {
              allPanes.push({
                key: viewer.key,
                element: (
                  <SecondaryViewerSection
                    key={`secondary-viewer-${viewer.key}`}
                    viewer={viewer}
                    onClose={() => setOpenViewers((prev) => prev.filter((item) => item.key !== viewer.key))}
                    onStateChange={updateOpenViewerState}
                    roomId={roomId}
                  />
                )
              });
            });

            allPanes.sort((a, b) => {
              const aIdx = paneOrder.indexOf(a.key);
              const bIdx = paneOrder.indexOf(b.key);
              if (aIdx === -1 && bIdx === -1) return 0;
              if (aIdx === -1) return 1;
              if (bIdx === -1) return -1;
              return aIdx - bIdx;
            });

            return (
              <div className={`h-full overflow-y-auto overflow-x-hidden p-2 grid gap-2 ${totalViewers > 1 ? 'md:grid-cols-2 auto-rows-[minmax(50vh,1fr)]' : 'grid-cols-1'}`}>
                {allPanes.map((pane) => (
                  <ResizablePaneWrapper
                    key={pane.key}
                    paneKey={pane.key}
                    element={pane.element}
                    draggedPaneKey={draggedPaneKey}
                    dragOverPaneKey={dragOverPaneKey}
                    onDragStart={() => setDraggedPaneKey(pane.key)}
                    onDragEnd={() => {
                      setDraggedPaneKey(null);
                      setDragOverPaneKey(null);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      if (draggedPaneKey && draggedPaneKey !== pane.key) {
                        setDragOverPaneKey(pane.key);
                      }
                    }}
                    onDragLeave={() => {
                      if (dragOverPaneKey === pane.key) {
                        setDragOverPaneKey(null);
                      }
                    }}
                    onDrop={() => {
                      if (!draggedPaneKey || draggedPaneKey === pane.key) return;

                      setPaneOrder(prev => {
                        const currentOrder = allPanes.map(p => p.key);
                        let next = currentOrder;
                        if (prev.length > 0) {
                          const validPrev = prev.filter(k => currentOrder.includes(k));
                          const newPanes = currentOrder.filter(k => !validPrev.includes(k));
                          next = [...validPrev, ...newPanes];
                        }
                        const fromIdx = next.indexOf(draggedPaneKey);
                        const toIdx = next.indexOf(pane.key);
                        if (fromIdx !== -1 && toIdx !== -1) {
                          const temp = next[fromIdx];
                          next[fromIdx] = next[toIdx];
                          next[toIdx] = temp;
                        }
                        return next;
                      });

                      setDraggedPaneKey(null);
                      setDragOverPaneKey(null);
                    }}
                  />
                ))}
              </div>
  );
          })() : (
            <EmptyState onOpen={() => {
              handleUploadToFolder(null);
            }} />
          )}

        </div>
      </main>

      {/* Desktop Right Sidebars (Overlays) */}
      {!isMobile && (
        <div ref={rightSidebarContainerRef} className="absolute top-0 right-0 bottom-0 z-[55] flex flex-row-reverse pointer-events-none">
          
          {/* Aux Sidebar (People/Notes) Overlay */}
          {sidebarOpen && (activePanel === 'presence' || activePanel === 'notes') && (
             <div className="flex h-full relative pointer-events-auto shadow-2xl bg-room-surface border-l border-room-border" style={{ width: sidebarWidth }}>
                <div 
                  className="absolute left-0 top-0 bottom-0 w-2 -translate-x-1 cursor-col-resize hover:bg-blue-500/20 active:bg-blue-500/40 z-50 transition-colors"
                  onMouseDown={handleResizeMouseDown}
                />
                {AuxRightSidebar}
             </div>
          )}
        </div>
      )}
      </div>


      {/* Mobile Sheet Backdrop & Container handled via MobileBottomSheet component */}
      {isMobile && (
        <MobileBottomSheet
          expanded={mobileSheetExpanded}
          setExpanded={setMobileSheetExpanded}
          fullHeight={activePanel === 'chat'}
        >
          {RightSidebarContent}
        </MobileBottomSheet>
      )}

      {typeof document !== 'undefined'
        ? createPortal(toastStack, document.fullscreenElement || document.body)
        : null}

      {(pendingDeletePdf || pendingDeleteFolderId) && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-room-border bg-room-surface p-5 shadow-2xl">
            <h2 className="text-base font-semibold text-room-text">
              {pendingDeletePdf ? 'Delete PDF?' : 'Delete folder?'}
            </h2>
            <p className="mt-2 text-sm text-room-muted">
              {pendingDeletePdf
                ? `"${pendingDeletePdf.filename}" will be removed from this room and storage.`
                : `"${pendingDeleteFolderName}" and all nested folders and PDFs will be permanently deleted.`}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => {
                  setPendingDeletePdf(null);
                  setPendingDeleteFolderId(null);
                }}
                className="min-h-[42px] rounded-xl border border-room-border px-4 text-sm font-medium text-room-muted hover:bg-room-hover hover:text-room-text"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (pendingDeletePdf) performDeleteChannelPDF(pendingDeletePdf);
                  else if (pendingDeleteFolderId) performDeleteFolder(pendingDeleteFolderId);
                }}
                disabled={Boolean(pendingDeletePdf && deletingPdfId === pendingDeletePdf.id)}
                className="min-h-[42px] rounded-xl bg-red-500 px-4 text-sm font-medium text-white hover:bg-red-400 disabled:opacity-50"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {movingPdf && (
        <div className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-sm rounded-2xl border border-room-border bg-room-surface p-5 shadow-2xl">
            <h2 className="text-base font-semibold text-room-text">Move PDF</h2>
            <p className="mt-1 truncate text-sm text-room-muted">{movingPdf.filename}</p>
            <label className="mt-4 block">
              <span className="mb-2 block text-xs font-semibold text-room-muted">Destination</span>
              <select
                value={moveTargetFolderId ?? ''}
                onChange={(e) => setMoveTargetFolderId(e.target.value || null)}
                className="w-full rounded-xl border border-room-border bg-room-bg px-3 py-2.5 text-sm text-room-text outline-none focus:border-blue-500/60"
              >
                {folderOptions.map((folder) => (
                  <option key={folder.id ?? 'root'} value={folder.id ?? ''}>
                    {`${'  '.repeat(folder.depth)}${folder.name}`}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setMovingPdf(null)}
                className="min-h-[42px] rounded-xl border border-room-border px-4 text-sm font-medium text-room-muted hover:bg-room-hover hover:text-room-text"
              >
                Cancel
              </button>
              <button
                onClick={performMovePdf}
                disabled={movingPdfId === movingPdf.id}
                className="min-h-[42px] rounded-xl bg-blue-500 px-4 text-sm font-medium text-white hover:bg-blue-400 disabled:opacity-50"
              >
                {movingPdfId === movingPdf.id ? 'Moving…' : 'Move'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPicker && (
        <GooglePicker
          onSelect={handlePDFSelect}
          onLocalUploaded={handleRoomPdfUploaded}
          onClose={() => {
            setShowPicker(false);
            setUploadFolderId(null);
          }}
          libraryId={libraryId}
          channelId={channelId}
          initialFolderId={uploadFolderId}
        />
      )}
    </div>
  );
}

// ── Secondary Viewer Section ───────────────────────────────────────────────────

const SecondaryViewerSection = React.memo(({ 
  viewer, 
  onClose, 
  onStateChange,
  roomId
}: { 
  viewer: OpenViewer; 
  onClose: () => void;
  onStateChange: (key: string, patch: Partial<PDFViewerState>) => void;
  roomId?: string;
}) => {
  const handleStateChange = useCallback((patch: Partial<PDFViewerState>) => {
    onStateChange(viewer.key, patch);
  }, [onStateChange, viewer.key]);

  return (
    <section className="min-h-0 h-full flex flex-col overflow-hidden rounded-lg border border-room-border bg-room-bg">
      <div className="flex-none flex items-center justify-between gap-3 px-3 py-2 border-b border-room-border bg-room-surface">
        <div className="flex items-center gap-2 min-w-0">
          {viewer.followUserId && (
            <div className="flex-shrink-0">
              {(() => {
                const users = usePresenceStore.getState().users;
                const self = usePresenceStore.getState().self;
                const baseId = viewer.followUserId.split('_')[0];
                const target = self?.userId.startsWith(baseId) ? self : Array.from(users.values()).find(u => u.userId.startsWith(baseId));
                if (target) return <Avatar user={target} size="xs" showTooltip={false} />;
                return null;
              })()}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-room-text">{viewer.title}</p>
            <p className="text-[10px] text-room-muted truncate max-w-[180px]">
              {viewer.followUserId ? (viewer.pdf?.filename || 'Follow PDF') : 'Secondary viewer'}
            </p>
          </div>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-room-muted hover:text-room-text hover:bg-room-hover"
          title="Close viewer"
        >
          <X size={18} />
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <PDFViewer
          pdf={viewer.pdf}
          accessToken={null}
          onRetry={() => {}}
          viewerState={viewer.state}
          onViewerStateChange={handleStateChange}
          followModeOverride={Boolean(viewer.followUserId)}
          roomId={roomId}
        />
      </div>
    </section>
  );
});

SecondaryViewerSection.displayName = 'SecondaryViewerSection';
