'use client';

import { useEffect, useMemo, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePresenceStore } from '@/store/presenceStore';
import { stringToColor, makeInitials } from '@/lib/utils/avatar';
import { CallOverlay } from '@/components/room/CallOverlay';
import type { UserMeta } from '@/types';

function makeStableTabId(userId: string) {
  const key = '__readroom_tab_id__';
  if (typeof window === 'undefined') return userId;
  let tabId = sessionStorage.getItem(key);
  if (!tabId || !tabId.startsWith(userId)) {
    tabId = `${userId}_${Math.random().toString(36).slice(2, 6)}`;
    sessionStorage.setItem(key, tabId);
  }
  return tabId;
}

function roomIdFromPath(pathname: string | null) {
  const match = pathname?.match(/^\/libraries\/[^/]+\/channels\/([^/]+)/);
  return match?.[1] ?? 'global-chat';
}

export function AppServices() {
  const pathname = usePathname();
  const { user, userName, avatarUrl, loading } = useAuth();
  const setSelf = usePresenceStore((s) => s.setSelf);
  const updateSelf = usePresenceStore((s) => s.updateSelf);
  const tabIdRef = useRef<string | null>(null);

  const callRoomId = useMemo(() => roomIdFromPath(pathname), [pathname]);

  useEffect(() => {
    if (loading || !user?.id) return;
    if (!tabIdRef.current || !tabIdRef.current.startsWith(user.id)) {
      tabIdRef.current = makeStableTabId(user.id);
    }

    const tabId = tabIdRef.current;
    const storeSelf = usePresenceStore.getState().self;
    const baseId = storeSelf?.userId?.split('_')[0];
    const nextIdentity = {
      userName,
      avatarUrl,
      avatarColor: storeSelf?.avatarColor ?? stringToColor(tabId),
      avatarInitials: makeInitials(userName),
    };

    if (storeSelf && baseId === user.id) {
      updateSelf({
        ...nextIdentity,
        currentRoomId: callRoomId,
        currentRoomName: callRoomId === 'global-chat' ? 'Global Chat' : null,
      });
      return;
    }

    const self: UserMeta = {
      userId: tabId,
      ...nextIdentity,
      joinedAt: Date.now(),
      isFollowing: false,
      page: 1,
      scroll: 0,
      zoom: 1,
      activePdfId: null,
      activePdfName: null,
      activeLibraryId: null,
      currentRoomId: callRoomId,
      currentRoomName: callRoomId === 'global-chat' ? 'Global Chat' : null,
      isActive: true,
      isFocused: typeof document !== 'undefined' ? document.visibilityState === 'visible' && document.hasFocus() : true,
      lastSeen: Date.now(),
    };
    setSelf(self);
  }, [avatarUrl, callRoomId, loading, setSelf, updateSelf, user?.id, userName]);

  if (loading || !user?.id) return null;

  return (
    <CallOverlay
      roomId={callRoomId}
      userId={user.id}
      userName={userName}
    />
  );
}
