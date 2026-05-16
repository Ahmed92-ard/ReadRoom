'use client';
// components/ui/FollowToggle.tsx
'use client';

import React from 'react';
import { Users, Unlink } from 'lucide-react';
import { usePDFStore } from '@/store/pdfStore';

export function FollowToggle() {
  const { followMode, setFollowMode } = usePDFStore((s) => ({
    followMode: s.followMode,
    setFollowMode: s.setFollowMode,
  }));

  return (
    <button
      onClick={() => setFollowMode(!followMode)}
      title={followMode ? 'Following room — click to go solo' : 'Solo mode — click to follow room'}
      className={`
        flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium
        min-h-[36px] transition-all duration-150
        ${followMode
          ? 'bg-blue-500/20 text-blue-300 hover:bg-blue-500/30'
          : 'bg-room-hover text-room-muted hover:text-room-text'}
      `}
    >
      {followMode ? <Users size={14} /> : <Unlink size={14} />}
      <span className="hidden sm:inline">{followMode ? 'Following' : 'Solo'}</span>
    </button>
  );
}

