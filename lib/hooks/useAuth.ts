'use client';

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import type { User, Session } from '@supabase/supabase-js';

interface AuthState {
  user: User | null;
  session: Session | null;
  userName: string;
  loading: boolean;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
  driveToken: string | null;
  requestDriveAccess: () => void;
}

// Module-level Drive token (separate from Supabase session — needed for Picker API)
let _driveToken: string | null = null;
let _driveTokenExpiresAt = 0;
let _driveTokenClient: any = null;
const _driveSubscribers = new Set<() => void>();
function notifyDriveSubscribers() { _driveSubscribers.forEach((fn) => fn()); }

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

export function useAuth(): AuthState {
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [, forceRender] = useState(0);

  const [userName, setUserName] = useState<string>('Reader');

  const syncProfile = useCallback(async (u: User, name: string) => {
    if (!u || name === 'Reader') return;
    // Prevent redundant syncs in same session
    if ((window as any).__readroom_synced === u.id) return;

    try {
      const { data: profile } = await supabase
        .from('users')
        .select('display_name')
        .eq('id', u.id)
        .maybeSingle();

      if (!profile || !profile.display_name || profile.display_name === 'Reader') {
        console.log('[useAuth] auto-registering display name:', name);
        await fetch('/api/user/settings', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ displayName: name }),
        });
        (window as any).__readroom_synced = u.id;
      }
    } catch (err) {
      console.warn('[useAuth] profile sync failed', err);
    }
  }, [supabase]);

  const updateIdentity = useCallback((u: User | null) => {
    if (!u) {
      setUser(null);
      return;
    }
    setUser(u);
    const name = u.user_metadata?.full_name || 
                 u.user_metadata?.name || 
                 u.user_metadata?.given_name || 
                 u.email?.split('@')[0] || 
                 'Reader';

    if (name !== 'Reader') {
      setUserName(name);
      localStorage.setItem(`readroom_user_name_${u.id}`, name);
      syncProfile(u, name);
    }
  }, [syncProfile]);

  // Initialize name from cache if available for this specific user
  useEffect(() => {
    if (user?.id) {
      const cached = localStorage.getItem(`readroom_user_name_${user.id}`);
      if (cached && cached !== 'Reader') setUserName(cached);
    }
  }, [user?.id]);

  // Initialize session from Supabase
  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session }, error }) => {
      if (error) {
        console.warn('[useAuth] getSession error:', error.message);
      }
      const expiresAt = session?.expires_at ? session.expires_at * 1000 : 0;
      if (session && expiresAt && expiresAt - Date.now() < 60_000) {
        const refreshed = await supabase.auth.refreshSession();
        if (refreshed.error) {
          console.warn('[useAuth] refreshSession error:', refreshed.error.message);
        } else {
          session = refreshed.data.session;
        }
      }
      setSession(session);
      updateIdentity(session?.user ?? null);
      setLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[useAuth] onAuthStateChange:', event);
      setSession(session);
      updateIdentity(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, [supabase, updateIdentity]);

  // Persistent user ref for callbacks (prevents closure staleness)
  const userRef = useRef<User | null>(user);
  useEffect(() => { userRef.current = user; }, [user]);

  // Subscribe to Drive token changes (for Google Picker)
  useEffect(() => {
    if (!user?.id) return;
    const rerender = () => forceRender((n) => n + 1);
    _driveSubscribers.add(rerender);

    const stored = readStoredDriveToken(user.id);
    if (stored?.token) {
      if (!stored.expiresAt || stored.expiresAt > Date.now()) {
        console.log('[useAuth] Loading Drive token from storage for:', user.id);
        _driveToken = stored.token;
        _driveTokenExpiresAt = stored.expiresAt;
        notifyDriveSubscribers();
      } else {
        clearDriveToken(user.id);
        requestAnimationFrame(() => {
          _driveTokenClient?.requestAccessToken({ prompt: '' });
        });
      }
    } else {
      _driveToken = null;
      _driveTokenExpiresAt = 0;
      notifyDriveSubscribers();
    }

    return () => { _driveSubscribers.delete(rerender); };
  }, [user?.id]);

  // Initialize Google token client for Drive access (separate from Supabase auth)
  useEffect(() => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId || typeof window === 'undefined') return;

    const initDriveClient = () => {
      if (_driveTokenClient) return;
      if (!window.google?.accounts?.oauth2) {
        console.warn('[useAuth] Google accounts API not ready yet');
        return;
      }
      _driveTokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/drive.readonly',
        callback: (response: any) => {
          const currentUser = userRef.current;
          if (response.access_token && currentUser?.id) {
            console.log('[useAuth] Drive token obtained for user:', currentUser.id);
            storeDriveToken(currentUser.id, response.access_token, Number(response.expires_in ?? 3600));
          } else {
            console.warn('[useAuth] Drive token response missing token:', response);
          }
        },
        error_callback: (err: any) => {
          console.warn('[useAuth] Drive token error:', err);
        },
      });
    };

    if (window.google?.accounts?.oauth2) {
      initDriveClient();
    } else {
      const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
      if (existing) {
        existing.addEventListener('load', initDriveClient);
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.onload = initDriveClient;
      document.head.appendChild(script);
    }
  }, []);

  const signInWithGoogle = useCallback(async () => {
    console.log('[useAuth] signInWithGoogle called, origin:', window.location.origin);

    const redirectTo = `${window.location.origin}/auth/callback`;
    console.log('[useAuth] redirectTo (sent to Supabase):', redirectTo);

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo,
        // Request offline access so Supabase gets a refresh token
        queryParams: {
          access_type: 'offline',
          prompt: 'select_account',
        },
      },
    });

    if (error) {
      console.error('[useAuth] signInWithOAuth error:', error.message);
      return;
    }

    if (data?.url) {
      // ── Debug: parse the generated OAuth URL to verify redirect_uri ──────
      try {
        const oauthUrl = new URL(data.url);
        const redirectUri = oauthUrl.searchParams.get('redirect_uri');
        console.log('[useAuth] ══ GENERATED OAUTH URL DEBUG ══', {
          fullUrl: data.url,
          oauthHost: oauthUrl.host,
          oauthPathname: oauthUrl.pathname,
          redirect_uri: redirectUri,
          note: 'The redirect_uri above MUST be registered in Google Cloud Console → Authorized redirect URIs.',
          expectedFormat: 'https://<your-supabase-project>.supabase.co/auth/v1/callback',
        });
      } catch (e) {
        console.log('[useAuth] redirecting to OAuth provider:', data.url);
      }
      window.location.assign(data.url);
    } else {
      console.error('[useAuth] signInWithOAuth did not return a redirect URL');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOut = useCallback(async () => {
    console.log('[useAuth] signOut');
    _driveTokenClient = null;
    clearDriveToken(userRef.current?.id);
    const { error } = await supabase.auth.signOut();
    if (error) console.error('[useAuth] signOut error:', error.message);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const requestDriveAccess = useCallback(() => {
    console.log('[useAuth] requestDriveAccess, client ready:', !!_driveTokenClient);
    if (_driveTokenClient) {
      const prompt = _driveToken ? '' : 'consent';
      _driveTokenClient.requestAccessToken({ prompt });
    } else {
      console.warn('[useAuth] Drive token client not initialized yet');
    }
  }, []);

  useEffect(() => {
    if (!_driveToken || !_driveTokenExpiresAt) return;
    const delay = Math.max(5_000, _driveTokenExpiresAt - Date.now());
    const timer = window.setTimeout(() => {
      console.log('[useAuth] refreshing Drive token silently');
      _driveTokenClient?.requestAccessToken({ prompt: '' });
    }, delay);
    return () => window.clearTimeout(timer);
  }, [_driveToken, _driveTokenExpiresAt]);

  return {
    user,
    session,
    userName,
    loading,
    signInWithGoogle,
    signOut,
    driveToken: _driveToken,
    requestDriveAccess,
  };
}
