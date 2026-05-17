// components/pdf/PDFViewer.tsx
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ZoomIn, ZoomOut, ChevronLeft, ChevronRight, Maximize2, Minimize2, RotateCw, MessageSquare, X } from 'lucide-react';
import { useShallow } from 'zustand/react/shallow';
import { usePDFStore } from '@/store/pdfStore';
import { VirtualizedPages } from './VirtualizedPages';
import { Chat } from '@/components/room/Chat';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { PDFMeta } from '@/types';

interface PDFViewerProps {
  pdf: PDFMeta;
  accessToken?: string | null;
  onRetry?: () => void;
  viewerState?: Partial<PDFViewerState>;
  onViewerStateChange?: (patch: Partial<PDFViewerState>) => void;
  onVisibleRangeChange?: (range: { start: number; end: number }) => void;
  followModeOverride?: boolean;
  externalContainerRef?: React.RefObject<HTMLDivElement>;
  roomId?: string;
}

export interface PDFViewerState {
  page: number;
  scroll: number;
  zoom: number;
  rotation: number;
  totalPages: number;
  loadState: 'idle' | 'loading' | 'ready' | 'error';
}

const ZOOM_STEP = 0.25;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3.0;

// Lazily initialize PDF.js worker once
async function loadPDFWorker() {
  const pdfjs = await import('pdfjs-dist');
  if (!pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  }
  return pdfjs;
}

