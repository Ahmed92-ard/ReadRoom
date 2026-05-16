// app/libraries/[libraryId]/channels/[channelId]/page.tsx
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { usePDFStore } from '@/store/pdfStore';
import { useRoomStore } from '@/store/roomStore';
import { useAuth } from '@/lib/hooks/useAuth';
import { RoomShell } from '@/components/room/RoomShell';
import type { ChannelPDF } from '@/types';

export default function ChannelPage() {
  const params = useParams();
  const libraryId = params.libraryId as string;
  const channelId = params.channelId as string;
  const { user, userName } = useAuth();

  const { channels, setActiveChannel, setActiveLibrary } = useWorkspaceStore();
  const clearRoom = useRoomStore((s) => s.clearRoom);
  const setFollowMode = usePDFStore((s) => s.setFollowMode);
  
  useEffect(() => {
    // Set active library — this also triggers fetchChannels internally
    setActiveLibrary(libraryId);
  }, [libraryId, setActiveLibrary]);

  useEffect(() => {
    // Reset state when switching channels
    clearRoom();
    setFollowMode(false);
    setActiveChannel(channelId);
  }, [channelId, setActiveChannel, clearRoom, setFollowMode]);

  const channel = channels.find((c) => c.id === channelId);
  const [resolvedRoom, setResolvedRoom] = useState<any>(null);

  const initialRoom = useMemo(() => {
    if (!channel) return null;

    return {
      id: channel.id,
      name: channel.name,
      pdf: channel.pdf_drive_id
        ? {
            fileId: channel.pdf_drive_id,
            filename: channel.pdf_name ?? 'document.pdf',
            thumbnail: channel.pdf_url ?? null,
            owner: '',
            url: `https://drive.google.com/uc?export=download&id=${channel.pdf_drive_id}`,
          }
        : null,
      currentPage: channel.current_page ?? 1,
      zoom: channel.zoom ?? 1,
      scrollPct: channel.scroll_pct ?? 0,
    };
  }, [channel]);

  useEffect(() => {
    if (!libraryId || !channelId || !channel) return;

    let cancelled = false;
    fetch(`/api/libraries/${libraryId}/channels/${channelId}/pdfs`)
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load channel PDF library');
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        const pdfs: ChannelPDF[] = data.pdfs ?? [];

        const selectedPdf = pdfs.find((pdf) => pdf.id === channel.current_pdf_id)
          ?? pdfs.find((pdf) => pdf.driveId === channel.pdf_drive_id);

        if (selectedPdf) {
          setResolvedRoom({
            ...initialRoom,
            pdf: {
              fileId: selectedPdf.driveId,
              filename: selectedPdf.filename,
              thumbnail: selectedPdf.thumbnailUrl ?? null,
              owner: selectedPdf.url ? 'Room Library' : 'Google Drive',
              totalPages: null,
              url: selectedPdf.url,
            },
          });
        } else {
          setResolvedRoom(initialRoom);
        }
      })
      .catch((error) => {
        console.error('[ChannelPage] fetch channel pdfs failed', error);
        setResolvedRoom(initialRoom);
      });

    return () => {
      cancelled = true;
    };
  }, [libraryId, channelId, channel, initialRoom]);

  if (!user) {
    return (
      <div className="min-h-screen bg-room-bg flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-room-muted mt-3">Loading session...</p>
        </div>
      </div>
    );
  }

  const initialRoomToUse = resolvedRoom ?? initialRoom;

  return (
    <div className="h-[100dvh] bg-room-bg overflow-hidden">
      {initialRoomToUse ? (
        <RoomShell
          roomId={channelId}
          initialUserId={user.id}
          initialUserName={userName}
          initialRoom={initialRoomToUse}
        />
      ) : (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      )}
    </div>
  );
}
