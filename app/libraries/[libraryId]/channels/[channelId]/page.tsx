// app/libraries/[libraryId]/channels/[channelId]/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { usePDFStore } from '@/store/pdfStore';
import { useRoomStore } from '@/store/roomStore';
import { useAuth } from '@/lib/hooks/useAuth';
import { RoomShell } from '@/components/room/RoomShell';

export default function ChannelPage() {
  const router = useRouter();
  const params = useParams();
  const libraryId = params.libraryId as string;
  const channelId = params.channelId as string;
  const { user, userName, loading: authLoading, initError } = useAuth();

  const { channels, loadingChannels, error, setActiveChannel, setActiveLibrary } = useWorkspaceStore();
  const [startupTimedOut, setStartupTimedOut] = useState(false);
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

  useEffect(() => {
    if (!authLoading && !user) router.replace('/auth');
  }, [authLoading, user, router]);

  useEffect(() => {
    setStartupTimedOut(false);
    const id = window.setTimeout(() => setStartupTimedOut(true), 15_000);
    return () => window.clearTimeout(id);
  }, [libraryId, channelId]);

  const channel = channels.find((c) => c.id === channelId);

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-room-bg flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-room-muted mt-3">Loading session…</p>
          {initError && <p className="text-red-300 text-xs mt-2 max-w-xs">{initError}</p>}
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
      ) : startupTimedOut || error ? (
        <div className="flex h-full items-center justify-center px-6">
          <div className="max-w-sm text-center">
            <h2 className="text-lg font-semibold text-room-text">Room could not finish loading</h2>
            <p className="mt-2 text-sm text-room-muted">
              {error || 'The room list did not arrive in time. This can happen after a stale PWA install or a network interruption.'}
            </p>
            <div className="mt-5 flex justify-center gap-3">
              <button
                onClick={() => {
                  setStartupTimedOut(false);
                  setActiveLibrary(libraryId);
                }}
                className="min-h-[42px] rounded-lg bg-blue-500 px-4 text-sm font-medium text-white hover:bg-blue-400"
              >
                Retry
              </button>
              <button
                onClick={() => router.replace('/libraries')}
                className="min-h-[42px] rounded-lg border border-room-border px-4 text-sm font-medium text-room-text hover:bg-room-hover"
              >
                Libraries
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex h-full items-center justify-center">
          <div className="text-center">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="mt-3 text-xs text-room-muted">
              {loadingChannels ? 'Loading room…' : 'Preparing room…'}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
