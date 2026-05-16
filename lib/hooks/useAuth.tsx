'use client';

// useAuth.tsx — Centralized auth + profile management.
// Exported as AuthProvider (context) + useAuth (hook).

import {
  useState, useEffect, useCallback, useMemo, useRef,
  createContext, useContext,
} from 'react';
import { createClient } from '@/lib/supabase/client';
import type { User, Session } from '@supabase/supabase-js';

// ── Types ─────────────────────────────────────────────────────────────────────

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
  updateDisplayName: (name: string) => Promise<boolean>;
  updateAvatarUrl: (url: string) => Promise<boolean>;
}

const AuthContext = createContext<AuthState | null>(null);

// ── Module-level Drive token state ────────────────────────────────────────────
// Kept outside React so it survives re-renders and component remounts.

let _driveToken: string | null = null;
let _driveTokenExpiresAt = 0;
let _driveTokenClient: any = null;
const _driveSubscribers = new Set<() => void>();

function notifyDriveSubscribers() {
  _driveSubscribers.forEach((fn) => fn());
}

function avatarKey(userId: string) {
  return `readroom_avatar_url_${userId}`;
}

function readStoredDriveToken(userId: string) {
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
    return null;
  }
}

function storeDriveToken(userId: string, token: string, expiresIn?: number) {
  _driveToken = token;
  _driveTokenExpiresAt = expiresIn
    ? Date.now() + Math.max(0, expiresIn - 60) * 1000
    : 0;
  try {
    localStorage.setItem(
      `readroom_drive_token_${userId}`,
      JSON.stringify({ token, expiresAt: _driveTokenExpiresAt })
    );
  } catch {}
  notifyDriveSubscribers();
}

function clearDriveToken(userId?: string) {
  _driveToken = null;
  _driveTokenExpiresAt = 0;
  try {
    if (userId) localStorage.removeItem(`readroom_drive_token_${userId}`);
    localStorage.removeItem('readroom_drive_token');
  } catch {}
  notifyDriveSubscribers();
}

// ── AuthProvider ──────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [, forceRender] = useState(0);
  const [userName, setUserName] = useState<string>('Reader');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const userRef = useRef<User | null>(null);

  // ── Profile sync from DB ────────────────────────────────────────────────
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
    } catch {
      // DB may not exist yet (schema not applied) — non-fatal
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

    // Authoritative DB fetch
    const profile = await syncProfileFromDB(u);

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
        // Persist to DB in background — non-blocking
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

    supabase.auth.getSession().then(async ({ data: { session: s }, error }) => {
      if (!mounted) return;
      if (error) console.warn('[AuthProvider] getSession error:', error.message);

      // Refresh if close to expiry
      let activeSession = s;
      if (s?.expires_at) {
        const expiresAt = s.expires_at * 1000;
        if (expiresAt - Date.now() < 60_000) {
          const refreshed = await supabase.auth.refreshSession();
          if (!refreshed.error) activeSession = refreshed.data.session;
        }
      }

      setSession(activeSession);
      await updateIdentity(activeSession?.user ?? null);
      if (mounted) setLoading(false);
    }).catch(() => {
      // getSession itself failed (network error, etc.) — don't hang forever
      if (mounted) setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, s) => {
        if (!mounted) return;
        setSession(s);
        await updateIdentity(s?.user ?? null);
        setLoading(false);
      }
    );

    return () => {
      mounted = false;
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
      .subscribe(); // ← subscribe AFTER .on()

    return () => { supabase.removeChannel(channel); };
  }, [supabase, user?.id]);

  // ── Drive token: load from storage + subscribe to changes ────────────────
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
        // Token expired — clear it; user will need to re-authorize
        clearDriveToken(user.id);
      }
    } else {
      _driveToken = null;
      _driveTokenExpiresAt = 0;
      notifyDriveSubscribers();
    }

    return () => { _driveSubscribers.delete(rerender); };
  }, [user?.id]);

  // ── Google Identity Services: Drive token client ──────────────────────────
  // Uses the implicit token flow (no popup — opens a consent page in the same tab
  // or a small overlay). This avoids the Cross-Origin-Opener-Policy popup issue.
  useEffect(() => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId || typeof window === 'undefined') return;

    const initDriveClient = () => {
      // Don't re-initialize if already set up
      if (_driveTokenClient) return;
      if (!window.google?.accounts?.oauth2) return;

      _driveTokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/drive.readonly',
        // Use 'none' prompt for silent refresh when we already have a token;
        // the caller passes 'consent' for first-time authorization.
        callback: (response: any) => {
          const currentUser = userRef.current;
          if (response.error) {
            console.warn('[AuthProvider] Drive token error:', response.error, response.error_description);
            return;
          }
          if (response.access_token && currentUser?.id) {
            storeDriveToken(
              currentUser.id,
              response.access_token,
              Number(response.expires_in ?? 3600)
            );
          }
        },
        error_callback: (err: any) => {
          console.warn('[AuthProvider] Drive token client error:', err);
        },
      });
    };

    if (window.google?.accounts?.oauth2) {
      initDriveClient();
    } else {
      // Load GSI script if not already present
      const existing = document.querySelector(
        'script[src="https://accounts.google.com/gsi/client"]'
      );
      if (existing) {
        existing.addEventListener('load', initDriveClient, { once: true });
      } else {
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.onload = initDriveClient;
        document.head.appendChild(script);
      }
    }
  }, []); // run once on mount

  // ── Auto-refresh Drive token before expiry ────────────────────────────────
  useEffect(() => {
    if (!_driveToken || !_driveTokenExpiresAt) return;
    const delay = Math.max(10_000, _driveTokenExpiresAt - Date.now() - 60_000);
    const timer = window.setTimeout(() => {
      // Silent refresh — no consent prompt
      _driveTokenClient?.requestAccessToken({ prompt: '' });
    }, delay);
    return () => window.clearTimeout(timer);
  });

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

      // Broadcast via socket
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
    if (error) {
      console.error('[AuthProvider] signInWithOAuth error:', error.message);
      return;
    }
    if (data?.url) window.location.assign(data.url);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOut = useCallback(async () => {
    _driveTokenClient = null;
    clearDriveToken(userRef.current?.id);
    await supabase.auth.signOut().catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestDriveAccess = useCallback(() => {
    if (!_driveTokenClient) {
      console.warn('[AuthProvider] Drive token client not ready yet');
      return;
    }
    // Use 'consent' for first-time auth, '' for silent refresh
    const prompt = _driveToken ? '' : 'consent';
    _driveTokenClient.requestAccessToken({ prompt });
  }, []);

  // ── Context value ─────────────────────────────────────────────────────────

  const value = useMemo<AuthState>(() => ({
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
  }), [
    user, session, userName, avatarUrl, loading,
    signInWithGoogle, signOut, requestDriveAccess,
    updateDisplayName, updateAvatarUrl,
  ]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
