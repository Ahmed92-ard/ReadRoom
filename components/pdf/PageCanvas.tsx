// components/pdf/PageCanvas.tsx
'use client';

import React, { useEffect, useRef, useCallback, memo } from 'react';
import type { PDFPageProxy } from 'pdfjs-dist';

interface PageCanvasProps {
  page: PDFPageProxy;
  pageNumber: number;
  zoom: number;
  rotation: number;
  isVisible: boolean;
  onDimensionMeasured?: (pageNum: number, width: number, height: number) => void;
}

// Detect low-end device
const isLowEnd =
  typeof navigator !== 'undefined' &&
  (navigator.hardwareConcurrency <= 2 || (navigator as any).deviceMemory <= 2);

const MAX_DPR = isLowEnd ? 1.5 : 2;

export const PageCanvas = memo(function PageCanvas({
  page,
  pageNumber,
  zoom,
  rotation,
  isVisible,
  onDimensionMeasured,
}: PageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const renderTaskRef = useRef<any>(null);

  const render = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas || !isVisible) return;

    // Cancel any in-flight render
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }

    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const viewport = page.getViewport({ scale: zoom * dpr, rotation });

    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.style.width = `${viewport.width / dpr}px`;
    canvas.style.height = `${viewport.height / dpr}px`;

    // Cache dimensions for virtualizer
    const cssWidth = viewport.width / dpr;
    const cssHeight = viewport.height / dpr;
    onDimensionMeasured?.(pageNumber, cssWidth, cssHeight);

    const renderContext = {
      canvasContext: ctx,
      viewport,
      intent: isLowEnd ? 'print' : 'display',
    };

    try {
      renderTaskRef.current = page.render(renderContext);
      await renderTaskRef.current.promise;
    } catch (err: any) {
      if (err?.name !== 'RenderingCancelledException') {
        console.error(`Page ${pageNumber} render error:`, err);
      }
    }
  }, [page, pageNumber, zoom, rotation, isVisible, onDimensionMeasured]);

  useEffect(() => {
    render();
    return () => {
      renderTaskRef.current?.cancel();
    };
  }, [render]);

  return (
    <canvas
      ref={canvasRef}
      className="block mx-auto shadow-lg rounded-sm"
      style={{ transform: 'translate3d(0,0,0)' }}
      aria-label={`Page ${pageNumber}`}
    />
  );
});

