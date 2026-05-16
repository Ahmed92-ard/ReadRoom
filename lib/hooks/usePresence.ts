'use client';

// usePresence.ts — Manages real-time presence for a room.
// Profile data (name, avatar) is sourced from Supabase `users` table (canonical).
// The `profile:updated` socket event propagates profile changes to all connected users.

import { useEffect, useRef } from 'react';
import { getSocket } from '@/lib/socket/client';
import { createClient } from '@/lib/supabase/client';
import { usePresenceStore } from '@/store/presenceStore';
import { usePDFStore } from '@/store/pdfStore';
import { stringToColor, makeInitials } from '@/lib/utils/avatar';
import type { UserMeta } from '@/types';

// Generate a stable per-tab ID (survives re-renders, not re-mounts)
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

export function usePresence(
  roomId: string,
  libraryId: string | null,
  userId: string,
  userName: string,
  activePdfId: string | null = null,
  activePdfName: string | null = null
) {
  const { setSelf, updateSelf, addUser, updateUser, setMembers, setConnectionStatus } = usePresenceStore();
  const tabId = useRef(makeTabId(userId)).current;
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();
  const activePdfIdRef = useRef(activePdfId);
  const activePdfNameRef = useRef(activePdfName);
  const userNameRef = useRef(userName);

  activePdfIdRef.current = activePdfId;
  activePdfNameRef.current = activePdfName;
  userNameRef.current = userName;

  // ── Fetch all library members from Supabase (offline users) ──────────────
  useEffect(() => {
    if (!libraryId) return;

    fetch(`/api/libraries/${libraryId}/members`)
      .then((res) => res.json())
      .then((data) => {
        if (!data.members) return;
        const members: UserMeta[] = data.members.map((m: any) => ({
          userId: m.user_id,
          userName: m.users?.display_name || m.users?.email?.split('@')[0] || 'Reader',
          avatarColor: stringToColor(m.user_id),
          avatarInitials: makeInitials(m.users?.display_name || m.users?.email || 'Reader'),
          avatarUrl: m.users?.avatar_url ?? null,
          joinedAt: new Date(m.joined_at).getTime(),
          isFollowing: false,
          page: 1,
          scroll: 0,
          zoom: 1,
          activePdfId: null,
          activePdfName: null,
          isActive: false,
          lastSeen: Date.now(),
        }));
        setMembers(members);
      })
      .catch((err) => console.error('[presence] failed to fetch members:', err));
  }, [libraryId, setMembers]);

  // ── Supabase Realtime profile updates (settings page / other devices) ───
  useEffect(() => {
    const supabase = supabaseRef.current;
    if (!supabase) return;
    const channel = supabase
      .channel(`profiles:room:${roomId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'users',
      }, (payload) => {
        const updated = payload.new as any;
        const updatedUserId = updated?.id as string | undefined;
        if (!updatedUserId) return;

        const userName = updated.display_name || updated.email?.split('@')[0] || 'Reader';
        const patch = {
          userName,
          avatarUrl: updated.avatar_url ?? null,
          avatarColor: stringToColor(updatedUserId),
          avatarInitials: makeInitials(userName),
        };

        const store = usePresenceStore.getState();
        if (store.self?.userId.split('_')[0] === updatedUserId) {
          updateSelf(patch);
          try {
            if (updated.avatar_url) localStorage.setItem(`readroom_avatar_url_${updatedUserId}`, updated.avatar_url);
            else localStorage.removeItem(`readroom_avatar_url_${updatedUserId}`);
          } catch {}
        }

        store.users.forEach((u, uid) => {
          if (u.userId.split('_')[0] === updatedUserId) {
            updateUser(uid, patch);
          }
        });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [roomId, updateSelf, updateUser]);

  // ── Join room and subscribe to socket events ──────────────────────────────
  useEffect(() => {
    const socket = getSocket();
    if (!socket.connected) socket.connect();

    const buildSelf = (): UserMeta => {
      // Fast-path avatar cache is per user to avoid cross-account stale avatars.
      let avatarUrl: string | null = null;
      try { avatarUrl = localStorage.getItem(`readroom_avatar_url_${userId}`); } catch {}
      return {
        userId: tabId,
        userName: userNameRef.current,
        avatarColor: stringToColor(tabId),
        avatarInitials: makeInitials(userNameRef.current),
        avatarUrl,
        joinedAt: Date.now(),
        isFollowing: false,
        page: usePDFStore.getState().page,
        scroll: usePDFStore.getState().scroll,
        zoom: usePDFStore.getState().zoom,
        activePdfId: activePdfIdRef.current,
        activePdfName: activePdfNameRef.current,
        isActive: true,
        lastSeen: Date.now(),
      };
    };

    const joinRoom = () => {
      const currentSelf = buildSelf();
      setSelf(currentSelf);
      socket.emit('room:join', { roomId, user: currentSelf });
      setConnectionStatus('connected');
    };

    if (socket.connected) joinRoom();

    const pingInterval = setInterval(() => {
      socket.emit('presence:ping', { roomId, userId: tabId });
    }, 15_000);

    // ── Presence event handlers ───────────────────────────────────────────

    const handlePresenceList = (users: UserMeta[]) => {
      users.forEach((user) => {
        if (user.userId !== tabId) addUser({ ...user, isActive: true });
      });
    };

    const handlePresenceJoin = (user: UserMeta) => {
      if (user.userId === tabId) return;
      addUser({ ...user, isActive: true });
    };

    const handlePresenceUpdate = (user: UserMeta) => {
      if (user.userId === tabId) return;
      updateUser(user.userId, user);
    };

    const handlePresenceLeft = ({ userId: uid }: { userId: string }) => {
      updateUser(uid, { isActive: false, lastSeen: Date.now() });
    };

    // ── Profile update: propagate name/avatar changes to all users ────────
    const handleProfileUpdated = (payload: {
      userId: string;
      userName: string;
      avatarUrl: string | null;
      avatarColor: string;
      avatarInitials: string;
    }) => {
      const baseId = payload.userId.split('_')[0];
      // Update all presence entries for this user (they may have multiple tabs)
      const store = usePresenceStore.getState();
      store.users.forEach((u, uid) => {
        if (u.userId.startsWith(baseId)) {
          updateUser(uid, {
            userName: payload.userName,
            avatarUrl: payload.avatarUrl,
            avatarColor: payload.avatarColor,
            avatarInitials: payload.avatarInitials,
          });
        }
      });
      // Update self if it's our own profile update from another tab
      if (store.self?.userId.startsWith(baseId)) {
        updateSelf({
          userName: payload.userName,
          avatarUrl: payload.avatarUrl,
          avatarColor: payload.avatarColor,
          avatarInitials: payload.avatarInitials,
        });
      }
    };

    const handleConnect = () => {
      joinRoom();
    };
    const handleDisconnect = () => setConnectionStatus('disconnected');
    const handleConnectError = () => setConnectionStatus('error');

    socket.on('presence:list', handlePresenceList);
    socket.on('presence:join', handlePresenceJoin);
    socket.on('presence:update', handlePresenceUpdate);
    socket.on('presence:left', handlePresenceLeft);
    socket.on('profile:updated', handleProfileUpdated);
    socket.on('connect', handleConnect);
    socket.on('disconnect', handleDisconnect);
    socket.on('connect_error', handleConnectError);

    return () => {
      socket.emit('room:leave', { roomId, userId: tabId });
      socket.off('presence:list', handlePresenceList);
      socket.off('presence:join', handlePresenceJoin);
      socket.off('presence:update', handlePresenceUpdate);
      socket.off('presence:left', handlePresenceLeft);
      socket.off('profile:updated', handleProfileUpdated);
      socket.off('connect', handleConnect);
      socket.off('disconnect', handleDisconnect);
      socket.off('connect_error', handleConnectError);
      clearInterval(pingInterval);
    };
  }, [roomId, tabId, addUser, setSelf, setConnectionStatus, updateUser, updateSelf]);

  // ── Track PDF state changes → emit presence:update ───────────────────────
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

      if (!selfNow) return;
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

      if (throttleTimer) clearTimeout(throttleTimer);
      throttleTimer = setTimeout(() => {
        const socket = getSocket();
        if (socket.connected) {
          socket.emit('presence:update', { roomId, user: { ...selfNow, ...patch } });
        }
      }, 500);
    });

    return () => {
      unsubscribe();
      if (throttleTimer) clearTimeout(throttleTimer);
    };
  }, [roomId, tabId, updateSelf]);

  // ── Track visibility changes ──────────────────────────────────────────────
  useEffect(() => {
    const handleVisibility = () => {
      const self = usePresenceStore.getState().self;
      if (!self) return;
      const isActive = document.visibilityState === 'visible';
      const lastSeen = Date.now();
      updateSelf({ isActive, lastSeen });
      const socket = getSocket();
      socket.emit('presence:update', { roomId, user: { ...self, isActive, lastSeen } });
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [roomId, updateSelf]);

  // ── Resolve userName after initial join (fixes "Reader" race condition) ───
  useEffect(() => {
    const self = usePresenceStore.getState().self;
    if (!self || userName === 'Reader' || self.userName !== 'Reader') return;
    const patch = { userName, avatarInitials: makeInitials(userName) };
    updateSelf(patch);
    const socket = getSocket();
    socket.emit('presence:update', { roomId, user: { ...self, ...patch } });
  }, [roomId, userName, updateSelf]);

  // ── Sync name changes from other tabs (Settings page) ────────────────────
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key !== 'readroom_user_name' || !e.newValue) return;
      const self = usePresenceStore.getState().self;
      if (!self) return;
      const patch = { userName: e.newValue, avatarInitials: makeInitials(e.newValue) };
      updateSelf(patch);
      const socket = getSocket();
      socket.emit('presence:update', { roomId, user: { ...self, ...patch } });
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, [roomId, updateSelf]);
}
