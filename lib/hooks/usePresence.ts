'use client';

import { useEffect, useRef } from 'react';
import { getSocket } from '@/lib/socket/client';
import { usePresenceStore } from '@/store/presenceStore';
import { usePDFStore } from '@/store/pdfStore';
import type { UserMeta } from '@/types';

// Generate a stable per-tab ID (survives re-renders, not re-mounts)
// This is critical to allow multiple tabs of the same user to sync with each other.
function makeTabId(userId: string) {
  const key = '__readroom_tab_id__';
  if (typeof sessionStorage === 'undefined') return userId;
  let tabId = sessionStorage.getItem(key);
  if (!tabId || !tabId.startsWith(userId)) {
    tabId = `${userId}_${Math.random().toString(36).slice(2, 6)}`;
    sessionStorage.setItem(key, tabId);
  }
  return tabId;
}

function makeInitials(name: string) {
  const initials = name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
  return initials || (name === 'Reader' ? 'RD' : name.slice(0, 2).toUpperCase() || 'RD');
}

export function usePresence(
  roomId: string,
  serverId: string | null,
  userId: string,
  userName: string,
  activePdfId: string | null = null,
  activePdfName: string | null = null
) {
  const { setSelf, updateSelf, addUser, updateUser, setMembers, setConnectionStatus } = usePresenceStore();
  const tabId = useRef(makeTabId(userId)).current;
  const activePdfIdRef = useRef(activePdfId);
  const activePdfNameRef = useRef(activePdfName);

  activePdfIdRef.current = activePdfId;
  activePdfNameRef.current = activePdfName;

  // Fetch all server members on mount to show offline users
  useEffect(() => {
    if (!serverId) return;

    fetch(`/api/servers/${serverId}/members`)
      .then(res => res.json())
      .then(data => {
        if (data.members) {
          const members: UserMeta[] = data.members.map((m: any) => ({
            userId: m.user_id, // Note: real-time uses tabId, persistent uses user_id. We'll merge them.
            userName: m.users.display_name || m.users.email?.split('@')[0] || 'Reader',
            avatarColor: stringToColor(m.user_id),
            avatarInitials: makeInitials(m.users.display_name || m.users.email || 'Reader'),
            joinedAt: new Date(m.joined_at).getTime(),
            isFollowing: false,
            page: 1,
            scroll: 0,
            zoom: 1,
            activePdfId: null,
            activePdfName: null,
            isActive: false, // Default to offline until presence list arrives
            lastSeen: Date.now(), // Fallback
          }));
          setMembers(members);
        }
      })
      .catch(err => console.error('[presence] failed to fetch members', err));
  }, [serverId, setMembers]);

  // Initial join
  useEffect(() => {
    const socket = getSocket();
    if (!socket.connected) socket.connect();

    const buildSelf = (): UserMeta => ({
      userId: tabId,
      userName,
      avatarColor: stringToColor(tabId),
      avatarInitials: makeInitials(userName),
      joinedAt: Date.now(),
      isFollowing: false,
      page: usePDFStore.getState().page,
      scroll: usePDFStore.getState().scroll,
      zoom: usePDFStore.getState().zoom,
      activePdfId: activePdfIdRef.current,
      activePdfName: activePdfNameRef.current,
      isActive: true,
      lastSeen: Date.now(),
    });

    const self = buildSelf();
    setSelf(self);

    const joinRoom = () => {
      const currentSelf = buildSelf();
      setSelf(currentSelf);
      console.log('[presence] joining room', roomId);
      socket.emit('room:join', { roomId, user: currentSelf });
      setConnectionStatus('connected');
    };

    if (socket.connected) {
      joinRoom();
    }

    const pingInterval = setInterval(() => {
      socket.emit('presence:ping', { roomId, userId: tabId });
    }, 15_000);

    const handlePresenceList = (users: UserMeta[]) => {
      users.forEach((user) => {
        if (user.userId !== tabId) {
          addUser({ ...user, isActive: true });
          // Remove from offline cache if they're now active
          try {
            const stored = localStorage.getItem(`presence:offline:${roomId}`);
            if (stored) {
              const offline: UserMeta[] = JSON.parse(stored);
              const filtered = offline.filter((u) => u.userId !== user.userId);
              localStorage.setItem(`presence:offline:${roomId}`, JSON.stringify(filtered));
            }
          } catch {}
        }
      });
    };

    const handlePresenceJoin = (user: UserMeta) => {
      if (user.userId === tabId) return;
      addUser({ ...user, isActive: true });
      // Remove from offline cache — they're back
      try {
        const stored = localStorage.getItem(`presence:offline:${roomId}`);
        if (stored) {
          const offline: UserMeta[] = JSON.parse(stored);
          const filtered = offline.filter((u) => u.userId !== user.userId);
          localStorage.setItem(`presence:offline:${roomId}`, JSON.stringify(filtered));
        }
      } catch {}
    };

    const handlePresenceUpdate = (user: UserMeta) => {
      if (user.userId === tabId) return;
      updateUser(user.userId, user);
    };

    const handlePresenceLeft = ({ userId: uid }: { userId: string }) => {
      const lastSeen = Date.now();
      // Mark offline in store
      updateUser(uid, { isActive: false, lastSeen });
      // Persist to localStorage so it survives reload
      try {
        const stored = localStorage.getItem(`presence:offline:${roomId}`);
        const offline: UserMeta[] = stored ? JSON.parse(stored) : [];
        const existing = usePresenceStore.getState().users.get(uid);
        if (existing) {
          const updated = { ...existing, isActive: false, lastSeen };
          const filtered = offline.filter((u) => u.userId !== uid);
          localStorage.setItem(`presence:offline:${roomId}`, JSON.stringify([...filtered, updated]));
        }
      } catch {}
    };

    // Re-join room on reconnect
    const handleConnect = () => {
      console.log('[presence] reconnected — rejoining room', roomId);
      joinRoom();
    };
    const handleDisconnect = () => setConnectionStatus('disconnected');
    const handleConnectError = () => setConnectionStatus('error');

    socket.on('presence:list', handlePresenceList);
    socket.on('presence:join', handlePresenceJoin);
    socket.on('presence:update', handlePresenceUpdate);
    socket.on('presence:left', handlePresenceLeft);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);

    return () => {
      socket.emit('room:leave', { roomId, userId: tabId });
      socket.off('presence:list', handlePresenceList);
      socket.off('presence:join', handlePresenceJoin);
      socket.off('presence:update', handlePresenceUpdate);
      socket.off('presence:left', handlePresenceLeft);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
      clearInterval(pingInterval);
    };
  }, [roomId, tabId, userName, addUser, setSelf, setConnectionStatus, updateUser]);

  // Track PDF state changes and update self + emit presence updates
  useEffect(() => {
    let prev = {
      page: usePDFStore.getState().page,
      scroll: usePDFStore.getState().scroll,
      zoom: usePDFStore.getState().zoom,
      activePdfId: usePresenceStore.getState().self?.activePdfId ?? null,
      activePdfName: usePresenceStore.getState().self?.activePdfName ?? null,
    };

    let throttleTimer: ReturnType<typeof setTimeout> | null = null;

    const unsubscribe = usePDFStore.subscribe((state) => {
      const selfNow = usePresenceStore.getState().self;
      const current = {
        page: state.page,
        scroll: state.scroll,
        zoom: state.zoom,
        activePdfId: selfNow?.activePdfId ?? null,
        activePdfName: selfNow?.activePdfName ?? null,
      };
      if (
        current.page === prev.page &&
        Math.abs(current.scroll - prev.scroll) < 0.001 &&
        current.zoom === prev.zoom &&
        current.activePdfId === prev.activePdfId &&
        current.activePdfName === prev.activePdfName
      ) return;
      prev = current;

      const self = selfNow;
      if (!self) return;

      // Update local self immediately
      const patch = {
        page: current.page,
        scroll: current.scroll,
        zoom: current.zoom,
        activePdfId: current.activePdfId,
        activePdfName: current.activePdfName,
        isActive: true,
        lastSeen: Date.now(),
      };
      updateSelf(patch);

      // Throttle network emission
      if (throttleTimer) clearTimeout(throttleTimer);
      throttleTimer = setTimeout(() => {
        const socket = getSocket();
        if (socket.connected) {
          socket.emit('presence:update', {
            roomId,
            user: {
              ...self,
              ...patch,
            },
          });
        }
      }, 500); // 500ms throttle for presence (lower priority than sync:state)
    });

    return () => {
      unsubscribe();
      if (throttleTimer) clearTimeout(throttleTimer);
    };
  }, [roomId, tabId, updateSelf]);

  // Track visibility changes for active/inactive state
  useEffect(() => {
    const handleVisibility = () => {
      const self = usePresenceStore.getState().self;
      if (!self) return;

      const isActive = document.visibilityState === 'visible';
      const lastSeen = Date.now();
      updateSelf({ isActive, lastSeen });

      const socket = getSocket();
      socket.emit('presence:update', {
        roomId,
        user: {
          ...self,
          isActive,
          lastSeen,
        },
      });
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [roomId, tabId, updateSelf]);
  // Handle userName resolution after initial join (fixes "Reader" fallback race condition)
  useEffect(() => {
    const self = usePresenceStore.getState().self;
    if (!self || userName === 'Reader' || self.userName !== 'Reader') return;

    console.log('[presence] userName resolved, updating self:', userName);
    const patch = {
      userName,
      avatarInitials: makeInitials(userName),
    };
    updateSelf(patch);

    const socket = getSocket();
    socket.emit('presence:update', {
      roomId,
      user: {
        ...self,
        ...patch,
      },
    });
  }, [roomId, userName, updateSelf]);

  // Sync name changes from other tabs (e.g. Settings page)
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'readroom_user_name' && e.newValue) {
        const self = usePresenceStore.getState().self;
        if (!self) return;

        console.log('[presence] name changed in another tab:', e.newValue);
        const patch = {
          userName: e.newValue,
          avatarInitials: makeInitials(e.newValue),
        };
        updateSelf(patch);

        const socket = getSocket();
        socket.emit('presence:update', {
          roomId,
          user: {
            ...self,
            ...patch,
          },
        });
      }
    };

    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [roomId, updateSelf]);
}

function stringToColor(str: string): string {
  const colors = [
    '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e',
    '#f97316', '#eab308', '#22c55e', '#14b8a6',
    '#3b82f6', '#06b6d4',
  ];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}
