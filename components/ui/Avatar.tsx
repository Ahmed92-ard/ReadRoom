'use client';
// components/ui/Avatar.tsx
import React, { useState } from 'react';
import type { UserMeta } from '@/types';

interface AvatarProps {
  user: UserMeta;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  showTooltip?: boolean;
}

const sizeMap = { 
  xs: 'w-6 h-6 text-[10px]',
  sm: 'w-7 h-7 text-xs', 
  md: 'w-8 h-8 text-xs', 
  lg: 'w-10 h-10 text-sm' 
};

export function Avatar({ user, size = 'md', showTooltip = true }: AvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const showImage = user.avatarUrl && !imgFailed;

  return (
    <div className="relative group">
      <div
        className={`${sizeMap[size]} rounded-full flex items-center justify-center font-semibold text-white ring-2 ring-room-bg select-none flex-shrink-0 overflow-hidden`}
        style={showImage ? {} : { backgroundColor: user.avatarColor }}
        title={user.userName}
      >
        {showImage ? (
          <img
            src={user.avatarUrl!}
            alt={user.userName}
            className="w-full h-full object-cover"
            onError={() => setImgFailed(true)}
          />
        ) : (
          user.avatarInitials
        )}
      </div>
      {showTooltip && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 rounded-md bg-gray-900 text-white text-xs whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50">
          {user.userName}
        </div>
      )}
    </div>
  );
}
