// app/libraries/[libraryId]/channels/[channelId]/page.tsx
'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { usePDFStore } from '@/store/pdfStore';
import { useRoomStore } from '@/store/roomStore';
import { useAuth } from '@/lib/hooks/useAuth';
import { RoomShell } from '@/components/room/RoomShell';

export default function ChannelPage() {
  const params = useParams();
  const libraryId = params.libraryId as string;
  const channelId = params.channelId as string;
  const { user, userName } = useAuth();

  const { channels, setActiveChannel, setActiveLibrary } = useWorkspaceStore();
  const clearRoom = useRoomStore((s) => s.clearRoom);
  const setFollowMode = usePDFStore((s) => s.setFollowMode);

  useEffect(() => {
    setActiveLibrary(libraryId);
  }, [libraryId, setActiveLibrary]);

  useEffect(() => {
    clearRoom();
    setFollowMode(false);
    setActiveChannel(channelId);
  }, [channelId, setActiveChannel, clearRoom, setFollowMode]);

  const channel = channels.find((c) => c.id === channelId);

  if (!user) {
    return (
      <div className="min-h-screen bg-room-bg flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-room-muted mt-3">Loading session…</p>
        </div>
      </div>
    );
  }

  // Build a minimal initialRoom from the channel record.
  // RoomShell will fetch the actual PDFs from room_pdfs via its own effect.
  const initialRoom = channel
    ? {
        id: channel.id,
        name: channel.name,
        pdf: null,   // RoomShell fetches PDFs itself — don't pre-populate
        currentPage: channel.current_page ?? 1,
        zoom: channel.zoom ?? 1,
        scrollPct: channel.scroll_pct ?? 0,
        createdBy: '',
        createdAt: channel.created_at ?? new Date().toISOString(),
      }
    : null;

  return (
    <div className="h-[100dvh] bg-room-bg overflow-hidden">
      {initialRoom ? (
        <RoomShell
          roomId={channelId}
          initialUserId={user.id}
          initialUserName={userName}
          initialRoom={initialRoom}
        />
      ) : (
        <div className="flex h-full items-center justify-center">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}
