'use client';
// components/room/PresenceBar.tsx — compact avatar row shown in the header.
import React from 'react';
import { usePresenceStore } from '@/store/presenceStore';
import { Avatar } from '@/components/ui/Avatar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { UserMeta } from '@/types';

export function PresenceBar() {
  const usersMap = usePresenceStore((s) => s.users);
  const self = usePresenceStore((s) => s.self);
  const connectionStatus = usePresenceStore((s) => s.connectionStatus);

  // Deduplicate by base userId (multiple tabs = one avatar)
  const grouped = Array.from(
    [...(self ? [self] : []), ...Array.from(usersMap.values())]
      .reduce((acc, user) => {
        const baseId = user.userId.split('_')[0];
        const existing = acc.get(baseId);
        if (!existing || (user.isActive && !existing.isActive)) {
          acc.set(baseId, user);
        }
        return acc;
      }, new Map<string, UserMeta>())
      .values()
  );

  const active = grouped.filter((u) => u.isActive);
  const MAX_SHOWN = 5;
  const shown = active.slice(0, MAX_SHOWN);
  const overflow = active.length - MAX_SHOWN;

  return (
    <div className="flex items-center gap-2">
      <StatusBadge status={connectionStatus} />
      <div className="flex items-center -space-x-2">
        {shown.map((user) => (
          <Avatar key={user.userId} user={user} size="sm" showTooltip />
        ))}
        {overflow > 0 && (
          <div className="w-7 h-7 rounded-full bg-room-surface border-2 border-room-bg flex items-center justify-center text-[10px] font-bold text-room-muted z-10">
            +{overflow}
          </div>
        )}
      </div>
    </div>
  );
}
