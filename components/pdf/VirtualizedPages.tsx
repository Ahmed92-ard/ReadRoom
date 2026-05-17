// components/pdf/VirtualizedPages.tsx
'use client';

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
} from 'react';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import { usePDFStore } from '@/store/pdfStore';
import { useShallow } from 'zustand/react/shallow';
import { PageCanvas } from './PageCanvas';

interface VirtualizedPagesProps {
  pdfDocument: PDFDocumentProxy;
  containerRef: React.RefObject<HTMLDivElement>;
  page?: number;
  scroll?: number;
  zoom?: number;
  rotation?: number;
  followMode?: boolean;
  onPageChange?: (page: number) => void;
  onScrollChange?: (scroll: number) => void;
  onTotalPagesChange?: (totalPages: number) => void;
  onVisibleRangeChange?: (range: { start: number; end: number }) => void;
}

const BUFFER_PAGES = isLowEndDevice() ? 1 : 3;
const PAGE_GAP = 16; // px between pages
const PAGE_CONTAINER_PADDING_TOP = 24; // matches py-6 on the page stack

function isLowEndDevice(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    (navigator.hardwareConcurrency <= 2 || (navigator as any).deviceMemory <= 2)
  );
}

// Placeholder for pages outside visible range
function PagePlaceholder({ width, height }: { width: number; height: number }) {
  return (
    <div
      className="mx-auto bg-room-surface/50 rounded-sm"
      style={{ width, height }}
      aria-hidden="true"
    />
  );
}

