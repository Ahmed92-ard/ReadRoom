'use client';
// lib/socket/client.ts
import { io, Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@/types';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;

export function getSocket(): AppSocket {
  if (!socket) {
    console.log('[socket] creating new socket instance');
    // Using an empty string/omitting the URL makes the socket use the current browser origin.
    // This is much more robust when switching between localhost and ngrok.
    socket = io({
      path: '/api/socket',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20_000,
      autoConnect: true, // Enable autoConnect for reliability
    });

    socket.on('connect', () => {
      console.info('[socket] connected', socket?.id);
    });
    socket.on('disconnect', (reason) => {
      console.warn('[socket] disconnected', reason);
    });
    socket.on('connect_error', (error) => {
      console.warn('[socket] connect error', error.message);
    });
    socket.io.on('reconnect_attempt', (attempt) => {
      console.info('[socket] reconnect attempt', attempt);
    });
    socket.io.on('reconnect_failed', () => {
      console.warn('[socket] reconnect failed');
    });
  }
  return socket;
}

export function connectSocket(): AppSocket {
  return getSocket();
}

export function disconnectSocket(): void {
  socket?.disconnect();
  socket = null;
}

// ── Mobile background reconnect ───────────────────────────────────────────────
// Mobile browsers suspend JS/WebSocket connections when the app is backgrounded.
// Socket.IO's built-in reconnect only fires after a TCP-level timeout, which can
// take minutes. Instead, actively reconnect as soon as the page regains visibility.
if (typeof window !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      const s = getSocket();
      if (!s.connected) {
        console.log('[socket] page became visible — reconnecting socket');
        s.connect();
      }
    }
  });

  window.addEventListener('focus', () => {
    const s = getSocket();
    if (!s.connected) {
      console.log('[socket] window focused — reconnecting socket');
      s.connect();
    }
  });
}
