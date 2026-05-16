'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { Menu, X, MessageSquare, Layers, Users, FileText, FolderOpen, LayoutGrid, Pencil, Trash2, GripVertical } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { useUIStore } from '@/store/uiStore';
import { useRoomStore } from '@/store/roomStore';
import { usePDFStore } from '@/store/pdfStore';
import { PDFViewer, type PDFViewerState } from '@/components/pdf/PDFViewer';
import { PresenceBar } from './PresenceBar';
import { Chat } from './Chat';
import { Notes } from './Notes';
import { PresenceList } from './PresenceList';
import { GooglePicker } from '@/components/drive/GooglePicker';
import { useAuth } from '@/lib/hooks/useAuth';
import { LibrarySidebar } from '@/components/layout/LibrarySidebar';
import { ChannelSidebar } from '@/components/layout/ChannelSidebar';
import { ChatSidebar } from '@/components/layout/ChatSidebar';
import { usePDFSync } from '@/lib/hooks/usePDFSync';
import { usePresence } from '@/lib/hooks/usePresence';
import { getSocket } from '@/lib/socket/client';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { usePresenceStore } from '@/store/presenceStore';
import type { PDFMeta, ChannelPDF, RoomActivity } from '@/types';

import { useIsMobile } from '@/lib/hooks/useIsMobile';

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
          Open a PDF from Google Drive to start a shared reading session.
        </p>
      </div>
      <button
        onClick={onOpen}
        className="flex items-center gap-2 px-5 py-3 rounded-xl bg-blue-600 text-white font-medium text-sm hover:bg-blue-500 transition-colors min-h-[44px]"
      >
        <FolderOpen size={16} />
        Open PDF from Google Drive
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
          className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-30 animate-in fade-in"
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
                  <X size={16} />
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
  const { 
    sidebarOpen, setSidebarOpen, activePanel, setActivePanel,
    librarySidebarCollapsed, channelSidebarCollapsed, toggleLibrarySidebar, toggleChannelSidebar,
    chatSidebarCollapsed, toggleChatSidebar,
    toggleNavigation
  } = useUIStore();

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
  const followTarget = usePDFStore((s) => s.followTarget);

  const [channelPDFs, setChannelPDFs] = useState<ChannelPDF[]>([]);
  const [currentChannelPdfId, setCurrentChannelPdfId] = useState<string | null>(null);
  const [openViewers, setOpenViewers] = useState<OpenViewer[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [pdfLibraryError, setPdfLibraryError] = useState<string | null>(null);
  const [deletingPdfId, setDeletingPdfId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastActivity[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [mobileSheetExpanded, setMobileSheetExpanded] = useState(false);
  const [mobileChatOpen, setMobileChatOpen] = useState(false);
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
  const isChatVisible = isMobile
    ? mobileChatOpen || (mobileSheetExpanded && activePanel === 'chat')
    : !chatSidebarCollapsed || (sidebarOpen && activePanel === 'chat');
  const processedNotificationIdsRef = useRef<Set<string>>(new Set());
  const unreadCountRef = useRef(0);
  const isChatVisibleRef = useRef(false);

  useEffect(() => {
    unreadCountRef.current = unreadCount;
  }, [unreadCount]);

  useEffect(() => {
    isChatVisibleRef.current = isChatVisible;
  }, [isChatVisible]);

  const clearUnread = useCallback(() => {
    setUnreadCount(0);
    unreadCountRef.current = 0;
    try {
      const stored = localStorage.getItem(notificationStorageKey);
      const parsed = stored ? JSON.parse(stored) : {};
      localStorage.setItem(notificationStorageKey, JSON.stringify({
        ...parsed,
        unreadCount: 0,
        lastReadAt: Date.now(),
      }));
    } catch {}
  }, [notificationStorageKey]);

  const persistNotificationState = useCallback((nextUnreadCount: number, activityId: string) => {
    try {
      const stored = localStorage.getItem(notificationStorageKey);
      const parsed = stored ? JSON.parse(stored) : {};
      const recentIds = Array.isArray(parsed.recentIds) ? parsed.recentIds : [];
      const nextRecentIds = [activityId, ...recentIds.filter((id: string) => id !== activityId)].slice(0, 100);
      localStorage.setItem(notificationStorageKey, JSON.stringify({
        ...parsed,
        unreadCount: nextUnreadCount,
        recentIds: nextRecentIds,
        updatedAt: Date.now(),
      }));
    } catch {}
  }, [notificationStorageKey]);

  const showBrowserNotification = useCallback((activity: RoomActivity) => {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    // Only suppress when the tab is actively in the foreground AND chat is visible.
    // If the window is minimized or tab is backgrounded, always show the notification.
    const tabIsVisible = document.visibilityState === 'visible';
    if (tabIsVisible && isChatVisibleRef.current) return;

    try {
      new Notification(activity.title, {
        body: activity.body,
        tag: activity.id,
        icon: '/icons/icon-192.png',
      });
    } catch {}
  }, []);

  const pushToast = useCallback((activity: RoomActivity) => {
    const toast: ToastActivity = { ...activity, toastId: `${activity.id}:${Date.now()}` };
    setToasts((prev) => [...prev.slice(-3), toast]);
    window.setTimeout(() => {
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
      setUnreadCount(Number(parsed.unreadCount ?? 0));
      if (Array.isArray(parsed.recentIds)) {
        processedNotificationIdsRef.current = new Set(parsed.recentIds.slice(0, 100));
      }
    } catch {}
  }, [notificationStorageKey]);

  useEffect(() => {
    if (isChatVisible) clearUnread();
  }, [clearUnread, isChatVisible]);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key !== notificationStorageKey || !event.newValue) return;
      try {
        const parsed = JSON.parse(event.newValue);
        setUnreadCount(Number(parsed.unreadCount ?? 0));
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

  const { driveToken, requestDriveAccess } = useAuth();
  const { activeLibraryId, updateChannel } = useWorkspaceStore();

  selfRef.current = self;

  const selectionStorageKey = libraryId && channelId
    ? `readroom:selected-pdf:${libraryId}:${channelId}:${initialUserId}`
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
    driveId: raw.driveId ?? raw.drive_id,
    filename: raw.filename,
    thumbnailUrl: raw.thumbnailUrl ?? raw.thumbnail_url ?? null,
    storagePath: raw.storagePath ?? raw.storage_path ?? null,
    url: raw.url ?? null,
    position: raw.position ?? 0,
    createdAt: raw.createdAt ?? raw.created_at ?? new Date().toISOString(),
  }), [channelId, roomId]);

  const fetchChannelPDFs = useCallback(async () => {
    if (!libraryId || !channelId) return [];
    const res = await fetch(`/api/libraries/${libraryId}/channels/${channelId}/pdfs`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.hint || data.error || 'Failed to load channel PDFs');
    return ((data.pdfs ?? []) as any[]).map(normalizeChannelPDF);
  }, [channelId, normalizeChannelPDF, libraryId]);

  useEffect(() => {
    if (initialRoom && !room) {
      setRoom(initialRoom);
      setSyncState({
        page: Math.max(1, Number(initialRoom.currentPage ?? 1) || 1),
        scroll: Math.max(0, Number(initialRoom.scrollPct ?? 0) || 0),
        zoom: Math.max(0.5, Number(initialRoom.zoom ?? 1) || 1),
      });
    }
  }, [initialRoom, room, setRoom, setSyncState]);

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
      isActive: true,
      lastSeen: Date.now(),
    };
    updateSelf(patch);
    getSocket().emit('presence:update', {
      roomId,
      user: {
        ...currentSelf,
        ...patch,
      },
    });
  }, [roomId, updateSelf]);

  useEffect(() => {
    if (!libraryId || !channelId) {
      setChannelPDFs([]);
      setCurrentChannelPdfId(null);
      return;
    }

    let cancelled = false;
    fetchChannelPDFs()
      .then((pdfs) => {
        if (cancelled) return;
        setChannelPDFs(pdfs);

        const storedPdfId = selectionStorageKey ? localStorage.getItem(selectionStorageKey) : null;

        // If the stored PDF ID no longer exists (was deleted), clear the stale key
        if (storedPdfId && !pdfs.some((item) => item.id === storedPdfId)) {
          if (selectionStorageKey) localStorage.removeItem(selectionStorageKey);
        }

        const desiredPdf = pdfs.find((item) => item.id === storedPdfId) ??
          pdfs.find((item) => item.driveId === room?.pdf?.fileId) ??
          pdfs[0];

        if (!desiredPdf) {
          // Channel has no PDFs — reset any stale initialRoom.pdf to prevent ghost loading
          setCurrentChannelPdfId(null);
          setRoom(buildRoomState(null));
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
      })
      .catch((err) => {
        console.error('[RoomShell] failed to fetch channel PDFs', err);
        setPdfLibraryError(err instanceof Error ? err.message : String(err));
      });
    return () => { cancelled = true; };
  }, [libraryId, channelId, buildRoomState, channelPdfToMeta, fetchChannelPDFs, room?.pdf?.fileId, room?.pdf?.url, publishActivePdf, selectionStorageKey, setRoom]);

  usePDFSync(roomId, mainContainerRef, currentChannelPdfId, room?.pdf?.filename);
  usePresence(roomId, libraryId ?? null, initialUserId, initialUserName, currentChannelPdfId, room?.pdf?.filename ?? null);

  // Expose roomId globally so PresenceList can emit presence:update for avatar changes
  useEffect(() => {
    (window as any).__readroom_roomId = roomId;
    return () => { delete (window as any).__readroom_roomId; };
  }, [roomId]);

  // Restore saved avatar URL from localStorage into self on mount
  useEffect(() => {
    try {
      const savedUrl = localStorage.getItem('readroom:avatar-url');
      if (savedUrl) {
        usePresenceStore.getState().updateSelf({ avatarUrl: savedUrl });
      }
    } catch {}
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Stable Socket Listeners ────────────────────────────────────────────────
  useEffect(() => {
    const socket = getSocket();
    if (!socket.connected) socket.connect();

    console.log('[RoomShell] registering socket listeners for room:', roomId);

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
    };

    const handleLibraryUpdated = (activity: RoomActivity) => {
      console.log('[RoomShell] library:updated', activity.roomId);
      if (activity.roomId !== roomId) return;
      fetchChannelPDFs().then(setChannelPDFs).catch(console.error);
    };

    const handleActivity = (activity: RoomActivity) => {
      if (!activity?.id || activity.roomId !== roomId) return;
      if (processedNotificationIdsRef.current.has(activity.id)) return;

      console.log('[RoomShell] notification:activity', activity.id, activity.type);
      processedNotificationIdsRef.current.add(activity.id);

      // Skip own activities
      const activityUserBaseId = activity.userId?.split('_')[0];
      if (activityUserBaseId === initialUserId) return;

      // Handle mention logic
      const body = activity.body ?? '';
      const isMention = body.toLowerCase().includes(`@${initialUserName.toLowerCase()}`);
      const nextActivity = isMention && activity.type === 'chat:message'
        ? { ...activity, type: 'mention' as const, title: `${activity.userName ?? 'Someone'} mentioned you` }
        : activity;

      if (!isChatVisibleRef.current || nextActivity.type !== 'chat:message') {
        pushToast(nextActivity);
        showBrowserNotification(nextActivity);
      }

      if (!isChatVisibleRef.current || nextActivity.type === 'mention') {
        setUnreadCount((prev) => {
          const next = Math.min(999, prev + 1);
          unreadCountRef.current = next;
          persistNotificationState(next, nextActivity.id);
          return next;
        });
      }
    };

    const handleConnect = () => {
      console.log('[RoomShell] socket connected, refreshing library');
      fetchChannelPDFs().then(setChannelPDFs).catch(console.error);
    };

    socket.on('pdf:added', handlePdfAdded);
    socket.on('library:updated', handleLibraryUpdated);
    socket.on('notification:activity', handleActivity);
    socket.on('connect', handleConnect);

    return () => {
      console.log('[RoomShell] cleaning up socket listeners');
      socket.off('pdf:added', handlePdfAdded);
      socket.off('library:updated', handleLibraryUpdated);
      socket.off('notification:activity', handleActivity);
      socket.off('connect', handleConnect);
    };
  }, [roomId, initialUserId, initialUserName, buildRoomState, channelPdfToMeta, fetchChannelPDFs, persistNotificationState, pushToast, showBrowserNotification, currentChannelPdfId, normalizeChannelPDF, publishActivePdf, setRoom]);

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

    // Try to find the PDF in the channel list
    let pdf = channelPDFs.find((item) => item.id === followed.activePdfId);

    const openAndSync = (targetPdf: ChannelPDF) => {
      openPdfViewer(targetPdf, { followUserId: followTarget, title: `Following ${followed.userName}` });
      // Seed the viewer with the followed user's current position immediately
      updateOpenViewerState(`follow:${followTarget}`, {
        page: Math.max(1, followed.page ?? 1),
        scroll: Math.max(0, Math.min(1, followed.scroll ?? 0)),
        zoom: Math.max(0.5, followed.zoom ?? 1),
      });
    };

    if (pdf) {
      openAndSync(pdf);
    } else if (libraryId && channelId) {
      // PDF not yet in local list — fetch the channel library to find it
      fetchChannelPDFs()
        .then((pdfs) => {
          setChannelPDFs(pdfs);
          const found = pdfs.find((item) => item.id === followed.activePdfId);
          if (found) openAndSync(found);
        })
        .catch(() => {});
    }
  }, [channelPDFs, channelId, fetchChannelPDFs, followTarget, openPdfViewer, libraryId, updateOpenViewerState, usersMap]);

  // ── Follow mode: sync viewer as followed user navigates ─────────────────────
  useEffect(() => {
    const socket = getSocket();
    const handler = (payload: {
      roomId?: string;
      userId: string;
      activePdfId?: string | null;
      page: number;
      scroll: number;
      zoom: number;
    }) => {
      if ((payload as any).roomId && (payload as any).roomId !== roomId) return;
      const key = `follow:${payload.userId}`;
      const isOpenFollow = openViewers.some((viewer) => viewer.key === key);
      const isActiveFollow = followTarget === payload.userId;

      if (!isOpenFollow && !isActiveFollow) return;

      // If PDF changed while following, try to open the new PDF
      if (payload.activePdfId) {
        const alreadyOpen = openViewers.find((v) => v.key === key);
        if (!alreadyOpen || alreadyOpen.pdfId !== payload.activePdfId) {
          const pdf = channelPDFs.find((item) => item.id === payload.activePdfId);
          if (pdf) {
            const followedUser = usersMap.get(payload.userId);
            openPdfViewer(pdf, {
              followUserId: payload.userId,
              title: `Following ${followedUser?.userName ?? 'User'}`,
            });
          } else if (libraryId && channelId) {
            // Fetch updated library in case this PDF is new
            fetchChannelPDFs()
              .then((pdfs) => {
                setChannelPDFs(pdfs);
                const found = pdfs.find((item) => item.id === payload.activePdfId);
                if (found) {
                  const followedUser = usersMap.get(payload.userId);
                  openPdfViewer(found, {
                    followUserId: payload.userId,
                    title: `Following ${followedUser?.userName ?? 'User'}`,
                  });
                }
              })
              .catch(() => {});
          }
        }
      }

      // Always update position
      updateOpenViewerState(key, {
        page: Math.max(1, payload.page ?? 1),
        scroll: Math.max(0, Math.min(1, payload.scroll ?? 0)),
        zoom: Math.max(0.5, payload.zoom ?? 1),
      });
    };

    socket.on('sync:state', handler as any);
    return () => {
      socket.off('sync:state', handler as any);
    };
  }, [channelId, channelPDFs, fetchChannelPDFs, followTarget, openPdfViewer, openViewers, roomId, libraryId, updateOpenViewerState, usersMap]);

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
      setRoom(buildRoomState(selected));
      setSyncState({ page: 1, scroll: 0, zoom: 1 });
      setCurrentChannelPdfId(pdf.id);
      if (selectionStorageKey) localStorage.setItem(selectionStorageKey, pdf.id);
      publishActivePdf(pdf.id, pdf.filename);
      setShowPicker(false);
    },
    [channelPdfToMeta, setRoom, buildRoomState, setSyncState, selectionStorageKey, publishActivePdf]
  );

  const deleteChannelPDF = useCallback(
    async (pdf: ChannelPDF) => {
      if (!libraryId || !channelId) return;
      const confirmed = window.confirm(`Delete "${pdf.filename}" from this room?`);
      if (!confirmed) return;

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

        getSocket().emit('library:updated', {
          id: `library:deleted:${pdf.id}:${Date.now()}`,
          roomId,
          type: 'room:activity',
          title: `${initialUserName || 'Someone'} deleted a PDF`,
          body: pdf.filename,
          userId: initialUserId,
          userName: initialUserName,
          ts: Date.now(),
          metadata: { action: 'deleted', pdfId: pdf.id },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[RoomShell] delete PDF failed', err);
        setPdfLibraryError(message);
      } finally {
        setDeletingPdfId(null);
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
    ]
  );

  const handlePDFSelect = useCallback(
    async (pdf: PDFMeta) => {
      setPdfLibraryError(null);
      if (!libraryId || !channelId) return;

      try {
        const res = await fetch(`/api/libraries/${libraryId}/channels/${channelId}/pdfs`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              driveId: pdf.fileId,
              filename: pdf.filename,
              thumbnailUrl: pdf.thumbnail,
              driveAccessToken: driveToken,
            }),
          });
          const data = await res.json();

          if (!res.ok) {
            const message = data.hint || data.error || 'Failed to add PDF';
            setPdfLibraryError(message);
            console.error('[RoomShell] add PDF failed', { status: res.status, data });
            if (res.status === 401) requestDriveAccess();
            throw new Error(message);
          }

          const addedPdf = normalizeChannelPDF(data.pdf);
          setChannelPDFs((prev) =>
            prev.some((item) => item.id === addedPdf.id)
              ? prev.map((item) => item.id === addedPdf.id ? addedPdf : item)
              : [...prev, addedPdf]
          );
          await selectChannelPDF(addedPdf);
          getSocket().emit('pdf:added', {
            id: `pdf:added:${addedPdf.id}`,
            roomId,
            type: 'pdf:added',
            title: `${initialUserName || 'Someone'} added a PDF`,
            body: addedPdf.filename,
            userId: initialUserId,
            userName: initialUserName,
            ts: Date.now(),
            metadata: { pdf: addedPdf },
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          setPdfLibraryError(message);
          throw err;
        }
    },
    [libraryId, channelId, driveToken, normalizeChannelPDF, selectChannelPDF, setRoom, buildRoomState, roomId, setSyncState, requestDriveAccess, initialUserId, initialUserName]
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
              {room?.name ?? 'Reading Room'}
            </h1>
          )}
          <button
            onClick={() => setIsEditingRoomName(true)}
            className="p-1.5 rounded-lg text-room-muted hover:text-room-text hover:bg-room-hover"
            title="Rename room"
          >
            <Pencil size={14} />
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
          <PresenceList />
        </div>

        <div className={activePanel === 'shelf' ? 'flex flex-col h-full overflow-y-auto' : 'hidden'}>
          <div className="flex flex-col h-full p-4">
             <div className="flex items-center justify-between mb-4">
                <span className="text-[11px] font-bold text-room-muted tracking-widest flex items-center gap-2">
                  <FolderOpen size={12} />
                  ROOM LIBRARY
                </span>
                <button 
                  onClick={() => {
                    setPdfLibraryError(null);
                    setShowPicker(true);
                  }} 
                  className="text-blue-400 hover:text-blue-300 text-xs font-medium px-2 py-1 rounded-lg hover:bg-blue-400/10 transition-all"
                >
                  + Add
                </button>
              </div>

              {room?.pdf ? (
                <div className="mb-4 p-3 bg-room-bg rounded-xl border border-room-border flex items-start gap-3 w-full">
                  <img
                    src={room.pdf.thumbnail ?? `https://drive.google.com/thumbnail?authuser=0&sz=w128&id=${room.pdf.fileId}`}
                    alt={room.pdf.filename}
                    className="w-12 h-16 object-cover rounded shadow-sm bg-room-surface flex-shrink-0"
                    onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                  />
                  <div className="min-w-0 flex-1 flex flex-col justify-center h-16">
                    <p className="text-sm text-room-text font-semibold truncate leading-tight mb-1">{room.pdf.filename}</p>
                    <p className="text-[10px] text-room-muted tracking-wider font-bold">
                      {room.pdf.url ? 'ROOM LIBRARY' : 'GOOGLE DRIVE'}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="mb-4 p-6 border-2 border-dashed border-room-border rounded-2xl text-center">
                  <p className="text-xs text-room-muted mb-3">No active document</p>
                  <button
                    onClick={() => {
                      setPdfLibraryError(null);
                      setShowPicker(true);
                    }}
                    className="px-4 py-2 bg-blue-500 text-white rounded-xl text-xs font-bold"
                  >
                    Load from Drive
                  </button>
                </div>
              )}

              {pdfLibraryError && (
                <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
                  {pdfLibraryError}
                </div>
              )}

              <div className="space-y-1.5 overflow-y-auto">
                {channelPDFs.map((pdf) => (
                  <div
                    key={pdf.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => selectChannelPDF(pdf)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        selectChannelPDF(pdf);
                      }
                    }}
                    className={`w-full text-left px-4 py-3 rounded-xl transition-all border ${
                      pdf.id === currentChannelPdfId 
                        ? 'bg-blue-500/10 border-blue-500/50 text-blue-400' 
                        : 'bg-room-bg/50 border-transparent text-room-muted hover:bg-room-hover hover:text-room-text'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="truncate text-sm font-medium">{pdf.filename}</span>
                      <span className="flex items-center gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openPdfViewer(pdf);
                          }}
                          className="px-2 py-1 rounded-md text-[10px] bg-room-surface text-room-muted hover:text-room-text"
                        >
                          Side
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            deleteChannelPDF(pdf);
                          }}
                          disabled={deletingPdfId === pdf.id}
                          className="p-1.5 rounded-md bg-room-surface text-room-muted hover:text-red-300 hover:bg-red-500/10 disabled:opacity-40 disabled:cursor-wait transition-colors"
                          title="Delete PDF"
                          aria-label={`Delete ${pdf.filename}`}
                        >
                          <Trash2 size={13} />
                        </button>
                        {pdf.id === currentChannelPdfId && (
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.5)]" />
                        )}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div 
      className="flex flex-1 h-[100dvh] bg-room-bg overflow-hidden relative"
      style={{ overscrollBehaviorX: 'none' }}
      onTouchStart={handleTouchStartGlobal}
      onTouchEnd={handleTouchEndGlobal}
    >
      {/* Desktop Sidebars (Libraries & Rooms) */}
      {!isMobile && (
        <>
          <LibrarySidebar onClose={toggleNavigation} />
          <ChannelSidebar onClose={toggleNavigation} />
        </>
      )}

      {/* Main area */}
      <main className="flex-1 flex flex-col min-w-0 h-full relative">
        <header className="flex-none flex items-center h-14 md:h-16 px-3 md:px-4 border-b border-room-border bg-room-surface/90 backdrop-blur-md sticky top-0 z-40 gap-4">
          {/* Left Side: Navigation & People */}
          <div className="flex items-center bg-room-bg/50 rounded-xl p-1 border border-room-border shadow-sm">
            <SidebarToggle 
              active={isMobile ? activePanel === 'libraries' : !librarySidebarCollapsed} 
              onClick={() => {
                if (isMobile) {
                  setActivePanel('libraries');
                  setMobileSheetExpanded(true);
                } else {
                  toggleNavigation();
                }
              }} 
              title="Libraries"
              icon={<LayoutGrid size={16} />}
            />
          </div>

          <div className="flex-1 min-w-0">
            <h1 className="text-xs md:text-sm font-semibold text-room-text truncate">
              {room?.pdf?.filename ?? (room?.name ?? 'Reading Room')}
            </h1>
          </div>

          {/* Right Side: Chat & Status */}
          <div className="flex items-center gap-2">
            {isMobile && (
              <div className="flex items-center bg-room-bg/50 rounded-xl p-1 border border-room-border shadow-sm">
                <SidebarToggle 
                  active={mobileChatOpen} 
                  onClick={() => {
                    setMobileChatOpen(!mobileChatOpen);
                    if (!mobileChatOpen) clearUnread();
                  }} 
                  title="Chat"
                  icon={<MessageSquare size={16} />}
                  badgeCount={unreadCount}
                />
              </div>
            )}
            {!isMobile && (
              <div className="flex items-center bg-room-bg/50 rounded-xl p-1 border border-room-border shadow-sm">
                <SidebarToggle 
                  active={sidebarOpen} 
                  onClick={() => setSidebarOpen(!sidebarOpen)} 
                  title="Workspace"
                  icon={<Layers size={16} />}
                />
                <SidebarToggle 
                  active={!chatSidebarCollapsed} 
                  onClick={() => {
                    toggleChatSidebar();
                    if (chatSidebarCollapsed) clearUnread();
                  }} 
                  title="Chat"
                  icon={<MessageSquare size={16} />}
                  badgeCount={unreadCount}
                />
              </div>
            )}
            <div className="hidden md:block">
              <PresenceBar />
            </div>
          </div>
        </header>

        <div className="flex-1 min-h-0 relative">
          {room?.pdf && !room.pdf.url && !driveToken ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center space-y-4 px-6 max-w-sm">
                <div className="w-16 h-16 rounded-full bg-blue-500/10 flex items-center justify-center text-2xl mx-auto mb-2">
                  🔑
                </div>
                <h3 className="text-lg font-bold text-room-text">Authorization Required</h3>
                <p className="text-room-muted text-sm">To view this PDF from your Google Drive, we need your permission.</p>
                <button
                  onClick={requestDriveAccess}
                  className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-500 transition-all shadow-lg shadow-blue-600/20 active:scale-95"
                >
                  <FolderOpen size={18} />
                  Authorize Google Drive
                </button>
              </div>
            </div>
          ) : room?.pdf || openViewers.length > 0 ? (
            <div className={`h-full grid gap-2 p-2 ${openViewers.length > 0 ? 'md:grid-cols-2' : 'grid-cols-1'}`}>
              {room?.pdf && (
                <section className="min-h-0 flex flex-col overflow-hidden rounded-lg border border-room-border bg-room-bg">
                  <div className="flex-none flex items-center justify-between gap-3 px-3 py-2 border-b border-room-border bg-room-surface">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold text-room-text">{room.pdf.filename}</p>
                      <p className="text-[10px] text-room-muted">Your workspace</p>
                    </div>
                    <button
                      onClick={() => {
                        // Close own workspace: clear the main PDF
                        setRoom({ ...room, pdf: null });
                        setCurrentChannelPdfId(null);
                        publishActivePdf(null, null);
                        setSyncState({ page: 1, scroll: 0, zoom: 1 });
                      }}
                      className="p-1.5 rounded-lg text-room-muted hover:text-room-text hover:bg-room-hover"
                      title="Close workspace"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div className="flex-1 min-h-0">
                    <PDFViewer
                      pdf={room.pdf}
                      accessToken={room.pdf.url ? null : driveToken}
                      onRetry={room.pdf.url ? () => {} : requestDriveAccess}
                      externalContainerRef={mainContainerRef}
                    />
                  </div>
                </section>
              )}

              {openViewers.map((viewer) => (
                <SecondaryViewerSection
                  key={viewer.key}
                  viewer={viewer}
                  driveToken={driveToken}
                  requestDriveAccess={requestDriveAccess}
                  onClose={() => setOpenViewers((prev) => prev.filter((item) => item.key !== viewer.key))}
                  onStateChange={updateOpenViewerState}
                />
              ))}
            </div>
          ) : (
            <EmptyState onOpen={() => {
              setPdfLibraryError(null);
              setShowPicker(true);
            }} />
          )}

          {isMobile && (
            <MobileBottomSheet
              expanded={mobileSheetExpanded}
              setExpanded={setMobileSheetExpanded}
              fullHeight={activePanel === 'chat'}
            >
              {RightSidebarContent}
            </MobileBottomSheet>
          )}
        </div>
      </main>

      {/* Desktop Right Sidebars */}
      {!isMobile && (
        <>
          <ChatSidebar roomId={roomId} onClose={toggleChatSidebar} />
          {sidebarOpen && (
            <aside
              className="flex-none border-l border-room-border bg-room-surface flex flex-col relative"
              style={{ width: sidebarWidth }}
            >
              {/* Drag-to-resize handle on left edge */}
              <div
                className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize z-10 group flex items-center justify-center hover:bg-blue-500/20 transition-colors"
                onMouseDown={handleResizeMouseDown}
                title="Drag to resize"
              >
                <GripVertical
                  size={12}
                  className="text-room-border group-hover:text-blue-400 transition-colors opacity-0 group-hover:opacity-100"
                />
              </div>
              {RightSidebarContent}
            </aside>
          )}
        </>
      )}

      {/* Mobile Chat Drawer */}
      {isMobile && (
        <>
          {mobileChatOpen && (
            <div 
              className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[60] animate-in fade-in"
              onClick={() => setMobileChatOpen(false)}
            />
          )}
          <div className={`fixed inset-y-0 right-0 w-full max-w-[90%] md:max-w-[400px] bg-room-surface z-[70] shadow-2xl transition-transform duration-300 transform ${mobileChatOpen ? 'translate-x-0' : 'translate-x-full'}`}>
            <ChatSidebar roomId={roomId} onClose={() => setMobileChatOpen(false)} />
          </div>
        </>
      )}

      {/* Mobile Sheet Backdrop & Container handled via MobileBottomSheet component */}

      <div className="pointer-events-none fixed right-4 top-20 z-[90] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((toast) => (
          <button
            key={toast.toastId}
            type="button"
            onClick={() => {
              setToasts((prev) => prev.filter((item) => item.toastId !== toast.toastId));
              if (toast.type === 'chat:message' || toast.type === 'mention') {
                if (isMobile) setMobileChatOpen(true);
                else if (chatSidebarCollapsed) toggleChatSidebar();
                clearUnread();
              }
            }}
            className="pointer-events-auto w-full rounded-lg border border-room-border bg-room-surface/95 px-4 py-3 text-left shadow-2xl shadow-black/30 backdrop-blur transition hover:bg-room-hover"
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
                {toast.body && (
                  <span className="mt-0.5 block line-clamp-2 text-xs text-room-muted">{toast.body}</span>
                )}
              </span>
            </div>
          </button>
        ))}
      </div>

      {showPicker && (
        <GooglePicker
          driveToken={driveToken}
          onRequestAccess={requestDriveAccess}
          onSelect={handlePDFSelect}
          onClose={() => setShowPicker(false)}
          mode={libraryId && channelId ? 'add' : 'replace'}
        />
      )}
    </div>
  );
}

// ── Secondary Viewer Section ───────────────────────────────────────────────────

const SecondaryViewerSection = React.memo(({ 
  viewer, 
  driveToken, 
  requestDriveAccess, 
  onClose, 
  onStateChange 
}: { 
  viewer: OpenViewer; 
  driveToken: string | null; 
  requestDriveAccess: () => void; 
  onClose: () => void;
  onStateChange: (key: string, patch: Partial<PDFViewerState>) => void;
}) => {
  const handleStateChange = useCallback((patch: Partial<PDFViewerState>) => {
    onStateChange(viewer.key, patch);
  }, [onStateChange, viewer.key]);

  return (
    <section className="min-h-0 flex flex-col overflow-hidden rounded-lg border border-room-border bg-room-bg">
      <div className="flex-none flex items-center justify-between gap-3 px-3 py-2 border-b border-room-border bg-room-surface">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-room-text">{viewer.title}</p>
          <p className="text-[10px] text-room-muted">
            {viewer.followUserId ? 'Synced follow viewer' : 'Secondary viewer'}
          </p>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg text-room-muted hover:text-room-text hover:bg-room-hover"
          title="Close viewer"
        >
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 min-h-0">
        <PDFViewer
          pdf={viewer.pdf}
          accessToken={viewer.pdf.url ? null : driveToken}
          onRetry={viewer.pdf.url ? () => {} : requestDriveAccess}
          viewerState={viewer.state}
          onViewerStateChange={handleStateChange}
          followModeOverride={Boolean(viewer.followUserId)}
        />
      </div>
    </section>
  );
});

SecondaryViewerSection.displayName = 'SecondaryViewerSection';
