'use client';

// usePresence.ts — Manages real-time presence for a room.
//
// Realtime subscription rule (Supabase):
//   ALL .on() handlers MUST be attached BEFORE .subscribe() is called.
//   Calling .subscribe() first and then .on() causes:
//   "cannot add postgres_changes callbacks after subscribe()"
//
// This file follows the correct pattern:
//   supabase.channel(name).on(...).on(...).subscribe()

import { useEffect, useRef } from 'react';
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

function presenceOnly(user: Partial<UserMeta>) {
  const { avatarUrl, ...rest } = user;
  return rest;
}

export function usePresence(
  roomId: string,
  libraryId: string | null,
  userId: string,
  userName: string,
  activePdfId: string | null = null,
  activePdfName: string | null = null,
  roomName: string | null = null
) {
  const { setSelf, updateSelf, addUser, updateUser, setMembers, setConnectionStatus } = usePresenceStore();

  // Stable tab ID — never changes for the lifetime of this tab
  const tabId = useRef(makeTabId(userId)).current;

  // Stable Supabase client — created once, never recreated
  const supabaseRef = useRef<ReturnType<typeof createClient> | null>(null);
  if (!supabaseRef.current) supabaseRef.current = createClient();

  // Reference to the active realtime channel
  const channelRef = useRef<any>(null);

  // Mutable refs for values that change but shouldn't re-trigger effects
  const activePdfIdRef = useRef(activePdfId);
  const activePdfNameRef = useRef(activePdfName);
  const roomNameRef = useRef(roomName);
  const userNameRef = useRef(userName);
  activePdfIdRef.current = activePdfId;
  activePdfNameRef.current = activePdfName;
  roomNameRef.current = roomName;
  userNameRef.current = userName;

  // ── Fetch library members (offline users) — runs once per libraryId ───────
  useEffect(() => {
    if (!libraryId) return;
    let cancelled = false;

    fetch(`/api/libraries/${libraryId}/members`)
      .then((res) => res.json())
      .then((data) => {
        if (cancelled || !data.members) return;
        const members: UserMeta[] = data.members.map((m: any) => ({
          userId: m.user_id,
          userName: m.users?.display_name || m.users?.email?.split('@')[0] || 'Reader',
          avatarColor: stringToColor(m.user_id),
          avatarInitials: makeInitials(m.users?.display_name || m.users?.email || 'Reader'),
          avatarUrl: m.users?.avatar_url ?? null,
          joinedAt: new Date(m.joined_at).getTime(),
          isFollowing: false,
          page: 1, scroll: 0, zoom: 1,
          activePdfId: null, activePdfName: null,
          activeLibraryId: libraryId,
          currentRoomId: null,
          currentRoomName: null,
          isActive: false, lastSeen: Date.now(),
        }));
        setMembers(members);
        const canonicalSelf = members.find((m) => m.userId === userId);
        if (canonicalSelf) {
          updateSelf({
            userName: canonicalSelf.userName,
            avatarUrl: canonicalSelf.avatarUrl,
            avatarColor: stringToColor(tabId),
            avatarInitials: canonicalSelf.avatarInitials,
          });
        }
      })
      .catch((err) => console.error('[presence] failed to fetch members:', err));

    return () => { cancelled = true; };
  }, [libraryId, setMembers, tabId, updateSelf, userId]);

  // ── Supabase Realtime: profile changes from other sessions/devices ────────
  // CRITICAL: .on() MUST be called BEFORE .subscribe()
  useEffect(() => {
    const supabase = supabaseRef.current;
    if (!supabase) return;

    // Use a channel name that is stable for the lifetime of this room session.
    // Including roomId prevents stale subscriptions from a previous room.
    const channelName = `presence-profiles:${roomId}`;

    const channel = supabase
      .channel(channelName)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'users' },
        (payload) => {
          const updated = payload.new as any;
          const updatedUserId = updated?.id as string | undefined;
          if (!updatedUserId) return;

          const name = updated.display_name || updated.email?.split('@')[0] || 'Reader';
          const patch = {
            userName: name,
            avatarUrl: updated.avatar_url ?? null,
            avatarColor: stringToColor(updatedUserId),
            avatarInitials: makeInitials(name),
          };

          const store = usePresenceStore.getState();

          // Update self if this is our own profile
          if (store.self?.userId.split('_')[0] === updatedUserId) {
            updateSelf(patch);
          }

          // Update any presence entries for this user
          store.users.forEach((u, uid) => {
            if (u.userId.split('_')[0] === updatedUserId) {
              updateUser(uid, patch);
            }
          });
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          // Channel is live
        } else if (status === 'CHANNEL_ERROR') {
          console.warn('[presence] realtime channel error for', channelName);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [roomId, updateSelf, updateUser]);

  // ── Supabase Realtime Presence Client connection ──────────────────────────
  useEffect(() => {
    const supabase = supabaseRef.current;
    if (!supabase) return;

    const buildSelf = (): UserMeta => {
      const existingSelf = usePresenceStore.getState().self;
      return {
        userId: tabId,
        userName: userNameRef.current,
        avatarColor: stringToColor(tabId),
        avatarInitials: makeInitials(userNameRef.current),
        avatarUrl: existingSelf?.avatarUrl ?? null,
        joinedAt: Date.now(),
        isFollowing: false,
        page: usePDFStore.getState().page,
        scroll: usePDFStore.getState().scroll,
        zoom: usePDFStore.getState().zoom,
        activePdfId: activePdfIdRef.current,
        activePdfName: activePdfNameRef.current,
        activeLibraryId: libraryId,
        currentRoomId: roomId,
        currentRoomName: roomNameRef.current,
        isActive: true,
        isFocused: typeof document !== 'undefined' ? (document.visibilityState === 'visible' && document.hasFocus()) : true,
        lastSeen: Date.now(),
      };
    };

    setConnectionStatus('disconnected');

    const channel = supabase.channel(`presence-room:${roomId}`, {
      config: {
        presence: {
          key: tabId,
        },
      },
    });

    channelRef.current = channel;

    // Attach presence sync handlers before subscribing
    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState();
        const onlineTabIds = new Set(Object.keys(state));

        // Add / Update online users
        Object.entries(state).forEach(([key, presences]) => {
          if (key === tabId) return; // skip self
          const p = presences[0] as any;
          if (p) {
            addUser({
              ...p,
              userId: key,
              isActive: true,
            });
          }
        });

        // Set users who have gone offline
        const store = usePresenceStore.getState();
        store.users.forEach((user, uid) => {
          if (user.isActive && !onlineTabIds.has(uid) && uid !== tabId) {
            updateUser(uid, { isActive: false, lastSeen: Date.now() });
          }
        });
      })
      .on('presence', { event: 'join' }, ({ key, newPresences }) => {
        if (key === tabId) return;
        const p = newPresences[0] as any;
        if (p) {
          addUser({ ...p, userId: key, isActive: true });
        }
      })
      .on('presence', { event: 'leave' }, ({ key }) => {
        if (key === tabId) return;
        updateUser(key, { isActive: false, lastSeen: Date.now() });
      })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          setConnectionStatus('connected');
          const currentSelf = buildSelf();
          setSelf(currentSelf);
          // Track our initial presence
          await channel.track(presenceOnly(currentSelf));
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setConnectionStatus('error');
        } else if (status === 'CLOSED') {
          setConnectionStatus('disconnected');
        }
      });

    return () => {
      setConnectionStatus('disconnected');
      supabase.removeChannel(channel);
      channelRef.current = null;
    };
  }, [roomId, libraryId, tabId, addUser, setSelf, setConnectionStatus, updateUser, updateSelf]);

  // ── PDF state → presence:update (throttled) ───────────────────────────────
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
        page: state.page, scroll: state.scroll, zoom: state.zoom,
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
        ...current,
        activeLibraryId: libraryId,
        currentRoomId: roomId,
        currentRoomName: roomNameRef.current,
        isActive: true,
        isFocused: typeof document !== 'undefined' ? (document.visibilityState === 'visible' && document.hasFocus()) : true,
        lastSeen: Date.now()
      };
      updateSelf(patch);

      if (throttleTimer) clearTimeout(throttleTimer);
      throttleTimer = setTimeout(async () => {
        if (channelRef.current) {
          await channelRef.current.track(presenceOnly({ ...selfNow, ...patch }));
        }
      }, 500);
    });

    return () => { unsubscribe(); if (throttleTimer) clearTimeout(throttleTimer); };
  }, [roomId, libraryId, updateSelf]);

  // Update library/room details when changed
  useEffect(() => {
    const self = usePresenceStore.getState().self;
    if (!self) return;
    const patch = {
      activeLibraryId: libraryId,
      currentRoomId: roomId,
      currentRoomName: roomName,
      isActive: true,
      isFocused: typeof document !== 'undefined' ? (document.visibilityState === 'visible' && document.hasFocus()) : true,
      lastSeen: Date.now(),
    };
    updateSelf(patch);
    if (channelRef.current) {
      channelRef.current.track(presenceOnly({ ...self, ...patch }));
    }
  }, [roomId, libraryId, roomName, updateSelf]);

  // ── Focus & Visibility change → isFocused & isActive + Redis heartbeat ─────
  useEffect(() => {
    // Fire-and-forget Redis write so push.ts can suppress notifications
    // for users who are actively focused on this library.
    const syncRedis = (isFocused: boolean) => {
      fetch('/api/presence/focus', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, libraryId, isFocused }),
      }).catch(() => {}); // never block the UI
    };

    const handle = () => {
      const self = usePresenceStore.getState().self;
      if (!self) return;
      const isActive = document.visibilityState === 'visible';
      const isFocused = isActive && document.hasFocus();
      const lastSeen = Date.now();
      const patch = {
        activeLibraryId: libraryId,
        currentRoomId: roomId,
        currentRoomName: roomNameRef.current,
        isActive,
        isFocused,
        lastSeen,
      };
      updateSelf(patch);
      if (channelRef.current) {
        channelRef.current.track(presenceOnly({ ...self, ...patch }));
      }
      syncRedis(isFocused);
    };

    document.addEventListener('visibilitychange', handle);
    window.addEventListener('focus', handle);
    window.addEventListener('blur', handle);

    // 30-second heartbeat — refreshes the 90s Redis TTL while focused.
    const heartbeat = setInterval(() => {
      const isActive = document.visibilityState === 'visible';
      const isFocused = isActive && document.hasFocus();
      if (isFocused) syncRedis(true);
    }, 30_000);

    return () => {
      document.removeEventListener('visibilitychange', handle);
      window.removeEventListener('focus', handle);
      window.removeEventListener('blur', handle);
      clearInterval(heartbeat);
      // Mark as unfocused on cleanup so push is delivered to this user after navigation.
      syncRedis(false);
    };
  }, [roomId, libraryId, updateSelf]);

  // ── Resolve "Reader" fallback name after initial join ─────────────────────
  useEffect(() => {
    const self = usePresenceStore.getState().self;
    if (!self || userName === 'Reader' || self.userName !== 'Reader') return;
    const patch = { userName, avatarInitials: makeInitials(userName) };
    updateSelf(patch);
    if (channelRef.current) {
      channelRef.current.track(presenceOnly({ ...self, ...patch }));
    }
  }, [roomId, userName, updateSelf]);

  // ── Cross-tab name sync via localStorage ──────────────────────────────────
  useEffect(() => {
    const handle = (e: StorageEvent) => {
      if (e.key !== 'readroom_user_name' || !e.newValue) return;
      const self = usePresenceStore.getState().self;
      if (!self) return;
      const patch = { userName: e.newValue, avatarInitials: makeInitials(e.newValue) };
      updateSelf(patch);
      if (channelRef.current) {
        channelRef.current.track(presenceOnly({ ...self, ...patch }));
      }
    };
    window.addEventListener('storage', handle);
    return () => window.removeEventListener('storage', handle);
  }, [roomId, updateSelf]);
}
