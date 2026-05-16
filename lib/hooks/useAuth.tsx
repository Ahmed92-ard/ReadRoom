'use client';

// useAuth.tsx — Auth + profile management.
// Google OAuth is used ONLY for user identity (sign-in).
// No Drive integration. No GIS token client. No Drive scopes.

import {
  useState, useEffect, useCallback, useMemo, useRef,
  createContext, useContext,
} from 'react';
import { createClient } from '@/lib/supabase/client';
import { withTimeout } from '@/lib/runtime/recovery';
import type { User, Session } from '@supabase/supabase-js';

// ── Types ─────────────────────────────────────────────────────────────────────

interface AuthState {
  user: User | null;
  session: Session | null;
  userName: string;
  avatarUrl: string | null;
  loading: boolean;
  initError: string | null;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  updateDisplayName: (name: string) => Promise<boolean>;
  updateAvatarUrl: (url: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthState | null>(null);

function avatarKey(userId: string) {
  return `readroom_avatar_url_${userId}`;
}

// ── AuthProvider ──────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [initError, setInitError] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>('Reader');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const userRef = useRef<User | null>(null);

  // ── Profile sync from DB ──────────────────────────────────────────────────
  const syncProfileFromDB = useCallback(async (u: User) => {
    try {
      const { data: profile } = await supabase
        .from('users')
        .select('display_name, avatar_url')
        .eq('id', u.id)
        .maybeSingle();

      if (profile) {
        const name =
          profile.display_name ||
          u.user_metadata?.full_name ||
          u.email?.split('@')[0] ||
          'Reader';
        const url = profile.avatar_url ?? null;
        setUserName(name);
        setAvatarUrl(url);
        try {
          localStorage.setItem(`readroom_user_name_${u.id}`, name);
          if (url) localStorage.setItem(avatarKey(u.id), url);
          else localStorage.removeItem(avatarKey(u.id));
        } catch {}
        return { name, url };
      }
    } catch (err) {
      console.warn('[AuthProvider] profile sync failed:', err);
      // DB may not exist yet — non-fatal
    }
    return null;
  }, [supabase]);

  const updateIdentity = useCallback(async (u: User | null) => {
    if (!u) {
      setUser(null);
      userRef.current = null;
      setUserName('Reader');
      setAvatarUrl(null);
      return;
    }
    setUser(u);
    userRef.current = u;

    // Fast path: cached values while DB fetch is in-flight
    try {
      const cached = localStorage.getItem(`readroom_user_name_${u.id}`);
      const cachedAvatar = localStorage.getItem(avatarKey(u.id));
      if (cached && cached !== 'Reader') setUserName(cached);
      if (cachedAvatar) setAvatarUrl(cachedAvatar);
    } catch {}

    const profile = await withTimeout(syncProfileFromDB(u), 5_000, 'profile sync')
      .catch((err) => {
        console.warn('[AuthProvider] profile sync timed out/failed:', err);
        return null;
      });

    // Bootstrap: if no DB profile yet, derive name from OAuth metadata
    if (!profile || profile.name === 'Reader') {
      const metaName =
        u.user_metadata?.full_name ||
        u.user_metadata?.name ||
        u.user_metadata?.given_name ||
        u.email?.split('@')[0] ||
        'Reader';
      if (metaName !== 'Reader') {
        setUserName(metaName);
        try { localStorage.setItem(`readroom_user_name_${u.id}`, metaName); } catch {}
        // Persist to DB in background
        fetch('/api/user/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayName: metaName }),
        }).catch(() => {});
      }
    }
  }, [syncProfileFromDB]);

  // ── Session initialization ────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;
    let loadingWatchdog: number | undefined;

    const finishLoading = () => {
      if (loadingWatchdog) window.clearTimeout(loadingWatchdog);
      if (mounted) setLoading(false);
    };

    withTimeout(
      supabase.auth.getSession(),
      8_000,
      'auth session restore'
    ).then(async ({ data: { session: s }, error }) => {
      if (!mounted) return;
      if (error) {
        console.warn('[AuthProvider] getSession error:', error.message);
        setInitError(error.message);
      }

      let activeSession = s;
      if (s?.expires_at) {
        const expiresAt = s.expires_at * 1000;
        if (expiresAt - Date.now() < 60_000) {
          const refreshed = await withTimeout(
            supabase.auth.refreshSession(),
            8_000,
            'auth session refresh'
          ).catch((refreshError) => {
            console.warn('[AuthProvider] refreshSession failed:', refreshError);
            return null;
          });
          if (refreshed && !refreshed.error) {
            activeSession = refreshed.data.session;
          } else if (refreshed?.error) {
            console.warn('[AuthProvider] refreshSession error:', refreshed.error.message);
            setInitError(refreshed.error.message);
          }
        }
      }

      setSession(activeSession);
      await updateIdentity(activeSession?.user ?? null);
    }).catch((err) => {
      console.warn('[AuthProvider] session initialization failed:', err);
      if (mounted) {
        setInitError(err instanceof Error ? err.message : String(err));
        setSession(null);
        updateIdentity(null).catch(() => {});
      }
    }).finally(finishLoading);

    loadingWatchdog = window.setTimeout(() => {
      if (!mounted) return;
      console.warn('[AuthProvider] initialization watchdog released loading state');
      setInitError((current) => current ?? 'Session restore took too long. You can retry or sign in again.');
      setLoading(false);
    }, 10_000);

