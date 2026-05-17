import { config } from 'dotenv';
import { resolve } from 'path';

// Load .env.local before anything else touches process.env
config({ path: resolve(process.cwd(), '.env.local') });

import { createServer } from 'http';
import { parse } from 'url';
import next from 'next';
import { Server } from 'socket.io';
import { Redis } from '@upstash/redis';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

const dev = process.env.NODE_ENV !== 'production';
const port = parseInt(process.env.PORT || '3000', 10);

const app = next({ dev });
const handle = app.getRequestHandler();

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const supabase = createSupabaseClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function normalizeOrigin() {
  return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
}

function sanitizeString(value: string, maxLength = 128) {
  return String(value || '').trim().slice(0, maxLength);
}

function stringToColor(str: string) {
  const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#06b6d4'];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function makeInitials(name: string) {
  return String(name || '')
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || 'RD';
}

async function hasOtherLibraryPresence(userId: string, libraryId?: string | null) {
  if (!libraryId) return false;
  const keys = await redis.keys(`presence:*:${userId}`);
  const records = await Promise.all(keys.map((key) => redis.get(key)));
  return records
    .filter(Boolean)
    .map((record) => {
      try {
        return typeof record === 'string' ? JSON.parse(record) : record;
      } catch {
        return null;
      }
    })
    .some((user: any) => user?.activeLibraryId === libraryId && user?.isActive !== false);
}