export function PDFViewer({ 
  pdf, 
  accessToken, 
  onRetry, 
  viewerState, 
  onViewerStateChange, 
  onVisibleRangeChange, 
  followModeOverride,
  externalContainerRef,
  roomId
}: PDFViewerProps) {
  const [fullscreenChatOpen, setFullscreenChatOpen] = useState(false);
  const store = usePDFStore(
    useShallow((s) => ({
      page: s.page,
      scroll: s.scroll,
      zoom: s.zoom,
      rotation: s.rotation,
      totalPages: s.totalPages,
      loadState: s.loadState,
      followMode: s.followMode,
      setPage: s.setPage,
      setZoom: s.setZoom,
      rotate: s.rotate,
      setLoadState: s.setLoadState,
      setTotalPages: s.setTotalPages,
      setScroll: s.setScroll,
      setFollowMode: s.setFollowMode,
    }))
  );

  const [pdfDocument, setPDFDocument] = useState<PDFDocumentProxy | null>(null);
  const [localTotalPages, setLocalTotalPages] = useState(0);
  const [localLoadState, setLocalLoadState] = useState<PDFViewerState['loadState']>('idle');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  const localContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = externalContainerRef || localContainerRef;
  const viewerRef = useRef<HTMLDivElement>(null);
  const zoomDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [touchStartDist, setTouchStartDist] = useState<number | null>(null);
  const [baseZoom, setBaseZoom] = useState(1.0);
  const [inputPage, setInputPage] = useState(String(viewerState?.page ?? store.page));

  const [isFullscreen, setIsFullscreen] = useState(false);
  const lastLoadedKeyRef = useRef<string | null>(null);

  const controlled = Boolean(onViewerStateChange);
  const page = viewerState?.page ?? store.page;
  const scroll = viewerState?.scroll ?? store.scroll;
  const zoom = viewerState?.zoom ?? store.zoom;
  const rotation = viewerState?.rotation ?? store.rotation;
  const totalPages = controlled ? (viewerState?.totalPages ?? localTotalPages) : store.totalPages;
  const loadState = controlled ? (viewerState?.loadState ?? localLoadState) : store.loadState;
  const followMode = followModeOverride ?? store.followMode;

  const setPage = useCallback((nextPage: number) => {
    if (!controlled && store.followMode) store.setFollowMode(false);
    onViewerStateChange ? onViewerStateChange({ page: nextPage }) : store.setPage(nextPage);
  }, [controlled, onViewerStateChange, store.setPage, store.followMode, store.setFollowMode]);

  const setZoom = useCallback((nextZoom: number) => {
    // Zoom levels are strictly local and do not disable follow mode
    onViewerStateChange ? onViewerStateChange({ zoom: nextZoom }) : store.setZoom(nextZoom);
  }, [onViewerStateChange, store.setZoom]);

  const setScroll = useCallback((nextScroll: number) => {
    if (!controlled && store.followMode) store.setFollowMode(false);
    onViewerStateChange ? onViewerStateChange({ scroll: nextScroll }) : store.setScroll(nextScroll);
  }, [controlled, onViewerStateChange, store.setScroll, store.followMode, store.setFollowMode]);

  const setTotalPages = useCallback((nextTotalPages: number) => {
    setLocalTotalPages(nextTotalPages);
    onViewerStateChange ? onViewerStateChange({ totalPages: nextTotalPages }) : store.setTotalPages(nextTotalPages);
  }, [onViewerStateChange, store.setTotalPages]);

  const setLoadState = useCallback((nextLoadState: PDFViewerState['loadState']) => {
    setLocalLoadState(nextLoadState);
    onViewerStateChange ? onViewerStateChange({ loadState: nextLoadState }) : store.setLoadState(nextLoadState);
  }, [onViewerStateChange, store.setLoadState]);

  const rotate = useCallback(() => {
    const nextRotation = (rotation + 90) % 360;
    onViewerStateChange ? onViewerStateChange({ rotation: nextRotation }) : store.rotate();
  }, [onViewerStateChange, store.rotate, rotation]);

  useEffect(() => {
    setInputPage(page.toString());
  }, [page]);

  const handlePageJump = () => {
    const p = Number(inputPage.trim());
    if (Number.isInteger(p) && p >= 1 && p <= totalPages) {
      setPage(p);
    } else {
      setInputPage(page.toString());
    }
  };

  const toggleFullscreen = useCallback(() => {
    if (!viewerRef.current) return;

    if (!document.fullscreenElement) {
      viewerRef.current.requestFullscreen().catch((err) => {
        console.error(`Error attempting to enable fullscreen: ${err.message}`);
      });
    } else {
      document.exitFullscreen();
    }
  }, []);

  useEffect(() => {
    const handler = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);

  useEffect(() => {
    const handleOpen = () => {
      if (document.fullscreenElement) {
        setFullscreenChatOpen(true);
      }
    };
    window.addEventListener('open-fullscreen-chat', handleOpen);
    return () => {
      window.removeEventListener('open-fullscreen-chat', handleOpen);
    };
  }, []);

  // Load PDF document
  useEffect(() => {
    let cancelled = false;
    let loadingTask: any = null;

    async function load() {
      const loadKey = `${pdf.fileId || pdf.url}:${accessToken || ''}`;
      if (lastLoadedKeyRef.current === loadKey && loadState === 'ready') {
        console.log('[PDFViewer] Skipping redundant load', { filename: pdf.filename });
        return;
      }

      setLoadState('loading');
      setLoadError(null);
      setPDFDocument(null);

      const timeoutId = setTimeout(() => {
        if (!cancelled && loadState === 'loading') {
          console.error('[PDFViewer] Load timeout reached', { filename: pdf.filename });
          setLoadError('Loading took too long. Please try again.');
          setLoadState('error');
        }
      }, 30000); // 30s timeout

      try {
        const pdfjs = await loadPDFWorker();
        // All PDFs are served from Supabase Storage via the /file route.
        // pdf.url is always set for local uploads. Fall back to fileId as a
        // last resort (should not happen in normal operation).
        const url = pdf.url || `/api/pdf-fallback/${pdf.fileId}`;

        console.log('[PDFViewer] loading', {
          filename: pdf.filename,
          source: 'supabase-storage',
          url,
        });
        
        loadingTask = pdfjs.getDocument({
          url,
          httpHeaders: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
          cMapUrl: `https://unpkg.com/pdfjs-dist@${pdfjs.version}/cmaps/`,
          cMapPacked: true,
          disableRange: false,
          disableStream: false,
        });

        const doc = await loadingTask.promise;

        if (cancelled) {
          doc.destroy();
          clearTimeout(timeoutId);
          return;
        }

        clearTimeout(timeoutId);
        console.log(`[PDFViewer] PDF metadata received: ${doc.numPages} pages`);
        lastLoadedKeyRef.current = loadKey;
        setPDFDocument(doc);
        setTotalPages(doc.numPages);
        setLoadState('ready');
      } catch (err) {
        clearTimeout(timeoutId);
        const message = err instanceof Error ? err.message : String(err);
        console.error('[PDFViewer] Error loading PDF:', {
          filename: pdf.filename,
          url: pdf.url,
          error: err,
        });
        if (!cancelled) {
          setLoadError(message);
          setLoadState('error');
        }
      }
    }

    load();
    return () => { 
      cancelled = true; 
      if (loadingTask) {
        loadingTask.destroy().catch(() => {});
      }
    };
  }, [pdf.fileId, pdf.url, accessToken, setLoadState, setTotalPages, pdf.filename, retryNonce]);

  // Zoom controls
  const adjustZoom = useCallback((delta: number) => {
    const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom + delta));
    setZoom(next);
  }, [zoom, setZoom]);

  // Pinch-to-zoom (touch)
  const getTouchDistance = (e: React.TouchEvent) => {
    const [t1, t2] = [e.touches[0], e.touches[1]];
    return Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
  };

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      setTouchStartDist(getTouchDistance(e));
      setBaseZoom(zoom);
    }
  }, [zoom]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 2 && touchStartDist !== null) {
      const dist = getTouchDistance(e);
      const scale = dist / touchStartDist;
      const next = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, baseZoom * scale));
      if (zoomDebounceRef.current) clearTimeout(zoomDebounceRef.current);
      zoomDebounceRef.current = setTimeout(() => setZoom(next), 16);
    }
  }, [touchStartDist, baseZoom, setZoom]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    setTouchStartDist(null);
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        if (page < totalPages) setPage(page + 1);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        if (page > 1) setPage(page - 1);
      } else if (e.key === '+' || e.key === '=') {
        adjustZoom(ZOOM_STEP);
      } else if (e.key === '-') {
        adjustZoom(-ZOOM_STEP);
      } else if (e.key === 'f') {
        toggleFullscreen();
      } else if (e.key === 'r') {
        rotate();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [page, totalPages, setPage, adjustZoom, toggleFullscreen, rotate]);

  return (
    <div ref={viewerRef} className="relative flex flex-col h-full bg-room-bg overflow-hidden">
      {/* Toolbar */}
      <div className="flex-none flex items-center justify-between px-2 md:px-4 py-1.5 md:py-2 border-b border-room-border bg-room-surface/80 backdrop-blur-sm z-10">
        {/* Page navigation */}
        <div className="flex items-center gap-1 md:gap-2">
          <button
            onClick={() => setPage(Math.max(1, page - 1))}
            disabled={page <= 1 || loadState !== 'ready'}
            className="p-2 md:p-2.5 rounded-xl text-room-muted hover:text-room-text hover:bg-room-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors min-w-[40px] min-h-[40px] md:min-w-[48px] md:min-h-[48px] flex items-center justify-center"
            aria-label="Previous page"
          >
            <ChevronLeft size={18} />
          </button>

          <div className="flex items-center gap-1.5 px-2 py-1 bg-room-bg/50 rounded-lg border border-room-border">
            <input
              type="text"
              value={loadState === 'ready' ? inputPage : '—'}
              disabled={loadState !== 'ready'}
              onChange={(e) => setInputPage(e.target.value)}
              onBlur={handlePageJump}
              onKeyDown={(e) => e.key === 'Enter' && handlePageJump()}
              className="w-8 md:w-10 bg-transparent text-center text-xs md:text-sm text-room-text focus:outline-none font-mono"
            />
            <span className="text-[10px] md:text-xs text-room-muted">/</span>
            <span className="text-xs md:text-sm text-room-muted min-w-[12px] font-mono">{totalPages || '—'}</span>
          </div>

          <button
            onClick={() => setPage(Math.min(totalPages, page + 1))}
            disabled={page >= totalPages || loadState !== 'ready'}
            className="p-2 md:p-2.5 rounded-xl text-room-muted hover:text-room-text hover:bg-room-hover disabled:opacity-30 disabled:cursor-not-allowed transition-colors min-w-[40px] min-h-[40px] md:min-w-[48px] md:min-h-[48px] flex items-center justify-center"
            aria-label="Next page"
          >
            <ChevronRight size={18} />
          </button>
        </div>

        {/* PDF filename - hidden on mobile */}
        <p className="hidden lg:block text-xs text-room-muted truncate max-w-[180px] xl:max-w-[300px]">
          {pdf.filename}
        </p>

        {/* Zoom controls + follow mode */}
        <div className="flex items-center gap-1.5 md:gap-2">
          {/* Rotate Button */}
          <button
            onClick={rotate}
            disabled={loadState !== 'ready'}
            className="p-2 md:p-2.5 rounded-xl text-room-muted hover:text-room-text hover:bg-room-hover disabled:opacity-30 transition-colors flex items-center justify-center"
            aria-label="Rotate PDF"
            title="Rotate PDF (R)"
          >
            <RotateCw size={18} />
          </button>

          {/* Fullscreen Button */}
          <button
            onClick={toggleFullscreen}
            className="p-2 md:p-2.5 rounded-xl text-room-muted hover:text-room-text hover:bg-room-hover transition-colors flex items-center justify-center"
            aria-label={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
            title={isFullscreen ? "Exit Fullscreen (F)" : "Enter Fullscreen (F)"}
          >
            {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
          </button>

          <div className="flex items-center gap-0.5 md:gap-1 bg-room-bg rounded-lg border border-room-border px-0.5 md:px-1">
            <button
              onClick={() => adjustZoom(-ZOOM_STEP)}
              disabled={zoom <= ZOOM_MIN}
              className="p-2 md:p-2.5 text-room-muted hover:text-room-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors min-w-[36px] min-h-[36px] md:min-w-[40px] md:min-h-[40px] flex items-center justify-center"
              aria-label="Zoom out"
            >
              <ZoomOut size={16} />
            </button>
            <span className="text-[10px] md:text-xs font-mono text-room-muted w-10 md:w-12 text-center">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => adjustZoom(ZOOM_STEP)}
              disabled={zoom >= ZOOM_MAX}
              className="p-2 md:p-2.5 text-room-muted hover:text-room-text disabled:opacity-30 disabled:cursor-not-allowed transition-colors min-w-[36px] min-h-[36px] md:min-w-[40px] md:min-h-[40px] flex items-center justify-center"
              aria-label="Zoom in"
            >
              <ZoomIn size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* PDF Canvas area */}
      <div
        ref={containerRef}
        data-pdf-container="true"
        className="flex-1 overflow-y-auto overflow-x-auto"
        style={{ transform: 'translate3d(0,0,0)', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {loadState === 'loading' && (
          <div className="flex flex-col items-center justify-center h-full gap-4 py-20">
            <div className="w-12 h-12 rounded-full border-4 border-room-border border-t-blue-400 animate-spin" />
            <p className="text-room-muted text-sm animate-pulse">Loading {pdf.filename}…</p>
          </div>
        )}

        {loadState === 'error' && (
          <div className="flex flex-col items-center justify-center h-full gap-4 py-20 text-center px-8 max-w-md mx-auto">
            <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center text-3xl mb-2">
              ⚠️
            </div>
            <div>
              <p className="text-room-text font-bold text-lg mb-1">Failed to load PDF</p>
              <p className="text-room-muted text-sm leading-relaxed">
                The PDF file could not be loaded. Try refreshing the page or ask a room member to re-upload the file.
              </p>
              {loadError && (
                <p className="mt-2 text-[11px] text-room-muted/80 break-words">
                  {loadError}
                </p>
              )}
            </div>
            {onRetry && (
              <button
                onClick={() => {
                  onRetry();
                  setRetryNonce((nonce) => nonce + 1);
                }}
                className="mt-2 flex items-center gap-2 px-6 py-2.5 rounded-xl bg-blue-600 text-white font-medium hover:bg-blue-500 transition-all shadow-lg shadow-blue-600/20 active:scale-95"
              >
                {pdf.url ? 'Retry Loading' : 'Re-authorize & Retry'}
              </button>
            )}
          </div>
        )}

        {loadState === 'ready' && pdfDocument && (
          <VirtualizedPages
            pdfDocument={pdfDocument}
            containerRef={containerRef}
            page={controlled ? page : undefined}
            scroll={controlled ? scroll : undefined}
            zoom={controlled ? zoom : undefined}
            rotation={controlled ? rotation : undefined}
            followMode={followMode}
            onPageChange={controlled ? setPage : undefined}
            onScrollChange={controlled ? setScroll : undefined}
            onTotalPagesChange={controlled ? setTotalPages : undefined}
            onVisibleRangeChange={onVisibleRangeChange}
          />
        )}
      </div>

      {isFullscreen && roomId && (
        <div className="absolute bottom-6 right-6 z-50 flex flex-col items-end gap-2 pointer-events-none">
          {/* Floating Chat Overlay Drawer */}
          {fullscreenChatOpen && (
            <div className="w-[360px] h-[520px] max-w-[calc(100vw-32px)] max-h-[calc(100vh-100px)] rounded-2xl border border-room-border/60 bg-room-surface/96 backdrop-blur-3xl shadow-2xl pointer-events-auto flex flex-col overflow-hidden transition-all duration-300 transform scale-100 origin-bottom-right">
              <div className="flex-none flex items-center justify-between px-3 py-2 border-b border-room-border bg-black/10 dark:bg-black/25">
                <span className="text-xs font-semibold text-room-text">Room Chat (Fullscreen)</span>
                <button 
                  onClick={() => setFullscreenChatOpen(false)}
                  className="p-1 rounded-lg text-room-muted hover:text-room-text hover:bg-room-hover"
                >
                  <X size={16} />
                </button>
              </div>
              <div className="flex-1 min-h-0">
                {typeof window !== 'undefined' && <Chat roomId={roomId} onClose={() => setFullscreenChatOpen(false)} />}
              </div>
            </div>
          )}

          {/* Floating Chat Toggle Button */}
          <button
            onClick={() => setFullscreenChatOpen(!fullscreenChatOpen)}
            className="pointer-events-auto flex items-center justify-center w-11 h-11 rounded-full bg-blue-600 hover:bg-blue-500 text-white shadow-lg transition-transform hover:scale-105 active:scale-95 z-50 animate-in fade-in zoom-in duration-200"
            title="Toggle Fullscreen Chat"
          >
            <MessageSquare size={19} />
          </button>
        </div>
      )}
    </div>
  );
}
