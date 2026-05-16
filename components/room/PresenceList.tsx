'use client';

import React from 'react';
import { usePresenceStore } from '@/store/presenceStore';
import { usePDFStore } from '@/store/pdfStore';
import { Avatar } from '@/components/ui/Avatar';
import type { UserMeta } from '@/types';

function formatLastSeen(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

export function PresenceList() {
  const { users: usersMap, self, connectionStatus } = usePresenceStore();
  const { followMode, followTarget, setFollowMode } = usePDFStore();

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
        ...(useNewData ? {
          userId: user.userId, 
          page: user.page,
          scroll: user.scroll,
          zoom: user.zoom,
          activePdfId: user.activePdfId,
          activePdfName: user.activePdfName,
          userName: user.userName,
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

  const activeCount = all.filter(u => u.isActive).length;

  return (
    <div className="flex flex-col h-full bg-room-surface">
      {/* Member Summary */}
      <div className="p-4 border-b border-room-border bg-room-bg/30 flex-none">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-bold text-room-text">Room Members</span>
          <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400">
            {all.length} total
          </span>
        </div>
        <div className="flex items-center justify-between text-[10px]">
          <div className="text-room-muted">
            {activeCount} active now • {all.length - activeCount} away
          </div>
          <div className="flex items-center gap-1.5">
            <div className={`w-1.5 h-1.5 rounded-full ${
              connectionStatus === 'connected' ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.4)]' :
              connectionStatus === 'error' ? 'bg-red-500' :
              'bg-yellow-500 animate-pulse'
            }`} />
            <span className={
              connectionStatus === 'connected' ? 'text-green-500/80' :
              connectionStatus === 'error' ? 'text-red-400' :
              'text-yellow-500/80'
            }>
              {connectionStatus.charAt(0).toUpperCase() + connectionStatus.slice(1)}
            </span>
          </div>
        </div>
      </div>

      <div className="flex-1 p-3 space-y-1 overflow-y-auto">
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
              <Avatar user={user} size="md" showTooltip={false} />
              <div className={`absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full border-2 border-room-surface ${
                user.isActive ? 'bg-green-500' : 'bg-gray-500'
              }`} />
            </div>
            
            <div className="flex-1 min-w-0">
              <p className="text-sm text-room-text truncate font-medium">
                {user.userName}
                {user.userId === self?.userId && (
                  <span className="ml-1 text-[10px] text-room-muted">(you)</span>
                )}
              </p>
              <p className="text-[11px] mt-0.5 flex items-center gap-1.5">
                {user.isActive ? (
                  <>
                    <span className="text-green-400">Active</span>
                    <span className="text-room-muted">·</span>
                    <span className="text-room-muted truncate">
                      {user.activePdfName ? `${user.activePdfName} · ` : ''}page {user.page ?? 1}
                    </span>
                  </>
                ) : (
                  <span className="text-room-muted truncate">
                    Offline · {typeof user.lastSeen === 'number' ? formatLastSeen(user.lastSeen) : 'recently'}
                  </span>
                )}
              </p>
            </div>

            {user.isActive && user.userId !== self?.userId && (
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
