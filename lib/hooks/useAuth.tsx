'use client';

// useAuth.tsx — Centralized auth + profile management.
//
// Drive token strategy:
//   We request the Drive scope during the initial Supabase Google OAuth sign-in.
//   Supabase returns the provider_token (Google access token) in the session.
//   This eliminates the GIS popup entirely — no popup, no COOP issue.
//
//   Fallback: if provider_token is missing (e.g. user signed in before Drive
//   scope was added), we fall back to the GIS token client with ux_mode implicit.
//   The COOP header is set to 'unsafe-none' to allow the GIS popup to work.

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

// ── Module-level Drive token ──────────────────────────────────────────────────
// Token value is mirrored into React state so components re-render when it changes.

let _driveToken: string | null = null;
let _driveTokenExpiresAt = 0;
let _gisTokenClient: any = null;
const _driveSubscribers = new Set<() => void>();

function notifyDriveSubscribers() {
  _driveSubscribers.forEach((fn) => fn());
}

function avatarKey(userId: string) {
  return `readroom_avatar_url_${userId}`;
}

function driveTokenKey(userId: string) {
  return `readroom_drive_token_${userId}`;
}

function readStoredDriveToken(userId: string) {
  try {
    const raw = localStorage.getItem(driveTokenKey(userId));
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
      driveTokenKey(userId),
      JSON.stringify({ token, expiresAt: _driveTokenExpiresAt })
    );
  } catch {}
  notifyDriveSubscribers();
}

function clearDriveToken(userId?: string) {
  _driveToken = null;
  _driveTokenExpiresAt = 0;
  try {
    if (userId) localStorage.removeItem(driveTokenKey(userId));
  } catch {}
  notifyDriveSubscribers();
}

