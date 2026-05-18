// lib/backend/push.ts
// Reusable, non-blocking backend push notification pipeline.
// Safe to import in both standalone Node context (server.ts) and Next.js context.

import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';
import { redis } from '@/lib/redis/client';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

// Initialize vanilla service-role Supabase client (safe for standalone node environment)
const supabaseAdmin = (supabaseUrl && serviceRoleKey)
  ? createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  : null;

const vapidPublicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || '';
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY || '';

if (vapidPublicKey && vapidPrivateKey) {
  webpush.setVapidDetails(
    'mailto:support@readroom.app',
    vapidPublicKey,
    vapidPrivateKey
  );
}

export interface PushNotificationPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  data: {
    url: string;
    roomId: string;
    libraryId?: string;
    isCall?: boolean;
    senderName?: string;
    notificationType: 'message' | 'mention' | 'reply' | 'call' | 'pdf_added';
    [key: string]: any;
  };
}

/**
 * Dispatches a push notification to a specific user on all their active subscriptions.
 * Automatically cleans up stale subscriptions asynchronously if push services return 404 or 410.
 */
export async function triggerPushNotificationToUser(
  userId: string,
  payload: PushNotificationPayload
): Promise<void> {
  if (!supabaseAdmin) {
    console.warn('[PushService] Supabase admin client not initialized.');
    return;
  }

  try {
    // 1. Fetch user's subscriptions
    const { data: subscriptions, error } = await supabaseAdmin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', userId);

    if (error) {
      console.error(`[PushService] Failed to fetch subscriptions for user ${userId}:`, error.message);
      return;
    }

    if (!subscriptions || subscriptions.length === 0) {
      return; // No active subscriptions registered for this user
    }

    // 2. Dispatch push to all active endpoints asynchronously
    const sendPromises = subscriptions.map(async (sub) => {
      const pushSubscription = {
        endpoint: sub.endpoint,
        keys: {
          p256dh: sub.p256dh,
          auth: sub.auth,
        },
      };

      try {
        await webpush.sendNotification(pushSubscription, JSON.stringify(payload));
      } catch (err: any) {
        // 3. Stale subscription cleanup: 404 (Not Found) or 410 (Gone) indicates expired/invalid endpoint
        if (err.statusCode === 404 || err.statusCode === 410) {
          console.info(`[PushService] Stale subscription detected (status ${err.statusCode}). Deleting...`, sub.endpoint);
          
          // Fire-and-forget delete from database
          supabaseAdmin
            .from('push_subscriptions')
            .delete()
            .eq('id', sub.id)
            .then(({ error: delError }) => {
              if (delError) console.error('[PushService] Failed to delete stale subscription:', delError.message);
            });
        } else {
          console.error('[PushService] Error dispatching push notification:', err.message || err);
        }
      }
    });

    // Run all pushes concurrently in a non-blocking way
    await Promise.all(sendPromises);
  } catch (err) {
    console.error('[PushService] General push dispatch error:', err);
  }
}

/**
 * Asynchronously sends a push notification to all participants of a room/library
 * who are offline, backgrounded, or unfocused (implements focus deduplication).
 * Completely safe to trigger inside Socket.IO callbacks because it is non-blocking.
 */
export function sendPushToRoomParticipants(
  roomId: string,
  senderId: string,
  payload: PushNotificationPayload,
  isCallNotification = false
): void {
  // Fire-and-forget: immediately return so Socket.IO handlers are never blocked
  (async () => {
    if (!supabaseAdmin) return;

    try {
      // 1. Resolve library ID and room name from rooms table
      const { data: room, error: roomError } = await supabaseAdmin
        .from('rooms')
        .select('library_id, name')
        .eq('id', roomId)
        .maybeSingle();

      if (roomError || !room) {
        console.warn(`[PushService] Could not resolve room ${roomId} for push dispatching`);
        return;
      }

      const libraryId = room.library_id;

      // 2. Fetch all members of the library
      const { data: members, error: membersError } = await supabaseAdmin
        .from('library_members')
        .select('user_id')
        .eq('library_id', libraryId);

      if (membersError || !members) {
        console.warn(`[PushService] Could not fetch members for library ${libraryId}`);
        return;
      }

      // Filter out the sender
      const recipientIds = members
        .map((m) => m.user_id)
        .filter((uid) => uid !== senderId);

      if (recipientIds.length === 0) return;

      // 3. For each recipient, check focus state in Redis and dispatch if applicable
      await Promise.all(
        recipientIds.map(async (userId) => {
          // Check Redis active presence
          const presenceRaw = await redis.get(`presence:${roomId}:${userId}`);
          if (presenceRaw) {
            try {
              const presence = typeof presenceRaw === 'string' ? JSON.parse(presenceRaw) : presenceRaw;
              
              // Safeguard focus state: if user is online in the room and is actively focused,
              // do NOT trigger duplicate push notification alerts.
              if (presence && presence.isFocused === true && !isCallNotification) {
                return; 
              }
            } catch (jsonErr) {
              console.warn('[PushService] Error parsing presence data:', jsonErr);
            }
          }

          // Trigger push to the unfocused/offline user
          await triggerPushNotificationToUser(userId, {
            ...payload,
            title: payload.title.replace('#Room', `#${room.name}`),
            data: {
              ...payload.data,
              libraryId,
            },
          });
        })
      );
    } catch (err) {
      console.error('[PushService] Error in async push distribution loop:', err);
    }
  })().catch((err) => {
    console.error('[PushService] Uncaught error in fire-and-forget async wrapper:', err);
  });
}
