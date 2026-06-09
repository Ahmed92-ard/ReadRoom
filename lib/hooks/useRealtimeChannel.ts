'use client';

// useRealtimeChannel.ts — Creates and manages a single Supabase Realtime broadcast
// channel per room. This replaces the Socket.io connection for all broadcast events.
//
// The channel is stored in module-level cache so the SAME instance is shared
// across every hook/component that calls useRealtimeChannel for the same roomId.

import { useEffect, useRef } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

type BroadcastEventName =
  | 'sync:state'
  | 'pdf:added'
  | 'library:updated'
  | 'notification:activity'
  | 'chat:message'
  | 'chat:update'
  | 'chat:delete'
  | 'chat:reaction'
  | 'chat:delivered'
  | 'chat:read'
  | 'chat:typing'
  | 'profile:updated';

// Module-level cache: roomId → { channel, refCount }
const channelCache = new Map<string, { channel: RealtimeChannel; refCount: number }>();

/**
 * Returns a stable, shared Supabase Realtime broadcast channel for the given roomId.
 * The channel is reference-counted and cleaned up when no consumers remain.
 */
export function useRealtimeChannel(roomId: string): RealtimeChannel | null {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const roomIdRef = useRef(roomId);

  useEffect(() => {
    const supabase = createClient();
    const channelName = `room-broadcast:${roomId}`;

    let entry = channelCache.get(roomId);
    if (!entry) {
      const channel = supabase.channel(channelName, {
        config: { broadcast: { self: false } },
      });
      channel.subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          console.warn(`[realtime] broadcast channel error for room ${roomId}`);
        }
      });
      entry = { channel, refCount: 0 };
      channelCache.set(roomId, entry);
    }

    entry.refCount++;
    channelRef.current = entry.channel;
    roomIdRef.current = roomId;

    return () => {
      const cached = channelCache.get(roomId);
      if (!cached) return;
      cached.refCount--;
      if (cached.refCount <= 0) {
        supabase.removeChannel(cached.channel).catch(() => {});
        channelCache.delete(roomId);
      }
      channelRef.current = null;
    };
  }, [roomId]);

  return channelRef.current;
}

/**
 * Convenience: broadcast a typed event on the room channel.
 * Safe to call even if the channel is null (no-op).
 */
export function broadcastEvent(
  channel: RealtimeChannel | null,
  event: BroadcastEventName,
  payload: Record<string, unknown>
) {
  if (!channel) return;
  channel.send({ type: 'broadcast', event, payload }).catch(() => {});
}

/**
 * Convenience: subscribe to a broadcast event on a channel.
 * Returns an unsubscribe function.
 */
export function onBroadcast(
  channel: RealtimeChannel | null,
  event: BroadcastEventName,
  handler: (payload: any) => void
): () => void {
  if (!channel) return () => {};
  channel.on('broadcast', { event }, ({ payload }) => handler(payload));
  return () => {
    // Supabase doesn't support removing individual broadcast listeners;
    // the whole channel is cleaned up via useRealtimeChannel's refcount.
  };
}
