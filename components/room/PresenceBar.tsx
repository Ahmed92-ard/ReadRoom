// components/room/PresenceBar.tsx
'use client';

import React from 'react';
import { usePresenceStore } from '@/store/presenceStore';
import { Avatar } from '@/components/ui/Avatar';
import { StatusBadge } from '@/components/ui/StatusBadge';
import type { UserMeta } from '@/types';

export function PresenceBar() {
  const isMobile = useIsMobile();
  const users = usePresenceStore((s) => Array.from(s.users.values()));
  const self = usePresenceStore((s) => s.self);
  const connectionStatus = usePresenceStore((s) => s.connectionStatus);

  // Group by base userId to avoid showing multiple avatars for same person with multiple tabs
  const groupedUsers = Array.from(
    [...(self ? [self] : []), ...users.filter(u => u.userId !== self?.userId)]
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

  const activeCount = groupedUsers.filter((user) => user.isActive).length;

  return (
    <div className="flex items-center gap-2 py-1.5 px-3 md:px-4 md:py-2">
    </div>
  );
}

// Helper to detect mobile within component if needed, or we can just use CSS.
// Let's use a simple CSS-based approach or pass it as prop.
// Actually, RoomShell has useIsMobile. I'll add a simple hook here too for convenience.
function useIsMobile() {
  const [m, setM] = React.useState(false);
  React.useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)');
    setM(mq.matches);
    const h = (e: any) => setM(e.matches);
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }, []);
  return m;
}

