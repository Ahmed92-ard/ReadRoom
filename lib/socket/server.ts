// lib/socket/server.ts
import { Server as HTTPServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents, SyncPayload, ChatMessage, RoomActivity } from '@/types';
import { Redis } from '@upstash/redis';

// Use the same redis client as elsewhere
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

declare global {
  // eslint-disable-next-line no-var
  var __io: SocketServer<ClientToServerEvents, ServerToClientEvents> | undefined;
}

const PRESENCE_TTL = 30; // seconds

async function hasOtherLibraryPresence(userId: string, libraryId?: string | null) {
  if (!libraryId) return false;
  const keys = await redis.keys(`presence:*:${userId}`);
  const records = await Promise.all(keys.map((key) => redis.get(key)));
  return records
    .filter(Boolean)
    .map((record) => (typeof record === 'string' ? JSON.parse(record) : record))
    .some((user: any) => user?.activeLibraryId === libraryId && user?.isActive !== false);
}

export function initSocketServer(httpServer: HTTPServer) {
  if (global.__io) return global.__io;

  const io = new SocketServer<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    path: '/api/socket',
    cors: { origin: process.env.NEXT_PUBLIC_APP_URL, methods: ['GET', 'POST'] },
    pingTimeout: 20_000,
    pingInterval: 10_000,
    maxHttpBufferSize: 1e4, // 10KB max message
  });

  io.on('connection', (socket) => {
    let currentRoom: string | null = null;
    let currentUserId: string | null = null;
    let currentLibraryRoom: string | null = null;

    socket.on('room:join', async ({ roomId, user }) => {
      currentRoom = roomId;
      currentUserId = user.userId;

      await socket.join(roomId);

      // Store presence in Redis with TTL (Upstash compatible)
      const presenceKey = `presence:${roomId}:${user.userId}`;
      await redis.set(presenceKey, JSON.stringify(user), { ex: PRESENCE_TTL });
      const nextLibraryRoom = user.activeLibraryId ? `library:${user.activeLibraryId}` : null;
      if (currentLibraryRoom && currentLibraryRoom !== nextLibraryRoom) await socket.leave(currentLibraryRoom);
      if (nextLibraryRoom) await socket.join(nextLibraryRoom);
      currentLibraryRoom = nextLibraryRoom;

      // Get all current presence for this room
      const keys = await redis.keys(`presence:${roomId}:*`);
      const presenceData = await Promise.all(
        keys.map((k) => redis.get(k))
      );
      const users = presenceData
        .filter(Boolean)
        .map((d) => (typeof d === 'string' ? JSON.parse(d) : d));
      let libraryUsers: any[] = [];
      if (user.activeLibraryId) {
        const libraryPresenceKeys = await redis.keys('presence:*:*');
        const libraryPresenceData = await Promise.all(libraryPresenceKeys.map((k) => redis.get(k)));
        libraryUsers = libraryPresenceData
          .filter(Boolean)
          .map((d) => (typeof d === 'string' ? JSON.parse(d) : d))
          .filter((u: any) => u?.activeLibraryId === user.activeLibraryId);
      }

      // Send full room state to joiner
      const roomState = await redis.get(`room:state:${roomId}`);
      if (roomState) {
        socket.emit('sync:state', typeof roomState === 'string' ? JSON.parse(roomState) : roomState);
      }

      const presenceByTab = new Map<string, any>();
      [...users, ...libraryUsers].forEach((presence) => {
        if (presence?.userId) presenceByTab.set(presence.userId, presence);
      });

      // Send current library-wide presence list to joiner
      socket.emit('presence:list', Array.from(presenceByTab.values()));

      // Announce new user to rest of room
      socket.to(roomId).emit('presence:join', user);
      if (user.activeLibraryId) socket.to(`library:${user.activeLibraryId}`).emit('presence:update', user);
      socket.to(roomId).emit('notification:activity', {
        id: `presence:join:${roomId}:${user.userId}:${Math.floor(Date.now() / 5000)}`,
        roomId,
        type: 'presence:join',
        title: `${user.userName || 'Someone'} joined`,
        userId: user.userId,
        userName: user.userName,
        ts: Date.now(),
      });
    });

    socket.on('presence:update', async ({ roomId, user }) => {
      if (!currentRoom || roomId !== currentRoom || !user.userId) return;

      const nextUser = {
        ...user,
        lastSeen: Date.now(),
      };

      const presenceKey = `presence:${roomId}:${user.userId}`;
      const existing = await redis.get(presenceKey);
      const previous = existing
        ? (typeof existing === 'string' ? JSON.parse(existing) : existing)
        : {};
      const merged = { ...previous, ...nextUser };

      await redis.set(presenceKey, JSON.stringify(merged), { ex: PRESENCE_TTL });
      socket.to(roomId).emit('presence:update', merged);
      if (merged.activeLibraryId) socket.to(`library:${merged.activeLibraryId}`).emit('presence:update', merged);
    });

    socket.on('sync:state', async (payload: SyncPayload) => {
      if (!currentRoom) return;

      // Broadcast to room (excluding sender)
      socket.to(currentRoom).emit('sync:state', payload);

      // Persist room state to Redis (for latecomers)
      const stateKey = `room:sync:${currentRoom}`;
      await redis.set(stateKey, JSON.stringify({
        page: payload.page,
        scroll: payload.scroll,
        zoom: payload.zoom,
        activePdfId: payload.activePdfId ?? null,
        activePdfName: payload.activePdfName ?? null,
        updatedAt: payload.ts,
      }), { ex: 3600 });
    });

    socket.on('chat:message', async (payload: ChatMessage) => {
      if (!currentRoom) {
        console.warn('[socket] chat:message received without room context');
        return;
      }

      try {
        const message: ChatMessage = {
          ...payload,
          id: payload.id || crypto.randomUUID(),
          ts: payload.ts || Date.now(),
        };

        // Persist to Redis (Upstash compatible)
        await redis.set(`message:${message.id}`, JSON.stringify(message), { ex: 7 * 24 * 60 * 60 });
        await redis.zadd(`messages:${currentRoom}`, { score: message.ts, member: message.id });

        // Broadcast to room only (not all connected clients)
        io.to(currentRoom).emit('chat:message', message);
        const activity: RoomActivity = {
          id: `chat:message:${message.id}`,
          roomId: currentRoom,
          type: 'chat:message',
          title: message.userName || 'New message',
          body: message.content,
          userId: message.userId,
          userName: message.userName,
          ts: message.ts,
          metadata: { messageId: message.id },
        };
        io.to(currentRoom).emit('notification:activity', activity);
      } catch (error) {
        console.error('[socket] chat:message failed:', error);
      }
    });

    socket.on('chat:update', (payload) => {
      const targetRoom = currentRoom ?? payload.roomId;
      if (!targetRoom || payload.roomId !== targetRoom) return;
      socket.to(targetRoom).emit('chat:update', payload);
    });

    socket.on('chat:delete', (payload) => {
      const targetRoom = currentRoom ?? payload.roomId;
      if (!targetRoom || payload.roomId !== targetRoom) return;
      socket.to(targetRoom).emit('chat:delete', payload);
    });

    socket.on('chat:typing', (payload) => {
      const targetRoom = currentRoom ?? payload.roomId;
      if (!targetRoom || payload.roomId !== targetRoom) return;
      socket.to(targetRoom).emit('chat:typing', {
        ...payload,
        ts: payload.ts || Date.now(),
      });
    });

    socket.on('chat:reaction', (payload) => {
      const targetRoom = currentRoom ?? payload.roomId;
      if (!targetRoom || payload.roomId !== targetRoom) return;
      socket.to(targetRoom).emit('chat:reaction', payload);
    });

    socket.on('chat:delivered', (payload) => {
      const targetRoom = currentRoom ?? payload.roomId;
      if (!targetRoom || payload.roomId !== targetRoom) return;
      socket.to(targetRoom).emit('chat:delivered', payload);
    });

    socket.on('chat:read', (payload) => {
      const targetRoom = currentRoom ?? payload.roomId;
      if (!targetRoom || payload.roomId !== targetRoom) return;
      socket.to(targetRoom).emit('chat:read', payload);
    });

    socket.on('pdf:added', async (payload: RoomActivity) => {
      if (currentRoom && payload.roomId !== currentRoom) return;
      const targetRoom = currentRoom ?? payload.roomId;
      const activity: RoomActivity = {
        ...payload,
        id: payload.id || `pdf:added:${targetRoom}:${Date.now()}`,
        type: 'pdf:added',
        ts: payload.ts || Date.now(),
      };
      socket.to(targetRoom).emit('pdf:added', activity);
      socket.to(targetRoom).emit('library:updated', activity);
      socket.to(targetRoom).emit('notification:activity', activity);
    });

    socket.on('library:updated', async (payload: RoomActivity) => {
      if (currentRoom && payload.roomId !== currentRoom) return;
      const targetRoom = currentRoom ?? payload.roomId;
      const activity: RoomActivity = {
        ...payload,
        id: payload.id || `library:updated:${targetRoom}:${Date.now()}`,
        ts: payload.ts || Date.now(),
      };
      socket.to(targetRoom).emit('library:updated', activity);
      socket.to(targetRoom).emit('notification:activity', activity);
    });

    socket.on('notification:activity', async (payload: RoomActivity) => {
      if (currentRoom && payload.roomId !== currentRoom) return;
      const targetRoom = currentRoom ?? payload.roomId;
      socket.to(targetRoom).emit('notification:activity', {
        ...payload,
        id: payload.id || `room:activity:${targetRoom}:${Date.now()}`,
        ts: payload.ts || Date.now(),
      });
    });

    socket.on('presence:ping', async ({ roomId, userId }) => {
      const key = `presence:${roomId}:${userId}`;
      await redis.expire(key, PRESENCE_TTL);
    });

    socket.on('room:leave', async ({ roomId, userId }) => {
      const presenceKey = `presence:${roomId}:${userId}`;
      const existing = await redis.get(presenceKey);
      const leavingUser = existing
        ? (typeof existing === 'string' ? JSON.parse(existing) : existing)
        : null;
      await redis.del(`presence:${roomId}:${userId}`);
      setTimeout(async () => {
        const stillOnline = await hasOtherLibraryPresence(userId, leavingUser?.activeLibraryId);
        if (stillOnline) return;
        io.to(roomId).emit('presence:left', { userId });
        if (leavingUser?.activeLibraryId) io.to(`library:${leavingUser.activeLibraryId}`).emit('presence:left', { userId });
        io.to(roomId).emit('notification:activity', {
          id: `presence:left:${roomId}:${userId}:${Math.floor(Date.now() / 5000)}`,
          roomId,
          type: 'presence:left',
          title: 'User left',
          userId,
          ts: Date.now(),
        });
      }, 1200);
      await socket.leave(roomId);
      if (currentRoom === roomId && currentUserId === userId) {
        if (currentLibraryRoom) await socket.leave(currentLibraryRoom);
        currentRoom = null;
        currentUserId = null;
        currentLibraryRoom = null;
      }
    });

    socket.on('disconnect', async () => {
      if (currentRoom && currentUserId) {
        const presenceKey = `presence:${currentRoom}:${currentUserId}`;
        const existing = await redis.get(presenceKey);
        const leavingUser = existing
          ? (typeof existing === 'string' ? JSON.parse(existing) : existing)
          : null;
        await redis.del(presenceKey);
        const roomId = currentRoom;
        const userId = currentUserId;
        setTimeout(async () => {
          const stillOnline = await hasOtherLibraryPresence(userId, leavingUser?.activeLibraryId);
          if (stillOnline) return;
          io.to(roomId).emit('presence:left', { userId });
          if (leavingUser?.activeLibraryId) io.to(`library:${leavingUser.activeLibraryId}`).emit('presence:left', { userId });
          io.to(roomId).emit('notification:activity', {
            id: `presence:left:${roomId}:${userId}:${Math.floor(Date.now() / 5000)}`,
            roomId,
            type: 'presence:left',
            title: 'User left',
            userId,
            ts: Date.now(),
          });
        }, 1200);
      }
    });
  });

  global.__io = io;
  return io;
}
