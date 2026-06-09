'use client';

import React, { useState } from 'react';
import { Camera } from 'lucide-react';
import { usePresenceStore } from '@/store/presenceStore';
import { usePDFStore } from '@/store/pdfStore';
import { Avatar } from '@/components/ui/Avatar';
import { AvatarUpload } from '@/components/ui/AvatarUpload';
import type { UserMeta } from '@/types';

interface PresenceListProps {
  roomId?: string;
  roomName?: string;
}

export function PresenceList({ roomId, roomName = 'ReadRoom' }: PresenceListProps) {
  const { users: usersMap, self, updateSelf } = usePresenceStore();
  const { followMode, followTarget, setFollowMode } = usePDFStore();
  const [showAvatarUpload, setShowAvatarUpload] = useState(false);

  const handleAvatarUploaded = (url: string) => {
    // Update local state immediately.
    // Database writes from the upload API will automatically trigger postgres_changes
    // on table 'users', which propagates the new avatarUrl to all other clients.
    updateSelf({ avatarUrl: url });
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
    <div className="flex flex-col h-full bg-transparent">
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
              className="flex items-center gap-3 px-2 py-1.5 rounded-xl hover:bg-room-hover/50 transition-colors group"
            >
              <div className="relative flex-shrink-0">
                <Avatar
                  user={user}
                  size="md"
                  showTooltip={false}
                />
                <span 
                  className={`absolute bottom-0 right-0 w-2.5 h-2.5 rounded-full border border-room-surface ${
                    user.isActive ? 'bg-green-500' : 'bg-gray-500'
                  }`}
                />
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-room-text truncate">
                    {user.userName}
                    {user.userId.split('_')[0] === selfBaseId && ' (You)'}
                  </p>
                  {user.userId.split('_')[0] === selfBaseId && (
                    <button
                      onClick={() => setShowAvatarUpload(true)}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded-lg text-room-muted hover:text-room-text hover:bg-room-hover transition-all"
                      title="Change photo"
                    >
                      <Camera size={12} />
                    </button>
                  )}
                </div>
                <p className="text-[10px] text-room-muted truncate">
                  {user.isActive ? (
                    user.activePdfName ? (
                      `Viewing: ${user.activePdfName}`
                    ) : (
                      'Viewing main room'
                    )
                  ) : (
                    'Offline'
                  )}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
