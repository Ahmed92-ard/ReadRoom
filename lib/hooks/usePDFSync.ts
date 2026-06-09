'use client';

import { useEffect, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { usePDFStore } from '@/store/pdfStore';
import { usePresenceStore } from '@/store/presenceStore';
import type { SyncPayload } from '@/types';

export function usePDFSync(
  roomId: string,
  containerRef: React.RefObject<HTMLDivElement>,
  activePdfId?: string | null,
  activePdfName?: string | null,
  pageOverride?: number,
  scrollOverride?: number,
  topPaneKey?: string | null,
  libraryId?: string | null
) {
  const pageFromStore = usePDFStore((s) => s.page);
  const scrollFromStore = usePDFStore((s) => s.scroll);

  const page = pageOverride !== undefined ? pageOverride : pageFromStore;
  const scroll = scrollOverride !== undefined ? scrollOverride : scrollFromStore;

  const zoom = usePDFStore((s) => s.zoom);
  const followMode = usePDFStore((s) => s.followMode);
  const self = usePresenceStore((s) => s.self);

  const followModeRef = useRef(followMode);
  const selfRef = useRef(self);
  const throttleRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const presenceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dbPersistRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastRemoteUpdateTs = useRef(0);

  followModeRef.current = followMode;
  selfRef.current = self;

  // ── Emit sync:state on local navigation ────────────────────────────────────
  useEffect(() => {
    if (!self || followMode) return;
    if (Date.now() - lastRemoteUpdateTs.current < 200) return;

    const supabase = createClient();
    // Re-use the room-broadcast channel — Supabase deduplicates under the hood
    const channel = supabase.channel(`room-broadcast:${roomId}`, {
      config: { broadcast: { self: false } },
    });
    channel.subscribe();

    if (throttleRef.current) clearTimeout(throttleRef.current);
    throttleRef.current = setTimeout(async () => {
      let pageOffset = scroll;
      const container = topPaneKey
        ? (document.querySelector(`[data-pane-key="${topPaneKey}"] [data-pdf-container="true"]`) as HTMLDivElement)
        : containerRef.current;
      const pageEl = container?.querySelector(`[data-page="${page}"]`);
      if (container && pageEl) {
        const cRect = container.getBoundingClientRect();
        const pRect = pageEl.getBoundingClientRect();
        pageOffset = Math.max(0, Math.min(1, (cRect.top - pRect.top) / pRect.height));
      }

      const payload: SyncPayload = {
        roomId,
        userId: self.userId,
        activePdfId: activePdfId ?? null,
        activePdfName: activePdfName ?? null,
        page,
        scroll: pageOffset,
        zoom,
        ts: Date.now(),
      };

      await channel.send({ type: 'broadcast', event: 'sync:state', payload });

      // Persist to DB (debounced 2s) so latecomers get the last known position
      if (dbPersistRef.current) clearTimeout(dbPersistRef.current);
      dbPersistRef.current = setTimeout(() => {
        const endpoint = libraryId
          ? `/api/libraries/${libraryId}/channels/${roomId}`
          : `/api/rooms/${roomId}`;
        fetch(endpoint, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ currentPage: page, scrollPct: pageOffset, zoom }),
        }).catch(() => {});
      }, 2000);
    }, 150);

    return () => {
      if (throttleRef.current) clearTimeout(throttleRef.current);
      supabase.removeChannel(channel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, activePdfId, activePdfName, page, scroll, zoom, self, followMode, topPaneKey, libraryId]);

  // ── Update local presence store with current PDF state (no emit — usePresence tracks) ───
  useEffect(() => {
    if (!self) return;
    if (presenceRef.current) clearTimeout(presenceRef.current);
    presenceRef.current = setTimeout(() => {
      usePresenceStore.getState().updateSelf({
        page,
        scroll,
        zoom,
        activePdfId: activePdfId ?? null,
        activePdfName: activePdfName ?? null,
        isActive: true,
        lastSeen: Date.now(),
      });
    }, 500);
    return () => { if (presenceRef.current) clearTimeout(presenceRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePdfId, activePdfName, page, scroll, zoom, self]);
}