export function VirtualizedPages({
  pdfDocument,
  containerRef,
  page: controlledPage,
  scroll: controlledScroll,
  zoom: controlledZoom,
  rotation: controlledRotation,
  followMode: controlledFollowMode,
  onPageChange,
  onScrollChange,
  onTotalPagesChange,
  onVisibleRangeChange,
}: VirtualizedPagesProps) {
  const store =
    usePDFStore(
      useShallow((s) => ({
        page: s.page,
        zoom: s.zoom,
        rotation: s.rotation,
        setPage: s.setPage,
        setScroll: s.setScroll,
        setVisibleRange: s.setVisibleRange,
        setTotalPages: s.setTotalPages,
        followMode: s.followMode,
      }))
    );

  const controlled = controlledPage !== undefined;
  const page = controlledPage ?? store.page;
  const scroll = controlledScroll ?? 0;
  const zoom = controlledZoom ?? store.zoom;
  const rotation = controlledRotation ?? store.rotation;
  const followMode = controlledFollowMode ?? store.followMode;

  const setPage = useCallback((p: number) => {
    onPageChange ? onPageChange(p) : (!controlled && store.setPage(p));
  }, [onPageChange, store.setPage, controlled]);

  const setScroll = useCallback((s: number) => {
    onScrollChange ? onScrollChange(s) : (!controlled && store.setScroll(s));
  }, [onScrollChange, store.setScroll, controlled]);

  const setVisibleRange = useCallback((range: { start: number; end: number }) => {
    onVisibleRangeChange ? onVisibleRangeChange(range) : (!controlled && store.setVisibleRange(range));
  }, [onVisibleRangeChange, store.setVisibleRange, controlled]);

  const setTotalPages = useCallback((n: number) => {
    onTotalPagesChange ? onTotalPagesChange(n) : (!controlled && store.setTotalPages(n));
  }, [onTotalPagesChange, store.setTotalPages, controlled]);

  const totalPages = pdfDocument.numPages;

  const [loadedPages, setLoadedPages] = useState<Map<number, PDFPageProxy>>(new Map());
  const [visibleStart, setVisibleStart] = useState(1);
  const [visibleEnd, setVisibleEnd] = useState(Math.min(3, totalPages));
  const [pageDimensions, setPageDimensions] = useState<Map<number, { width: number; height: number }>>(new Map());

  const requestedPages = useRef<Set<number>>(new Set());
  useEffect(() => {
    requestedPages.current = new Set();
    setLoadedPages(new Map());
    setPageDimensions(new Map());
  }, [pdfDocument]);

  const handleDimensionMeasured = useCallback((pageNum: number, width: number, height: number) => {
    setPageDimensions((prev) => {
      const existing = prev.get(pageNum);
      if (existing?.width === width && existing?.height === height) return prev;
      const next = new Map(prev);
      next.set(pageNum, { width, height });
      return next;
    });
  }, []);

  const scrollThrottleRef = useRef<number>(0);
  const suppressScrollPageUntil = useRef(0);
  const pageSetFromScrollRef = useRef<number | null>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());
  const defaultPageHeight = 1056;

  // ── Programmatic-scroll guard ─────────────────────────────────────────────
  // Set to true whenever WE call scrollTo() so handleScroll ignores the
  // resulting scroll event and doesn't create a feedback loop.
  const isProgrammaticScrollRef = useRef(false);
  // Fix 3: track which page last triggered a programmatic scrollTo
  // so we can skip re-scrolling when pageHeights updates but page hasn't changed
  const lastScrolledPageRef = useRef<number | null>(null);
  // Fix 4: debounce follow-mode scrollTo to batch rapid page+scroll updates
  const followDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setTotalPages(totalPages);
  }, [totalPages, setTotalPages]);

  const renderRange = useMemo(() => {
    const minPage = Math.min(visibleStart, page);
    const maxPage = Math.max(visibleEnd, page);
    const start = Math.max(1, minPage - BUFFER_PAGES);
    const end = Math.min(totalPages, maxPage + BUFFER_PAGES);
    return { start, end };
  }, [visibleStart, visibleEnd, page, totalPages]);

  // Load pages in the current render window + buffer
  useEffect(() => {
    const start = renderRange.start;
    const end = renderRange.end;

    const toLoad: number[] = [];
    for (let i = start; i <= end; i++) {
      if (!requestedPages.current.has(i)) {
        requestedPages.current.add(i);
        toLoad.push(i);
      }
    }

    if (toLoad.length === 0) return;

    Promise.all(
      toLoad.map((n) => pdfDocument.getPage(n))
    ).then((pages) => {
      setLoadedPages((prev) => {
        const next = new Map(prev);
        toLoad.forEach((n, idx) => next.set(n, pages[idx]));
        return next;
      });
    });
  }, [renderRange.start, renderRange.end, totalPages, pdfDocument]);

  // Pre-fetch dimensions for all pages to ensure stable scrollbar structure
  useEffect(() => {
    if (!pdfDocument) return;
    let active = true;

    const fetchAllDimensions = async () => {
      const isLowEnd = isLowEndDevice();
      for (let i = 1; i <= totalPages; i += 20) {
        if (!active) break;

        const end = Math.min(i + 19, totalPages);
        const batch = [];
        for (let j = i; j <= end; j++) {
          if (!pageDimensions.has(j)) batch.push(j);
        }

        if (batch.length > 0) {
          try {
            const pages = await Promise.all(batch.map(n => pdfDocument.getPage(n)));
            if (!active) return;

            const nextDims = new Map();
            pages.forEach((p, idx) => {
              const viewport = p.getViewport({ scale: zoom, rotation });
              nextDims.set(batch[idx], { width: viewport.width, height: viewport.height });
            });

            setPageDimensions(prev => {
              const next = new Map(prev);
              nextDims.forEach((v, k) => next.set(k, v));
              return next;
            });
          } catch (e) {
            console.warn('[VirtualizedPages] pre-fetch failed for batch', i, e);
          }
        }
        await new Promise(r => setTimeout(r, isLowEnd ? 100 : 20));
      }
    };

    fetchAllDimensions();
    return () => { active = false; };
  }, [pdfDocument, totalPages, zoom, rotation]);

  // ── Scroll handler — throttled at rAF rate ────────────────────────────────
  const handleScroll = useCallback(() => {
    if (!containerRef.current) return;

    // Skip if this scroll event was triggered by our own programmatic scrollTo()
    // This is the key guard that prevents follow-mode feedback loops.
    if (isProgrammaticScrollRef.current) return;

    cancelAnimationFrame(scrollThrottleRef.current);
    scrollThrottleRef.current = requestAnimationFrame(() => {
      const container = containerRef.current!;
      const { scrollTop, scrollHeight, clientHeight } = container;

      // Compute visible page range (needed for rendering in all modes)
      const containerTop = container.getBoundingClientRect().top;
      let newVisibleStart = Number.POSITIVE_INFINITY;
      let newVisibleEnd = 1;
      let bestPage = page;
      let bestVisiblePixels = -1;

      pageRefs.current.forEach((el, pageNum) => {
        const rect = el.getBoundingClientRect();
        const relTop = rect.top - containerTop;
        const relBot = rect.bottom - containerTop;
        if (relBot >= 0 && relTop <= clientHeight) {
          const visiblePixels = Math.min(relBot, clientHeight) - Math.max(relTop, 0);
          if (pageNum < newVisibleStart) newVisibleStart = pageNum;
          if (pageNum > newVisibleEnd) newVisibleEnd = pageNum;
          if (visiblePixels > bestVisiblePixels) {
            bestVisiblePixels = visiblePixels;
            bestPage = pageNum;
          }
        }
      });

      if (!Number.isFinite(newVisibleStart)) {
        newVisibleStart = Math.max(1, Math.min(totalPages, page));
        newVisibleEnd = newVisibleStart;
        bestPage = newVisibleStart;
      }

      setVisibleStart(newVisibleStart);
      setVisibleEnd(newVisibleEnd);
      setVisibleRange({ start: newVisibleStart, end: newVisibleEnd });

      // Update local state which will then be emitted by usePDFSync (for main viewer)
      // or passed back to RoomShell (for secondary viewers).

      // Normal mode: update scroll + page state which feeds into usePDFSync
      const scrollable = scrollHeight - clientHeight;
      const pct = scrollable > 0 ? scrollTop / scrollable : 0;
      setScroll(parseFloat(pct.toFixed(4)));

      if (Date.now() > suppressScrollPageUntil.current) {
        pageSetFromScrollRef.current = bestPage;
        setPage(bestPage);
      }
    });
  }, [containerRef, followMode, page, setScroll, setPage, setVisibleRange, totalPages]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', handleScroll);
      cancelAnimationFrame(scrollThrottleRef.current);
    };
  }, [containerRef, handleScroll]);

  const pageHeights = useMemo(() => {
    return Array.from({ length: totalPages }, (_, i) => {
      const dim = pageDimensions.get(i + 1);
      return dim ? dim.height : defaultPageHeight * zoom;
    });
  }, [pageDimensions, totalPages, zoom]);

  // ── Scroll to page + fractional offset when state changes ─────────────────
  // Handles both normal page navigation and follow-mode sync.
  // In follow mode we also apply the fractional scroll offset so the follower
  // mirrors the leader's exact viewport position within the page.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !pdfDocument) return;
    const boundedPage = Math.max(1, Math.min(totalPages, page || 1));

    // Skip if this page change came FROM a scroll event we fired (not from sync)
    if (!followMode && pageSetFromScrollRef.current === boundedPage) {
      pageSetFromScrollRef.current = null;
      return;
    }

    // Fix 3: skip scrollTo if the page hasn't changed since the last scroll we did.
    // This prevents re-centering when pageHeights updates (dimensions load in) but
    // the user is already on the correct page — which caused upward scroll jumps.
    if (!followMode && lastScrolledPageRef.current === boundedPage) {
      return;
    }

    const doScroll = () => {
      const cont = containerRef.current;
      if (!cont) return;

      // Calculate absolute scroll target
      const pageTopOffset = PAGE_CONTAINER_PADDING_TOP + pageHeights
        .slice(0, boundedPage - 1)
        .reduce((sum, h) => sum + h + PAGE_GAP, 0);

      // In follow mode, also apply the fractional scroll position within the page
      // so the follower mirrors the leader's exact viewport, not just the page top.
      let targetScrollTop = pageTopOffset;
      if (followMode && scroll !== undefined) {
        const pageHeight = pageHeights[boundedPage - 1] ?? defaultPageHeight * zoom;
        targetScrollTop = pageTopOffset + scroll * pageHeight;
      }

      // Guard: suppress handleScroll re-entrancy during navigation
      if (!followMode) {
        suppressScrollPageUntil.current = Date.now() + 600;
      }

      lastScrolledPageRef.current = boundedPage;
      isProgrammaticScrollRef.current = true;
      cont.scrollTo({ top: targetScrollTop, behavior: followMode ? 'auto' : 'smooth' });

      if (followMode) {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            isProgrammaticScrollRef.current = false;
          });
        });
      } else {
        setTimeout(() => {
          isProgrammaticScrollRef.current = false;
        }, 400);
      }

      setVisibleStart(boundedPage);
      setVisibleEnd(boundedPage);
    };

    if (followMode) {
      // Fix 4: debounce follow-mode scroll by 50ms to batch rapid page+scroll updates
      // from the leader (page and controlledScroll arrive in separate store updates).
      if (followDebounceRef.current) clearTimeout(followDebounceRef.current);
      followDebounceRef.current = setTimeout(doScroll, 50);
    } else {
      doScroll();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, controlledScroll, followMode, pageHeights, pdfDocument, totalPages]);

  const topSpacerHeight = useMemo(() => {
    const omittedCount = renderRange.start - 1;
    if (omittedCount <= 0) return 0;
    const height = pageHeights.slice(0, omittedCount).reduce((sum, h) => sum + h, 0);
    return height + PAGE_GAP * omittedCount;
  }, [pageHeights, renderRange.start]);

  const bottomSpacerHeight = useMemo(() => {
    const omittedCount = totalPages - renderRange.end;
    if (omittedCount <= 0) return 0;
    const height = pageHeights.slice(renderRange.end).reduce((sum, h) => sum + h, 0);
    return height + PAGE_GAP * omittedCount;
  }, [pageHeights, renderRange.end, totalPages]);

  const renderedCount = renderRange.end - renderRange.start + 1;

  return (
    <div
      id={`pdf-container-${controlled ? 'controlled' : 'main'}`}
      className="relative flex flex-col items-center min-w-max py-6"
      style={{ transform: 'translate3d(0,0,0)' }}
    >
      {topSpacerHeight > 0 && (
        <div style={{ height: topSpacerHeight, width: '100%' }} aria-hidden="true" />
      )}

      {Array.from({ length: renderedCount }, (_, idx) => {
        const pageNum = renderRange.start + idx;
        const dim = pageDimensions.get(pageNum);
        const estWidth = dim ? dim.width : 612 * zoom;
        const estHeight = dim ? dim.height : defaultPageHeight * zoom;
        const loadedPage = loadedPages.get(pageNum);

        return (
          <div
            key={pageNum}
            ref={(el) => {
              if (el) pageRefs.current.set(pageNum, el);
              else pageRefs.current.delete(pageNum);
            }}
            style={{ width: estWidth, minHeight: estHeight, marginBottom: pageNum === renderRange.end ? 0 : PAGE_GAP }}
            data-page={pageNum}
          >
            {loadedPage ? (
              <PageCanvas
                page={loadedPage}
                pageNumber={pageNum}
                zoom={zoom}
                rotation={rotation}
                isVisible
                onDimensionMeasured={handleDimensionMeasured}
              />
            ) : (
              <PagePlaceholder width={estWidth} height={estHeight} />
            )}
          </div>
        );
      })}

      {bottomSpacerHeight > 0 && (
        <div style={{ height: bottomSpacerHeight, width: '100%' }} aria-hidden="true" />
      )}
    </div>
  );
}