// ── AuthProvider ──────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  // driveToken as React state so components re-render when it changes
  const [driveToken, setDriveToken] = useState<string | null>(null);
  const [userName, setUserName] = useState<string>('Reader');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const userRef = useRef<User | null>(null);

  // Keep module-level var in sync with state (for non-React callers like storeDriveToken)
  // The subscriber pattern in the Drive token effect handles the reverse direction.

  // ── Profile sync ──────────────────────────────────────────────────────────
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

    try {
      const cached = localStorage.getItem(`readroom_user_name_${u.id}`);
      const cachedAvatar = localStorage.getItem(avatarKey(u.id));
      if (cached && cached !== 'Reader') setUserName(cached);
      if (cachedAvatar) setAvatarUrl(cachedAvatar);
    } catch {}

    const profile = await syncProfileFromDB(u);

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
        fetch('/api/user/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayName: metaName }),
        }).catch(() => {});
      }
    }
  }, [syncProfileFromDB]);

  // ── Extract Drive token from Supabase session (primary method) ────────────
  // When the user signs in with Google and we request the Drive scope,
  // Supabase returns the Google access token as session.provider_token.
  // This is the cleanest approach — no popup, no COOP issues.
  const extractDriveTokenFromSession = useCallback((s: Session | null) => {
    if (!s?.provider_token || !s.user?.id) return;

    // provider_token is the Google access token
    const token = s.provider_token;
    const expiresAt = s.expires_at ? s.expires_at * 1000 : 0;
    const expiresIn = expiresAt ? Math.max(0, (expiresAt - Date.now()) / 1000) : 3600;

    console.log('[AuthProvider] Drive token extracted from Supabase session');
    storeDriveToken(s.user.id, token, expiresIn);
  }, []);

  // ── Session initialization ────────────────────────────────────────────────
  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(async ({ data: { session: s }, error }) => {
      if (!mounted) return;
      if (error) console.warn('[AuthProvider] getSession error:', error.message);

      let activeSession = s;
      if (s?.expires_at) {
        const expiresAt = s.expires_at * 1000;
        if (expiresAt - Date.now() < 60_000) {
          const refreshed = await supabase.auth.refreshSession();
          if (!refreshed.error) activeSession = refreshed.data.session;
        }
      }

      setSession(activeSession);
      extractDriveTokenFromSession(activeSession);
      await updateIdentity(activeSession?.user ?? null);
      if (mounted) setLoading(false);
    }).catch(() => {
      if (mounted) setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, s) => {
        if (!mounted) return;
        setSession(s);
        extractDriveTokenFromSession(s);
        await updateIdentity(s?.user ?? null);
        setLoading(false);
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase, updateIdentity, extractDriveTokenFromSession]);

  // ── Supabase Realtime: profile changes ────────────────────────────────────
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
      .subscribe(); // .on() before .subscribe() — correct order

    return () => { supabase.removeChannel(channel); };
  }, [supabase, user?.id]);

  // ── Drive token: load from storage + subscribe to module-level changes ──────
  useEffect(() => {
    if (!user?.id) return;

    // Subscribe: when module-level token changes (GIS callback, session extract),
    // mirror it into React state so components re-render.
    const sync = () => setDriveToken(_driveToken);
    _driveSubscribers.add(sync);

    // Load cached token if not already set from session
    if (!_driveToken) {
      const stored = readStoredDriveToken(user.id);
      if (stored?.token) {
        if (!stored.expiresAt || stored.expiresAt > Date.now()) {
          _driveToken = stored.token;
          _driveTokenExpiresAt = stored.expiresAt;
          setDriveToken(stored.token);
        } else {
          clearDriveToken(user.id);
        }
      }
    } else {
      // Already set (e.g. from session) — sync into state
      setDriveToken(_driveToken);
    }

    return () => { _driveSubscribers.delete(sync); };
  }, [user?.id]);

  // ── GIS fallback: initialize token client for re-authorization ───────────
  // Only used when the session doesn't have a provider_token (e.g. user signed
  // in before Drive scope was added to the OAuth flow).
  // The COOP header is set to 'unsafe-none' in next.config.mjs to allow this.
  useEffect(() => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId || typeof window === 'undefined') return;

    const initGisClient = () => {
      if (_gisTokenClient) return;
      if (!window.google?.accounts?.oauth2) return;

      _gisTokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/drive.readonly',
        callback: (response: any) => {
          if (response.error) {
            console.warn('[AuthProvider] GIS Drive token error:', response.error);
            return;
          }
          const currentUser = userRef.current;
          if (response.access_token && currentUser?.id) {
            console.log('[AuthProvider] GIS Drive token obtained');
            storeDriveToken(
              currentUser.id,
              response.access_token,
              Number(response.expires_in ?? 3600)
            );
          }
        },
        error_callback: (err: any) => {
          console.warn('[AuthProvider] GIS token client error:', err);
        },
      });
    };

    if (window.google?.accounts?.oauth2) {
      initGisClient();
    } else {
      const existing = document.querySelector(
        'script[src="https://accounts.google.com/gsi/client"]'
      );
      if (existing) {
        existing.addEventListener('load', initGisClient, { once: true });
      } else {
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.onload = initGisClient;
        document.head.appendChild(script);
      }
    }
  }, []);

  // ── Auth actions ──────────────────────────────────────────────────────────

  const signInWithGoogle = useCallback(async () => {
    const redirectTo = `${window.location.origin}/auth/callback`;
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        queryParams: {
          access_type: 'offline',
          prompt: 'select_account consent', // 'consent' ensures Drive scope is granted
          // Request Drive scope alongside the default profile/email scopes.
          // Supabase will include this in the OAuth request to Google.
          scope: [
            'openid',
            'email',
            'profile',
            'https://www.googleapis.com/auth/drive.readonly',
          ].join(' '),
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
    _gisTokenClient = null;
    clearDriveToken(userRef.current?.id);
    await supabase.auth.signOut().catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // requestDriveAccess: tries session token first, falls back to GIS popup
  const requestDriveAccess = useCallback(() => {
    // If we already have a valid token, nothing to do
    if (_driveToken && (!_driveTokenExpiresAt || _driveTokenExpiresAt > Date.now())) {
      notifyDriveSubscribers();
      return;
    }

    // Try to get token from current session first (no popup needed)
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (s?.provider_token && userRef.current?.id) {
        const expiresIn = s.expires_at
          ? Math.max(0, s.expires_at - Date.now() / 1000)
          : 3600;
        storeDriveToken(userRef.current.id, s.provider_token, expiresIn);
        return;
      }

      // Session doesn't have provider_token — fall back to GIS popup.
      // This requires the user to re-authorize with Drive scope.
      // The COOP header must be 'unsafe-none' for this to work.
      if (_gisTokenClient) {
        console.log('[AuthProvider] Requesting Drive access via GIS popup');
        _gisTokenClient.requestAccessToken({ prompt: 'consent' });
      } else {
        // GIS not loaded yet — trigger a full re-sign-in with Drive scope
        console.log('[AuthProvider] GIS not ready, triggering full re-sign-in');
        signInWithGoogle();
      }
    }).catch(() => {
      if (_gisTokenClient) {
        _gisTokenClient.requestAccessToken({ prompt: 'consent' });
      }
    });
  }, [supabase, signInWithGoogle]);

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
        localStorage.setItem('readroom_user_name', trimmed);
      } catch {}

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
    signInWithGoogle,
    signOut,
    driveToken,          // ← React state, not module-level var
    requestDriveAccess,
    updateDisplayName,
    updateAvatarUrl,
  }), [
    user, session, userName, avatarUrl, loading, driveToken,
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
