'use client';

import React, { useState } from 'react';
import { Camera } from 'lucide-react';
import { usePresenceStore } from '@/store/presenceStore';
import { usePDFStore } from '@/store/pdfStore';
import { Avatar } from '@/components/ui/Avatar';
import { AvatarUpload } from '@/components/ui/AvatarUpload';
import { getSocket } from '@/lib/socket/client';
import type { UserMeta } from '@/types';

function formatLastSeen(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

interface PresenceListProps {
  roomId?: string;
  roomName?: string;
}

export function PresenceList({ roomId, roomName = 'ReadRoom' }: PresenceListProps) {
  const { users: usersMap, self, updateSelf } = usePresenceStore();
  const { followMode, followTarget, setFollowMode } = usePDFStore();
  const [showAvatarUpload, setShowAvatarUpload] = useState(false);

  const handleAvatarUploaded = (url: string) => {
    // Update local state immediately
    updateSelf({ avatarUrl: url });
    const currentSelf = usePresenceStore.getState().self;
    // Broadcast to all connected clients in the room
    if (currentSelf && roomId) {
      getSocket().emit('profile:updated', {
        userId: currentSelf.userId,
        userName: currentSelf.userName,
        avatarUrl: url,
        avatarColor: currentSelf.avatarColor,
        avatarInitials: currentSelf.avatarInitials,
      });
      getSocket().emit('presence:update', {
        roomId,
        user: { userId: currentSelf.userId },
      });
    }
  };

  // Group all sessions (including self) by base userId
  const grouped = Array.from([
    ...(self ? [self] : []),
    ...Array.from(usersMap.values())
  ]).reduce((acc, user) => {
    const baseId = user.userId.split('_')[0];
    const existing = acc.get(baseId);

    if (!existing) {
      acc.set(baseId, { ...user });
    } else {
      const isActive = existing.isActive || user.isActive;
      // Priority: Active tabs over offline, newer active over older active
      const useNewData = (user.isActive && !existing.isActive) || 
                        (user.isActive && (user.lastSeen ?? 0) > (existing.lastSeen ?? 0));
      
      acc.set(baseId, {
        ...existing,
        isActive,
        lastSeen: Math.max(existing.lastSeen ?? 0, user.lastSeen ?? 0),
        avatarUrl: user.avatarUrl ?? existing.avatarUrl,
        activeLibraryId: user.activeLibraryId ?? existing.activeLibraryId,
        currentRoomId: user.currentRoomId ?? existing.currentRoomId,
        currentRoomName: user.currentRoomName ?? existing.currentRoomName,
        ...(useNewData ? {
          userId: user.userId, 
          page: user.page,
          scroll: user.scroll,
          zoom: user.zoom,
          activePdfId: user.activePdfId,
          activePdfName: user.activePdfName,
          userName: user.userName,
          activeLibraryId: user.activeLibraryId,
          currentRoomId: user.currentRoomId,
          currentRoomName: user.currentRoomName,
        } : {}),
      });
    }
    return acc;
  }, new Map<string, UserMeta>());

  const selfBaseId = self?.userId.split('_')[0];
  const all = Array.from(grouped.values()).sort((a, b) => {
    const aBaseId = a.userId.split('_')[0];
    const bBaseId = b.userId.split('_')[0];
    if (aBaseId === selfBaseId) return -1;
    if (bBaseId === selfBaseId) return 1;
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return (b.lastSeen ?? 0) - (a.lastSeen ?? 0);
  });

  return (
    <div className="flex flex-col h-full bg-room-surface">
      {showAvatarUpload && self && (
        <AvatarUpload
          currentUrl={self.avatarUrl}
          currentColor={self.avatarColor}
          currentInitials={self.avatarInitials}
          onUploaded={handleAvatarUploaded}
          onClose={() => setShowAvatarUpload(false)}
        />
      )}

      <div className="flex-1 p-3 space-y-1 overflow-y-auto">
      <p className="px-2 pb-2 text-sm font-semibold text-room-text truncate">{roomName}</p>

      {followMode && (
        <div className="px-3 py-2 mb-4 rounded-xl bg-blue-500/10 border border-blue-500/30 flex items-center justify-between animate-in fade-in slide-in-from-top-1">
          <span className="text-xs text-blue-400 font-medium">📍 Following mode on</span>
          <button
            onClick={() => setFollowMode(false)}
            className="text-[11px] text-blue-400 hover:text-white transition-colors"
          >
            Stop
          </button>
        </div>
      )}

      <div className="space-y-1">
        {all.map((user) => (
          <div 
            key={user.userId} 
            className={`flex items-center gap-3 p-2.5 rounded-xl transition-all duration-200 ${
              user.isActive ? 'hover:bg-room-hover' : 'opacity-60 grayscale-[0.5]'
            }`}
          >
            <div className="relative">
              {user.userId.split('_')[0] === self?.userId.split('_')[0] ? (
                <button
                  onClick={() => setShowAvatarUpload(true)}
                  className="relative group/av focus:outline-none"
                  title="Edit profile photo"
                >
                  <Avatar user={user} size="md" showTooltip={false} />
                  <div className="absolute inset-0 rounded-full bg-black/40 flex items-center justify-center opacity-0 group-hover/av:opacity-100 transition-opacity">
                    <Camera size={12} className="text-white" />
                  </div>
                </button>
              ) : (
                <Avatar user={user} size="md" showTooltip={false} />
              )}
              <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-room-surface ${
                user.isActive ? 'bg-green-500' : 'bg-gray-500'
              }`} />
            </div>
            
            <div className="flex-1 min-w-0">
              <p className="flex min-w-0 items-baseline gap-1 text-sm font-medium text-room-text">
                <span className="truncate">
                  {user.userName}
                  {user.userId.split('_')[0] === self?.userId.split('_')[0] && (
                    <span className="ml-1 text-[10px] text-room-muted">(you)</span>
                  )}
                </span>
                {user.isActive && user.currentRoomName && (
                  <span className="min-w-0 truncate text-xs font-normal text-room-muted">- {user.currentRoomName}</span>
                )}
              </p>
              <p className="text-[11px] mt-0.5 flex items-center gap-1.5">
                {user.isActive ? (
                  <>
                    <span className="text-green-400">Active</span>
                    {(user.activePdfName || user.page) && <span className="text-room-muted">·</span>}
                    {(user.activePdfName || user.page) && (
                      <span className="text-room-muted truncate">
                        {user.activePdfName ? `${user.activePdfName} · ` : ''}page {user.page ?? 1}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-room-muted truncate">
                    Offline · {typeof user.lastSeen === 'number' ? formatLastSeen(user.lastSeen) : 'recently'}
                  </span>
                )}
              </p>
            </div>

            {user.isActive && user.userId.split('_')[0] !== self?.userId.split('_')[0] && (
              <div className="flex items-center gap-1">
                {user.activePdfId && (
                  <button
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent('readroom:open-pdf', {
                        detail: { pdfId: user.activePdfId, userName: user.userName },
                      }));
                    }}
                    className="text-xs px-3 py-2 rounded-xl transition-all duration-200 font-medium text-room-muted hover:text-room-text hover:bg-room-hover"
                  >
                    Open
                  </button>
                )}
                <button
                  onClick={() => {
                    const isTarget = followTarget === user.userId;
                    setFollowMode(!isTarget || !followMode, isTarget ? null : user.userId);
                  }}
                  className={`text-xs px-4 py-2 rounded-xl transition-all duration-200 font-medium ${
                    followMode && followTarget === user.userId
                      ? 'bg-blue-500 text-white shadow-lg shadow-blue-500/20'
                      : 'text-room-muted hover:text-blue-400 hover:bg-room-hover'
                  }`}
                >
                  {followMode && followTarget === user.userId ? 'Following' : 'Follow'}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {all.length <= 1 && (
        <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
          <div className="w-12 h-12 rounded-full bg-room-surface flex items-center justify-center text-xl mb-3">
            👋
          </div>
          <p className="text-xs text-room-muted leading-relaxed">
            Invite others to this room to read together!
          </p>
        </div>
      )}
      </div>
    </div>
  );
}
