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

