'use client';

import { useState, useEffect, useCallback } from 'react';

interface GoogleAuthState {
  isSignedIn: boolean;
  accessToken: string | null;
  userEmail: string | null;
  loading: boolean;
  signIn: () => void;
  signOut: () => void;
}

declare global {
  interface Window { google?: any; gapi?: any; }
}

const ACCESS_TOKEN_STORAGE_KEY = 'readroom_google_token';
// Module-level subscribers pattern
let _cachedToken: string | null = null;
let _tokenClient: any = null;
const _subscribers = new Set<() => void>();

function notifyAll() {
  _subscribers.forEach((fn) => fn());
}

export function useGoogleAuth(): GoogleAuthState {
  const [, forceRender] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const storedToken = typeof window !== 'undefined' ? window.localStorage.getItem(ACCESS_TOKEN_STORAGE_KEY) : null;
    if (storedToken) {
      _cachedToken = storedToken;
    }

    const rerender = () => forceRender((n) => n + 1);
    _subscribers.add(rerender);
    return () => {
      _subscribers.delete(rerender);
    };
  }, []);

  useEffect(() => {
    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId || typeof window === 'undefined') return;

    const initClient = () => {
      if (_tokenClient) return;
      _tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/drive.readonly email profile',
        callback: (response: any) => {
          setLoading(false);
          if (response.access_token) {
            _cachedToken = response.access_token;
            window.localStorage.setItem(ACCESS_TOKEN_STORAGE_KEY, response.access_token);
            notifyAll();
          }
        },
        error_callback: (err: any) => {
          console.error('[auth] error:', err);
          setLoading(false);
        },
      });
    };

    if (window.google?.accounts?.oauth2) {
      initClient();
    } else {
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = initClient;
      document.head.appendChild(script);
    }
  }, []);

  const signIn = useCallback(() => {
    if (!_tokenClient) {
      console.warn('[auth] token client not ready');
      return;
    }
    setLoading(true);
    _tokenClient.requestAccessToken({ prompt: 'consent' });
  }, []);

  const signOut = useCallback(() => {
    if (_cachedToken && typeof window !== 'undefined') {
      window.google?.accounts.oauth2.revoke(_cachedToken, () => {});
      window.localStorage.removeItem(ACCESS_TOKEN_STORAGE_KEY);
    }
    _cachedToken = null;
    notifyAll();
  }, []);

  return {
    isSignedIn: !!_cachedToken,
    accessToken: _cachedToken,
    userEmail: null,
    loading,
    signIn,
    signOut,
  };
}
