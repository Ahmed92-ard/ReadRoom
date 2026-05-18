// lib/hooks/usePushNotifications.ts
'use client';

import { useState, useCallback } from 'react';

const VAPID_PUBLIC_KEY = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';

// Helper to convert base64 VAPID public key to a Uint8Array
function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function usePushNotifications() {
  const [subscribed, setSubscribed] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Registers a browser push subscription for the authenticated user.
   * Completely safe to call repeatedly; uses session caching to prevent duplicate API calls.
   */
  const registerPush = useCallback(async (userId: string) => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
      return;
    }

    // Session cache: prevent duplicate subscriptions in the same app session
    const cacheKey = `__readroom_push_subbed_${userId}__`;
    if (sessionStorage.getItem(cacheKey) === '1') {
      setSubscribed(true);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Get active Service Worker registration
      const registration = await navigator.serviceWorker.ready;
      
      // 2. Check current notification permission
      if (Notification.permission === 'denied') {
        throw new Error('Notification permission is denied by the user.');
      }

      // If default, we can prompt for permission when the user is active
      if (Notification.permission === 'default') {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') {
          throw new Error('Notification permission was not granted.');
        }
      }

      // 3. Ensure we have VAPID key
      if (!VAPID_PUBLIC_KEY) {
        console.warn('[PushNotifications] Missing NEXT_PUBLIC_VAPID_PUBLIC_KEY.');
        setLoading(false);
        return;
      }

      // 4. Retrieve or create push subscription
      let subscription = await registration.pushManager.getSubscription();

      if (!subscription) {
        const applicationServerKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: applicationServerKey as any,
        });
      }

      // 5. Submit subscription to Next.js API route
      const response = await fetch('/api/notifications/push-subscription', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subscription,
          device_metadata: {
            userAgent: navigator.userAgent,
            language: navigator.language,
            platform: (navigator as any).userAgentData?.platform || navigator.platform,
          },
        }),
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || 'Failed to save push subscription on backend.');
      }

      // Set session cache to prevent redundant writes
      sessionStorage.setItem(cacheKey, '1');
      setSubscribed(true);
      console.info('[PushNotifications] Browser push subscription registered successfully.');
    } catch (err: any) {
      console.warn('[PushNotifications] Registration failed:', err.message || err);
      setError(err.message || 'Failed to register push notifications');
      setSubscribed(false);
    } finally {
      setLoading(false);
    }
  }, []);

  /**
   * Revokes and deletes push subscription.
   */
  const unsubscribePush = useCallback(async (userId: string) => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;

    setLoading(true);
    setError(null);

    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();

      if (subscription) {
        // Delete from backend API
        await fetch('/api/notifications/push-subscription', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });

        // Unsubscribe from push manager
        await subscription.unsubscribe();
      }

      const cacheKey = `__readroom_push_subbed_${userId}__`;
      sessionStorage.removeItem(cacheKey);
      setSubscribed(false);
      console.info('[PushNotifications] Push notifications unsubscribed successfully.');
    } catch (err: any) {
      console.error('[PushNotifications] Unsubscribe failed:', err);
      setError(err.message || 'Failed to unsubscribe');
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    subscribed,
    loading,
    error,
    registerPush,
    unsubscribePush,
  };
}
