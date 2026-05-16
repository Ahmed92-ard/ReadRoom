'use client';

import { useEffect, useRef } from 'react';
import { getSocket } from '@/lib/socket/client';
import { usePDFStore } from '@/store/pdfStore';
import { usePresenceStore } from '@/store/presenceStore';
import type { SyncPayload } from '@/types';

export function usePDFSync(
  roomId: string, 
  containerRef: React.RefObject<HTMLDivElement>,
  activePdfId?: string | null, 
  activePdfName?: string | null
) {
  const page = usePDFStore((s) => s.page);
  const scroll = usePDFStore((s) => s.scroll);
  const zoom = usePDFStore((s) => s.zoom);
  const setSyncState = usePDFStore((s) => s.setSyncState);
  const followMode = usePDFStore((s) => s.followMode);
  const followTarget = usePDFStore((s) => s.followTarget);
  const self = usePresenceStore((s) => s.self);

  // Refs — keep current values available inside stable socket handlers
  const followRef = useRef(followMode);
  const targetRef = useRef(followTarget);
  const selfRef = useRef(self);
  const roomIdRef = useRef(roomId);
  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const presenceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Track the timestamp of the last remote update to ignore side-effects (echos)
  const lastRemoteUpdateTs = useRef(0);

  // Keep refs in sync with latest values on every render
  followRef.current = followMode;
  targetRef.current = followTarget;
  selfRef.current = self;
  roomIdRef.current = roomId;

  // ── Emit sync:state on local navigation ────────────────────────────────────
  useEffect(() => {
    if (!self) return;

    // Skip if a remote update just happened (prevent echo)
    if (Date.now() - lastRemoteUpdateTs.current < 200) {
      return;
    }

    // We always broadcast our main workspace position to others
    // unless we're currently applying a remote update to it.

    const socket = getSocket();
    if (throttleRef.current) clearTimeout(throttleRef.current);
    throttleRef.current = setTimeout(() => {
      // Page-relative scroll for cross-device stability
      let pageOffset = scroll;
      const container = containerRef.current;
      const pageEl = container?.querySelector(`[data-page="${page}"]`);
      if (container && pageEl) {
        const cRect = container.getBoundingClientRect();
        const pRect = pageEl.getBoundingClientRect();
        pageOffset = Math.max(0, Math.min(1, (cRect.top - pRect.top) / pRect.height));
      }

      if (!socket.connected) return;

      console.log(`[usePDFSync] Emitting sync:state for room ${roomId} (page: ${page}, scroll: ${pageOffset})`);
      socket.emit('sync:state', {
        roomId,
        userId: self.userId,
        activePdfId: activePdfId ?? null,
        activePdfName: activePdfName ?? null,
        page,
        scroll: pageOffset,
        zoom,
        ts: Date.now(),
      } satisfies SyncPayload);
    }, 150);

    return () => {
      if (throttleRef.current) clearTimeout(throttleRef.current);
    };
  }, [roomId, activePdfId, activePdfName, page, scroll, zoom, self, followMode]);

  // ── Emit presence:update when PDF state changes ────────────────────────────
  useEffect(() => {
    if (!self) return;
    const socket = getSocket();

    if (presenceRef.current) clearTimeout(presenceRef.current);
    presenceRef.current = setTimeout(() => {
      if (!socket.connected) return;
      socket.emit('presence:update', {
        roomId,
        user: {
          userId: self.userId,
          page,
          scroll,
          zoom,
          activePdfId: activePdfId ?? null,
          activePdfName: activePdfName ?? null,
          isActive: true,
          lastSeen: Date.now(),
        },
      });
    }, 500);

    return () => {
      if (presenceRef.current) clearTimeout(presenceRef.current);
    };
  }, [roomId, activePdfId, activePdfName, page, scroll, zoom, self]);

}