    const handleAuthChange = async (event: string, s: Session | null) => {
      if (!mounted) return;
      console.info('[AuthProvider] auth state change:', event);
      setSession(s);
      await withTimeout(updateIdentity(s?.user ?? null), 5_000, 'auth identity update')
        .catch((err) => {
          console.warn('[AuthProvider] identity update failed:', err);
          setInitError(err instanceof Error ? err.message : String(err));
        });
      setLoading(false);
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, s) => {
        handleAuthChange(event, s);
      }
    );

    return () => {
      mounted = false;
      if (loadingWatchdog) window.clearTimeout(loadingWatchdog);
      subscription.unsubscribe();
    };
  }, [supabase, updateIdentity]);

  // ── Supabase Realtime: profile changes from other sessions ────────────────
  // RULE: ALL .on() handlers MUST be attached BEFORE .subscribe()
  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`auth-profile:${user.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'users', filter: `id=eq.${user.id}` },
        (payload) => {
          const updated = payload.new as any;
          if (updated.display_name) {
            setUserName(updated.display_name);
            try { localStorage.setItem(`readroom_user_name_${user.id}`, updated.display_name); } catch {}
          }
          if (updated.avatar_url !== undefined) {
            setAvatarUrl(updated.avatar_url ?? null);
            try {
              if (updated.avatar_url) localStorage.setItem(avatarKey(user.id), updated.avatar_url);
              else localStorage.removeItem(avatarKey(user.id));
            } catch {}
          }
        }
      )
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[AuthProvider] profile realtime status:', status);
        }
      }); // .on() before .subscribe()

    return () => { supabase.removeChannel(channel); };
  }, [supabase, user?.id]);

  // ── Auth actions ──────────────────────────────────────────────────────────

  const signInWithGoogle = useCallback(async () => {
    const redirectTo = `${window.location.origin}/auth/callback`;
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        queryParams: {
          access_type: 'offline',
          prompt: 'select_account',
        },
      },
    });
    if (error) {
      console.error('[AuthProvider] signInWithOAuth error:', error.message);
      return;
    }
    if (data?.url) window.location.assign(data.url);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut().catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Profile update helpers ────────────────────────────────────────────────

  const updateDisplayName = useCallback(async (name: string): Promise<boolean> => {
    const trimmed = name.trim().slice(0, 64);
    if (!trimmed || !userRef.current) return false;
    try {
      const res = await fetch('/api/user/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: trimmed }),
      });
      if (!res.ok) return false;

      const uid = userRef.current.id;
      setUserName(trimmed);
      try {
        localStorage.setItem(`readroom_user_name_${uid}`, trimmed);
        localStorage.setItem('readroom_user_name', trimmed); // cross-tab sync
      } catch {}

      // Broadcast to room via socket
      const { getSocket } = await import('@/lib/socket/client');
      const { usePresenceStore } = await import('@/store/presenceStore');
      const { stringToColor, makeInitials } = await import('@/lib/utils/avatar');
      const self = usePresenceStore.getState().self;
      if (self) {
        const avatarInitials = makeInitials(trimmed);
        usePresenceStore.getState().updateSelf({ userName: trimmed, avatarInitials });
        const socket = getSocket();
        socket.emit('profile:updated', {
          userId: self.userId,
          userName: trimmed,
          avatarUrl: self.avatarUrl ?? null,
          avatarColor: stringToColor(self.userId),
          avatarInitials,
        });
        const roomId = (window as any).__readroom_roomId;
        if (roomId) {
          socket.emit('presence:update', { roomId, user: { ...self, userName: trimmed, avatarInitials } });
        }
      }
      return true;
    } catch (err) {
      console.error('[AuthProvider] updateDisplayName failed:', err);
      return false;
    }
  }, []);

  const updateAvatarUrl = useCallback(async (url: string): Promise<boolean> => {
    if (!userRef.current) return false;
    try {
      const res = await fetch('/api/user/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarUrl: url }),
      });
      if (!res.ok) return false;

      const uid = userRef.current.id;
      setAvatarUrl(url);
      try { localStorage.setItem(avatarKey(uid), url); } catch {}

      const { getSocket } = await import('@/lib/socket/client');
      const { usePresenceStore } = await import('@/store/presenceStore');
      const { stringToColor, makeInitials } = await import('@/lib/utils/avatar');
      const self = usePresenceStore.getState().self;
      if (self) {
        usePresenceStore.getState().updateSelf({ avatarUrl: url });
        const socket = getSocket();
        socket.emit('profile:updated', {
          userId: self.userId,
          userName: self.userName,
          avatarUrl: url,
          avatarColor: stringToColor(self.userId),
          avatarInitials: makeInitials(self.userName),
        });
        const roomId = (window as any).__readroom_roomId;
        if (roomId) {
          socket.emit('presence:update', { roomId, user: { ...self, avatarUrl: url } });
        }
      }
      return true;
    } catch (err) {
      console.error('[AuthProvider] updateAvatarUrl failed:', err);
      return false;
    }
  }, []);

  // ── Context value ─────────────────────────────────────────────────────────

  const value = useMemo<AuthState>(() => ({
    user,
    session,
    userName,
    avatarUrl,
    loading,
    initError,
    signInWithGoogle,
    signOut,
    updateDisplayName,
    updateAvatarUrl,
  }), [user, session, userName, avatarUrl, loading, initError, signInWithGoogle, signOut, updateDisplayName, updateAvatarUrl]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
