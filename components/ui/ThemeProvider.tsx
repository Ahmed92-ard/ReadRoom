'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useUIStore } from '@/store/uiStore';
import { ensureRuntimeStateVersion } from '@/lib/runtime/recovery';
import { useAuth } from '@/lib/hooks/useAuth';
import { usePushNotifications } from '@/lib/hooks/usePushNotifications';


export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const setTheme = useUIStore((state) => state.setTheme);
  const router = useRouter();

  // Initialize theme from localStorage on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;

    ensureRuntimeStateVersion();

    let initial: 'dark' | 'light' = 'dark';
    try {
      const stored = localStorage.getItem('theme') as 'dark' | 'light' | null;
      const preferred = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
      initial = stored === 'dark' || stored === 'light' ? stored : preferred;
    } catch (err) {
      console.warn('[runtime] theme restore failed', err);
    }

    // setTheme already applies to DOM + localStorage
    setTheme(initial);
  }, [setTheme]);

  // Listen for theme changes from other tabs
  useEffect(() => {
    const handleStorageChange = (e: StorageEvent) => {
      if (e.key === 'theme' && e.newValue) {
        const newTheme = e.newValue as 'dark' | 'light';
        setTheme(newTheme);
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [setTheme]);

  const { user } = useAuth();
  const { registerPush } = usePushNotifications();

  // Register push notifications globally once authenticated
  useEffect(() => {
    if (user?.id) {
      registerPush(user.id);
    }
  }, [user?.id, registerPush]);


  // Register service worker
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const handleControllerChange = () => {
      try {
        if (sessionStorage.getItem('__readroom_sw_reloaded__') === '1') return;
        sessionStorage.setItem('__readroom_sw_reloaded__', '1');
      } catch {}
      console.info('[sw] controller changed; reloading for fresh runtime');
      window.location.reload();
    };

    navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

    const handleSWMessage = (event: MessageEvent) => {
      if (event.data?.type === 'NOTIFICATION_ROUTE') {
        const { url, roomId, isCall } = event.data;
        if (url) {
          if (isCall) {
            try {
              sessionStorage.setItem('__readroom_join_call_pending__', '1');
            } catch {}
            // Trigger instant join call event for hot path
            window.dispatchEvent(new CustomEvent('readroom-join-call'));
          }
          router.push(url);
        }
      }
    };

    navigator.serviceWorker.addEventListener('message', handleSWMessage);

    navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then((registration) => {
        console.info('[sw] registered', registration.scope);

        registration.addEventListener('updatefound', () => {
          const worker = registration.installing;
          console.info('[sw] update found');
          worker?.addEventListener('statechange', () => {
            console.info('[sw] worker state', worker.state);
            if (worker.state === 'installed' && navigator.serviceWorker.controller) {
              worker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });

        registration.update().catch((error) => {
          console.warn('[sw] update check failed', error);
        });
      })
      .catch((error) => {
        console.warn('[sw] registration failed', error);
      });

    return () => {
      navigator.serviceWorker.removeEventListener('controllerchange', handleControllerChange);
      navigator.serviceWorker.removeEventListener('message', handleSWMessage);
    };
  }, []);

  return <>{children}</>;
}
