'use client';
// components/ui/Avatar.tsx
import React, { memo, useMemo, useState } from 'react';
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

function AvatarBase({ user, size = 'md', showTooltip = true }: AvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const avatarUrl = user.avatarUrl ?? null;
  
  // Reset failure state if URL changes (e.g. user updates their photo)
  React.useEffect(() => {
    setImgFailed(false);
  }, [avatarUrl]);

  const showImage = Boolean(avatarUrl && !imgFailed);
  const fallbackStyle = useMemo(() => (
    showImage ? undefined : { backgroundColor: user.avatarColor }
  ), [showImage, user.avatarColor]);

  return (
    <div className="relative group">
      <div
        className={`${sizeMap[size]} rounded-full flex items-center justify-center font-semibold text-white ring-2 ring-room-bg select-none flex-shrink-0 overflow-hidden`}
        style={fallbackStyle}
        title={user.userName}
      >
        {showImage ? (
          <img
            src={avatarUrl!}
            alt={user.userName}
            loading="lazy"
            decoding="async"
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

export const Avatar = memo(AvatarBase, (prev, next) => (
  prev.size === next.size &&
  prev.showTooltip === next.showTooltip &&
  prev.user.userId === next.user.userId &&
  prev.user.userName === next.user.userName &&
  prev.user.avatarUrl === next.user.avatarUrl &&
  prev.user.avatarColor === next.user.avatarColor &&
  prev.user.avatarInitials === next.user.avatarInitials
));
