'use client';

// useAuth.tsx — Centralized auth + profile management.
// Profile changes (display name, avatar) are:
//   1. Persisted to Supabase `users` table (permanent)
//   2. Broadcast via socket `profile:updated` event (real-time propagation)
//   3. Cached in localStorage for fast initial load (no stale state)

import { useState, useEffect, useCallback, useMemo, useRef, createContext, useContext } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { User, Session } from '@supabase/supabase-js';

interface AuthState {
  user: User | null;
  session: Session | null;
  userName: string;
  avatarUrl: string | null;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  driveToken: string | null;
  requestDriveAccess: () => void;
  /** Update display name — persists to DB + broadcasts to room */
  updateDisplayName: (name: string) => Promise<boolean>;
  /** Update avatar URL — persists to DB + broadcasts to room */
  updateAvatarUrl: (url: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthState | null>(null);

// ── Module-level Drive token (separate from Supabase session) ─────────────────
let _driveToken: string | null = null;
let _driveTokenExpiresAt = 0;
let _driveTokenClient: any = null;
const _driveSubscribers = new Set<() => void>();
function notifyDriveSubscribers() { _driveSubscribers.forEach((fn) => fn()); }

function readStored DriveToken(userId: string) {
  try {
    const raw = localStorage.getItem(`readroom_drive_token_${userId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'string') return { token: parsed, expiresAt: 0 };
    return {
      token: typeof parsed?.token === 'string' ? parsed.token : null,
      expiresAt: Number(parsed?.expiresAt ?? 0),
    };
  } catch {
    const token = localStorage.getItem(`readroom_drive_token_${userId}`);
    return token ? { token, expiresAt: 0 } : null;
  }
}

function storeDriveToken(userId: string, token: string, expiresIn?: number) {
  _driveToken = token;
  _driveTokenExpiresAt = expiresIn ? Date.now() + Math.max(0, expiresIn - 60) * 1000 : 0;
  localStorage.setItem(
    `readroom_drive_token_${userId}`,
    JSON.stringify({ token, expiresAt: _driveTokenExpiresAt })
  );
  notifyDriveSubscribers();
}

function clearDriveToken(userId?: string) {
  _driveToken = null;
  _driveTokenExpiresAt = 0;
  if (userId) localStorage.removeItem(`readroom_drive_token_${userId}`);
  localStorage.removeItem('readroom_drive_token');
  notifyDriveSubscribers();
}

function avatarStorageKey(userId: string) {
  return `readroom_avatar_url_${userId}`;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [, forceRender] = useState(0);
  const [userName, setUserName] = useState<string>('Reader');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  // ── Sync profile from Supabase DB (canonical source of truth) ────────────
  const syncProfileFromDB = useCallback(async (u: User) => {
    try {
      const { data: profile } = await supabase
        .from('users')
        .select('display_name, avatar_url')
        .eq('id', u.id)
        .maybeSingle();

      if (profile) {
        const name = profile.display_name || u.user_metadata?.full_name || u.email?.split('@')[0] || 'Reader';
        const url = profile.avatar_url ?? null;
        setUserName(name);
        setAvatarUrl(url);
        // Cache locally for fast subsequent loads
        localStorage.setItem(`readroom_user_name_${u.id}`, name);
        if (url) localStorage.setItem(avatarStorageKey(u.id), url);
        else localStorage.removeItem(avatarStorageKey(u.id));
        return { name, url };
      }
    } catch (err) {
      console.warn('[AuthProvider] syncProfileFromDB failed:', err);
    }
    return null;
  }, [supabase]);

  const updateIdentity = useCallback(async (u: User | null) => {
    if (!u) {
      setUser(null);
      setUserName('Reader');
      setAvatarUrl(null);
      return;
    }
    setUser(u);

    // Fast path: use cached name while DB fetch is in-flight
    const cached = localStorage.getItem(`readroom_user_name_${u.id}`);
    const cachedAvatar = localStorage.getItem(avatarStorageKey(u.id));
    if (cached && cached !== 'Reader') setUserName(cached);
    if (cachedAvatar) setAvatarUrl(cachedAvatar);

    // Authoritative: fetch from DB
    const profile = await syncProfileFromDB(u);

    // If no DB profile yet, auto-register from OAuth metadata
    if (!profile || profile.name === 'Reader') {
      const metaName = u.user_metadata?.full_name ||
                       u.user_metadata?.name ||
                       u.user_metadata?.given_name ||
                       u.email?.split('@')[0] || 'Reader';
      if (metaName !== 'Reader') {
        setUserName(metaName);
        localStorage.setItem(`readroom_user_name_${u.id}`, metaName);
        // Persist to DB in background
        fetch('/api/user/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayName: metaName }),
        }).catch(() => {});
      }
    }
  }, [syncProfileFromDB]);

  // ── Initialize session ────────────────────────────────────────────────────
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session }, error }) => {
      if (error) console.warn('[AuthProvider] getSession error:', error.message);
      const expiresAt = session?.expires_at ? session.expires_at * 1000 : 0;
      if (session && expiresAt && expiresAt - Date.now() < 60_000) {
        const refreshed = await supabase.auth.refreshSession();
        if (!refreshed.error) session = refreshed.data.session;
      }
      setSession(session);
      await updateIdentity(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      setSession(session);
      await updateIdentity(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [supabase, updateIdentity]);

  // ── Supabase Realtime: listen for profile changes from other sessions ─────
  useEffect(() => {
    if (!user?.id) return;

    // Use a stable channel name to avoid multiple subscriptions
    const channel = supabase
      .channel(`profile:${user.id}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'users',
        filter: `id=eq.${user.id}`,
      }, (payload) => {
        const updated = payload.new as any;
        if (updated.display_name) {
          setUserName(updated.display_name);
          localStorage.setItem(`readroom_user_name_${user.id}`, updated.display_name);
        }
        if (updated.avatar_url !== undefined) {
          setAvatarUrl(updated.avatar_url);
          if (updated.avatar_url) localStorage.setItem(avatarStorageKey(user.id), updated.avatar_url);
          else localStorage.removeItem(avatarStorageKey(user.id));
        }
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [supabase, user?.id]);

  const userRef = useRef<User | null>(user);
  useEffect(() => { userRef.current = user; }, [user]);

  // ── Drive token management ────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.id) return;
    const rerender = () => forceRender((n) => n + 1);
    _driveSubscribers.add(rerender);

    const stored = readStoredDriveToken(user.id);
    if (stored?.token) {
      if (!stored.expiresAt || stored.expiresAt > Date.now()) {
        _driveToken = stored.token;
        _driveTokenExpiresAt = stored.expiresAt;
        notifyDriveSubscribers();
      } else {
        clearDriveToken(user.id);
        requestAnimationFrame(() => { _driveTokenClient?.requestAccessToken({ prompt: '' }); });
      }
    } else {
      _driveToken = null;
      _driveTokenExpiresAt = 0;
      notifyDriveSubscribers();
    }

    return () => { _driveSubscribers.delete(rerender); };
  }, [user?.id]);

  useEffect(() => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId || typeof window === 'undefined') return;

    const initDriveClient = () => {
      if (_driveTokenClient) return;
      if (!window.google?.accounts?.oauth2) return;
      _driveTokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/drive.readonly',
        callback: (response: any) => {
          const currentUser = userRef.current;
          if (response.access_token && currentUser?.id) {
            storeDriveToken(currentUser.id, response.access_token, Number(response.expires_in ?? 3600));
          }
        },
        error_callback: (err: any) => { console.warn('[AuthProvider] Drive token error:', err); },
      });
    };

    if (window.google?.accounts?.oauth2) {
      initDriveClient();
    } else {
      const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
      if (existing) { existing.addEventListener('load', initDriveClient); return; }
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = initDriveClient;
      document.head.appendChild(script);
    }
  }, []);

  // ── Profile update helpers ────────────────────────────────────────────────

  /** Persist display name to Supabase and broadcast via socket */
  const updateDisplayName = useCallback(async (name: string): Promise<boolean> => {
    const trimmed = name.trim().slice(0, 64);
    if (!trimmed || !user) return false;

    try {
      const res = await fetch('/api/user/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName: trimmed }),
      });
      if (!res.ok) return false;

      setUserName(trimmed);
      localStorage.setItem(`readroom_user_name_${user.id}`, trimmed);
      // Notify other tabs
      localStorage.setItem('readroom_user_name', trimmed);

      // Broadcast to room via socket
      const { getSocket } = await import('@/lib/socket/client');
      const { usePresenceStore } = await import('@/store/presenceStore');
      const self = usePresenceStore.getState().self;
      if (self) {
        const socket = getSocket();
        const { stringToColor, makeInitials } = await import('@/lib/utils/avatar');
        const avatarColor = stringToColor(self.userId);
        const avatarInitials = makeInitials(trimmed);
        usePresenceStore.getState().updateSelf({ userName: trimmed, avatarInitials });
        socket.emit('profile:updated', {
          userId: self.userId,
          userName: trimmed,
          avatarUrl: self.avatarUrl ?? null,
          avatarColor,
          avatarInitials,
        });
        // Also update presence in current room
        const roomId = (window as any).__readroom_roomId;
        if (roomId) {
          socket.emit('presence:update', {
            roomId,
            user: { ...self, userName: trimmed, avatarInitials },
          });
        }
      }
      return true;
    } catch (err) {
      console.error('[AuthProvider] updateDisplayName failed:', err);
      return false;
    }
  }, [user]);

  /** Persist avatar URL to Supabase and broadcast via socket */
  const updateAvatarUrl = useCallback(async (url: string): Promise<boolean> => {
    if (!user) return false;

    try {
      const res = await fetch('/api/user/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ avatarUrl: url }),
      });
      if (!res.ok) return false;

      setAvatarUrl(url);
      localStorage.setItem(avatarStorageKey(user.id), url);

      // Broadcast to room via socket
      const { getSocket } = await import('@/lib/socket/client');
      const { usePresenceStore } = await import('@/store/presenceStore');
      const self = usePresenceStore.getState().self;
      if (self) {
        const socket = getSocket();
        const { stringToColor, makeInitials } = await import('@/lib/utils/avatar');
        const avatarColor = stringToColor(self.userId);
        const avatarInitials = makeInitials(self.userName);
        usePresenceStore.getState().updateSelf({ avatarUrl: url });
        socket.emit('profile:updated', {
          userId: self.userId,
          userName: self.userName,
          avatarUrl: url,
          avatarColor,
          avatarInitials,
        });
        const roomId = (window as any).__readroom_roomId;
        if (roomId) {
          socket.emit('presence:update', {
            roomId,
            user: { ...self, avatarUrl: url },
          });
        }
      }
      return true;
    } catch (err) {
      console.error('[AuthProvider] updateAvatarUrl failed:', err);
      return false;
    }
  }, [user]);

  // ── Auth actions ──────────────────────────────────────────────────────────

  const signInWithGoogle = useCallback(async () => {
    const redirectTo = `${window.location.origin}/auth/callback`;
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        queryParams: { access_type: 'offline', prompt: 'select_account' },
      },
    });
    if (error) { console.error('[AuthProvider] signInWithOAuth error:', error.message); return; }
    if (data?.url) window.location.assign(data.url);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOut = useCallback(async () => {
    _driveTokenClient = null;
    clearDriveToken(userRef.current?.id);
    const { error } = await supabase.auth.signOut();
    if (error) console.error('[AuthProvider] signOut error:', error.message);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestDriveAccess = useCallback(() => {
    if (_driveTokenClient) {
      _driveTokenClient.requestAccessToken({ prompt: _driveToken ? '' : 'consent' });
    }
  }, []);

  // Auto-refresh Drive token before expiry
  useEffect(() => {
    if (!_driveToken || !_driveTokenExpiresAt) return;
    const delay = Math.max(5_000, _driveTokenExpiresAt - Date.now());
    const timer = window.setTimeout(() => {
      _driveTokenClient?.requestAccessToken({ prompt: '' });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [_driveToken, _driveTokenExpiresAt]);

  const value = useMemo(() => ({
    user,
    session,
    userName,
    avatarUrl,
    loading,
    signInWithGoogle,
    signOut,
    driveToken: _driveToken,
    requestDriveAccess,
    updateDisplayName,
    updateAvatarUrl,
  }), [user, session, userName, avatarUrl, loading, signInWithGoogle, signOut, requestDriveAccess, updateDisplayName, updateAvatarUrl]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