app.prepare().then(() => {
  const httpServer = createServer((req, res) => {
    if (!dev && req.headers['x-forwarded-proto'] === 'http') {
      const host = req.headers.host;
      if (host) {
        res.writeHead(301, { Location: `https://${host}${req.url}` });
        res.end();
        return;
      }
    }

    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  const io = new Server(httpServer, {
    path: '/api/socket',
    cors: {
      origin: normalizeOrigin(),
      methods: ['GET', 'POST'],
    },
    // Relaxed timeouts for stable connections over tunnels (ngrok)
    pingTimeout: 30_000,
    pingInterval: 15_000,
    maxHttpBufferSize: 16_384,
  });

  io.on('connection', (socket) => {
    console.log(`[socket] connected: ${socket.id}`);

    socket.on('room:join', async ({ roomId, user }) => {
      if (!roomId || !user?.userId) return;
      const cleanRoomId = sanitizeString(roomId, 64);
      const cleanUserId = sanitizeString(user.userId, 64);
      const cleanUserName = sanitizeString(user.userName ?? 'Reader', 64);

      const presenceMeta = {
        userId: cleanUserId,
        userName: cleanUserName,
        avatarColor: user.avatarColor || stringToColor(cleanUserId),
        avatarInitials: user.avatarInitials || makeInitials(cleanUserName),
        joinedAt: user.joinedAt ?? Date.now(),
        isFollowing: false,
        page: user.page ?? 1,
        scroll: user.scroll ?? 0,
        zoom: user.zoom ?? 1,
        activePdfId: user.activePdfId ?? null,
        activePdfName: sanitizeString(user.activePdfName ?? '', 256) || null,
        activeLibraryId: sanitizeString(user.activeLibraryId ?? '', 64) || null,
        currentRoomId: cleanRoomId,
        currentRoomName: sanitizeString(user.currentRoomName ?? '', 128) || null,
        isActive: true,
        lastSeen: Date.now(),
      };

      socket.data.roomId = cleanRoomId;
      socket.data.userId = cleanUserId;
      socket.data.userName = cleanUserName;
      socket.data.libraryId = presenceMeta.activeLibraryId;

      await socket.join(cleanRoomId);
      if (presenceMeta.activeLibraryId) await socket.join(`library:${presenceMeta.activeLibraryId}`);
      
      // Critical: Wait for current user to be added to the set before fetching the list
      await Promise.all([
        redis.set(`presence:${cleanRoomId}:${cleanUserId}`, JSON.stringify(presenceMeta), { ex: 60 }),
        redis.sadd(`room:members:${cleanRoomId}`, cleanUserId),
        redis.expire(`room:members:${cleanRoomId}`, 60)
      ]);

      // Get room members from set (now guaranteed to include self)
      const memberIds = await redis.smembers(`room:members:${cleanRoomId}`);
      const presenceData = await Promise.all(memberIds.map((uid) => redis.get(`presence:${cleanRoomId}:${uid}`)));
      
      const users = presenceData
        .filter(Boolean)
        .map((item) => {
          try {
            return typeof item === 'string' ? JSON.parse(item) : item;
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      let libraryUsers: any[] = [];
      if (presenceMeta.activeLibraryId) {
        const libraryKeys = await redis.keys('presence:*:*');
        const libraryPresence = await Promise.all(libraryKeys.map((key) => redis.get(key)));
        libraryUsers = libraryPresence
          .filter(Boolean)
          .map((item) => {
            try {
              return typeof item === 'string' ? JSON.parse(item) : item;
            } catch {
              return null;
            }
          })
          .filter((item: any) => item?.activeLibraryId === presenceMeta.activeLibraryId);
      }

      // Async fetch sync state
      redis.get(`room:sync:${cleanRoomId}`).then(syncState => {
        if (syncState) {
          try {
            const parsed = typeof syncState === 'string' ? JSON.parse(syncState) : syncState;
            socket.emit('sync:state', parsed);
          } catch {}
        }
      }).catch(() => {});

      const presenceByTab = new Map<string, any>();
      [...users, ...libraryUsers].forEach((presence) => {
        if (presence?.userId) presenceByTab.set(presence.userId, presence);
      });

      socket.emit('presence:list', Array.from(presenceByTab.values()));
      socket.to(cleanRoomId).emit('presence:join', presenceMeta);
      if (presenceMeta.activeLibraryId) socket.to(`library:${presenceMeta.activeLibraryId}`).emit('presence:update', presenceMeta);

      // Notify others this user joined (for notifications)
      const joinActivity = {
        id: `presence:join:${cleanUserId}:${Date.now()}`,
        roomId: cleanRoomId,
        type: 'presence:join' as const,
        title: `${cleanUserName} joined the room`,
        body: cleanUserName,
        userId: cleanUserId,
        userName: cleanUserName,
        ts: Date.now(),
      };
      socket.to(cleanRoomId).emit('notification:activity', joinActivity);
    });

    socket.on('presence:update', async ({ roomId, user }) => {
      if (!roomId || !user?.userId) return;
      const cleanRoomId = sanitizeString(roomId, 64);
      const cleanUserId = sanitizeString(user.userId, 64);
      
      // Name Protection: Don't let "Reader" overwrite a real name
      const existingRaw = await redis.get(`presence:${cleanRoomId}:${cleanUserId}`);
      let existing: any = null;
      try { existing = existingRaw ? (typeof existingRaw === 'string' ? JSON.parse(existingRaw) : existingRaw) : null; } catch {}
      
      const newName = sanitizeString(user.userName ?? 'Reader', 64);
      const finalName = (newName === 'Reader' && existing?.userName && existing.userName !== 'Reader')
        ? existing.userName
        : newName;

      const page = Number.isInteger(Number(user.page)) && Number(user.page) >= 1 ? Number(user.page) : 1;
      const scroll = Number.isFinite(Number(user.scroll)) ? Math.min(1, Math.max(0, Number(user.scroll))) : 0;
      const zoom = Number.isFinite(Number(user.zoom)) ? Math.min(3, Math.max(0.5, Number(user.zoom))) : 1;

      const presencePayload = {
        userId: cleanUserId,
        userName: finalName,
        avatarColor: user.avatarColor || stringToColor(cleanUserId),
        avatarInitials: user.avatarInitials || makeInitials(finalName),
        joinedAt: user.joinedAt ?? Date.now(),
        isFollowing: user.isFollowing ?? false,
        page,
        scroll,
        zoom,
        activePdfId: user.activePdfId ? sanitizeString(user.activePdfId, 128) : null,
        activePdfName: user.activePdfName ? sanitizeString(user.activePdfName, 256) : null,
        activeLibraryId: sanitizeString(user.activeLibraryId ?? existing?.activeLibraryId ?? '', 64) || null,
        currentRoomId: sanitizeString(user.currentRoomId ?? existing?.currentRoomId ?? cleanRoomId, 64) || cleanRoomId,
        currentRoomName: sanitizeString(user.currentRoomName ?? existing?.currentRoomName ?? '', 128) || null,
        isActive: Boolean(user.isActive ?? true),
        lastSeen: Number(user.lastSeen ?? Date.now()),
      };

      // Don't await Redis, just broadcast immediately
      redis.set(`presence:${cleanRoomId}:${cleanUserId}`, JSON.stringify(presencePayload), { ex: 30 }).catch(() => {});
      socket.to(cleanRoomId).emit('presence:update', presencePayload);
      if (presencePayload.activeLibraryId) socket.to(`library:${presencePayload.activeLibraryId}`).emit('presence:update', presencePayload);
    });

    let lastSync = 0;
    socket.on('sync:state', async (payload: {
      roomId: string;
      userId: string;
      activePdfId?: string | null;
      activePdfName?: string | null;
      page: number;
      scroll: number;
      zoom: number;
      ts: number;
    }) => {
      const now = Date.now();
      if (now - lastSync < 80) return;
      lastSync = now;
      if (!payload.roomId || !payload.userId) return;

      const cleanRoomId = sanitizeString(payload.roomId, 64);
      const page = Number.isInteger(Number(payload.page)) && Number(payload.page) >= 1
        ? Number(payload.page)
        : 1;
      const scroll = Number.isFinite(Number(payload.scroll))
        ? Math.min(1, Math.max(0, Number(payload.scroll)))
        : 0;
      const zoom = Number.isFinite(Number(payload.zoom))
        ? Math.min(3, Math.max(0.5, Number(payload.zoom)))
        : 1;
      const syncPayload = {
        ...payload,
        roomId: cleanRoomId,
        page,
        scroll,
        zoom,
        activePdfId: payload.activePdfId ?? null,
        activePdfName: payload.activePdfName ?? null,
      };
      
      // Always emit to other users first for responsiveness
      socket.to(cleanRoomId).emit('sync:state', syncPayload);

      // Persistence in background
      Promise.all([
        redis.set(`room:sync:${cleanRoomId}`, JSON.stringify(syncPayload), { ex: 3600 }),
        supabase
          .from('rooms')
          .update({
            current_page: page,
            scroll_pct: scroll,
            zoom,
          })
          .eq('id', cleanRoomId)
      ]).catch(() => {});
    });

    socket.on('chat:message', async (payload: {
      id: string;
      roomId: string;
      userId: string;
      userName: string;
      avatarColor: string;
      avatarUrl?: string | null;
      content: string;
      ts: number;
    }) => {
      if (!payload.roomId || !payload.content) return;
      const cleanRoomId = sanitizeString(payload.roomId, 64);

      const message = {
        id: payload.id || crypto.randomUUID(),
        roomId: cleanRoomId,
        userId: sanitizeString(payload.userId, 64),
        userName: sanitizeString(payload.userName, 64),
        avatarColor: payload.avatarColor || '#6366f1',
        avatarUrl: payload.avatarUrl || null,
        content: sanitizeString(payload.content, 2000),
        ts: payload.ts || Date.now(),
      };

      // Broadcast message to all other users in room
      socket.to(cleanRoomId).emit('chat:message', message);

      // Notification activity for badges/toasts
      const activity = {
        id: `chat:${message.id}`,
        roomId: cleanRoomId,
        type: 'chat:message' as const,
        title: message.userName,
        body: message.content,
        userId: message.userId,
        userName: message.userName,
        ts: message.ts,
        metadata: { messageId: message.id },
      };
      socket.to(cleanRoomId).emit('notification:activity', activity);

      // Cache to Redis for fast recent-message lookup. Permanent storage happens
      // in the messages API before this socket event is emitted.
      Promise.all([
        redis.set(`message:${message.id}`, JSON.stringify(message), { ex: 7 * 24 * 60 * 60 }),
        redis.zadd(`messages:${cleanRoomId}`, { score: message.ts, member: message.id }),
        redis.expire(`messages:${cleanRoomId}`, 7 * 24 * 60 * 60),
      ]).catch(() => {});
    });

    socket.on('chat:typing', (payload: { roomId: string; userId: string; userName: string; typing: boolean; ts: number }) => {
      if (!payload.roomId) return;
      const cleanRoomId = sanitizeString(payload.roomId, 64);
      socket.to(cleanRoomId).emit('chat:typing', {
        roomId: cleanRoomId,
        userId: sanitizeString(payload.userId, 64),
        userName: sanitizeString(payload.userName, 64),
        typing: Boolean(payload.typing),
        ts: Number(payload.ts ?? Date.now()),
      });
    });

    // ── Profile updates: broadcast to all rooms the user is in ───────────────
    socket.on('profile:updated', async (payload: {
      userId: string;
      userName: string;
      avatarUrl: string | null;
      avatarColor: string;
      avatarInitials: string;
    }) => {
      if (!payload.userId) return;
      const cleanUserId = sanitizeString(payload.userId, 64);
      const cleanName = sanitizeString(payload.userName ?? 'Reader', 64);

      // Update Redis presence for this user in the current room
      if (socket.data.roomId) {
        const presenceKey = `presence:${socket.data.roomId}:${cleanUserId}`;
        const existing = await redis.get(presenceKey).catch(() => null);
        if (existing) {
          try {
            const parsed = typeof existing === 'string' ? JSON.parse(existing) : existing;
            const updated = {
              ...parsed,
              userName: cleanName,
              avatarColor: payload.avatarColor,
              avatarInitials: payload.avatarInitials,
            };
            await redis.set(presenceKey, JSON.stringify(updated), { ex: 60 }).catch(() => {});
          } catch {}
        }
        const profileUpdate = {
          userId: cleanUserId,
          userName: cleanName,
          avatarUrl: payload.avatarUrl,
          avatarColor: payload.avatarColor,
          avatarInitials: payload.avatarInitials,
        };

        // Broadcast canonical profile changes broadly; routine presence remains avatar-free.
        socket.to(socket.data.roomId).emit('profile:updated', profileUpdate);
        if (socket.data.libraryId) socket.to(`library:${socket.data.libraryId}`).emit('profile:updated', profileUpdate);
      }
    });

    // ── PDF Library events ── broadcast to all room members ──────────────────
    socket.on('pdf:added', async (activity: any) => {
      if (!activity?.roomId) return;
      const cleanRoomId = sanitizeString(activity.roomId, 64);
      // Forward to all other room members so their library updates instantly
      socket.to(cleanRoomId).emit('pdf:added', activity);
      // Also forward as notification for in-app toasts/badges
      socket.to(cleanRoomId).emit('notification:activity', {
        ...activity,
        id: activity.id || `pdf:added:${Date.now()}`,
        type: 'pdf:added',
      });
    });

    socket.on('library:updated', async (activity: any) => {
      if (!activity?.roomId) return;
      const cleanRoomId = sanitizeString(activity.roomId, 64);
      // Forward to all other room members
      socket.to(cleanRoomId).emit('library:updated', activity);
    });

    // ── Notification activity (generic) ──────────────────────────────────────
    socket.on('notification:activity', async (activity: any) => {
      if (!activity?.roomId) return;
      const cleanRoomId = sanitizeString(activity.roomId, 64);
      socket.to(cleanRoomId).emit('notification:activity', activity);
    });

    socket.on('presence:ping', async ({ roomId, userId }: { roomId: string; userId: string }) => {
      if (!roomId || !userId) return;
      const cleanRoomId = sanitizeString(roomId, 64);
      const cleanUserId = sanitizeString(userId, 64);
      Promise.all([
        redis.expire(`presence:${cleanRoomId}:${cleanUserId}`, 60),
        redis.sadd(`room:members:${cleanRoomId}`, cleanUserId),
        redis.expire(`room:members:${cleanRoomId}`, 60)
      ]).catch(() => {});
    });

    socket.on('room:leave', async ({ roomId, userId }: { roomId: string; userId: string }) => {
      if (!roomId || !userId) return;
      const cleanRoomId = sanitizeString(roomId, 64);
      const cleanUserId = sanitizeString(userId, 64);
      const presenceKey = `presence:${cleanRoomId}:${cleanUserId}`;
      const existing = await redis.get(presenceKey).catch(() => null);
      let leavingUser: any = null;
      try { leavingUser = existing ? (typeof existing === 'string' ? JSON.parse(existing) : existing) : null; } catch {}
      
      Promise.all([
        redis.del(presenceKey),
        redis.srem(`room:members:${cleanRoomId}`, cleanUserId)
      ]).catch(() => {});

      setTimeout(async () => {
        const stillOnline = await hasOtherLibraryPresence(cleanUserId, leavingUser?.activeLibraryId);
        if (stillOnline) return;
        io.to(cleanRoomId).emit('presence:left', { userId: cleanUserId });
        if (leavingUser?.activeLibraryId) io.to(`library:${leavingUser.activeLibraryId}`).emit('presence:left', { userId: cleanUserId });
      }, 1200);
      socket.leave(cleanRoomId);
      if (leavingUser?.activeLibraryId) socket.leave(`library:${leavingUser.activeLibraryId}`);
    });

    socket.on('disconnect', async () => {
      const { roomId, userId, userName } = socket.data;
      if (roomId && userId) {
        const presenceKey = `presence:${roomId}:${userId}`;
        const existing = await redis.get(presenceKey).catch(() => null);
        let leavingUser: any = null;
        try { leavingUser = existing ? (typeof existing === 'string' ? JSON.parse(existing) : existing) : null; } catch {}
        Promise.all([
          redis.del(presenceKey),
          redis.srem(`room:members:${roomId}`, userId)
        ]).catch(() => {});
        setTimeout(async () => {
          const stillOnline = await hasOtherLibraryPresence(userId, leavingUser?.activeLibraryId);
          if (stillOnline) return;
          io.to(roomId).emit('presence:left', { userId });
          if (leavingUser?.activeLibraryId) io.to(`library:${leavingUser.activeLibraryId}`).emit('presence:left', { userId });
        }, 1200);
      }
      console.log(`[socket] disconnected: ${socket.id}`);
    });
  });

  httpServer.listen(port, () => {
    console.log(`> Ready on ${normalizeOrigin()}`);
  });
});
