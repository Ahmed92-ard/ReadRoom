// app/servers/[serverId]/page.tsx
'use client';

import { useEffect } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { ServerSidebar } from '@/components/layout/ServerSidebar';
import { ChannelSidebar } from '@/components/layout/ChannelSidebar';
import { BookOpen, Hash, Loader2 } from 'lucide-react';

export default function ServerPage() {
  const router = useRouter();
  const params = useParams();
  const serverId = params.serverId as string;
  const { channels, fetchChannels, loadingChannels } = useWorkspaceStore();

  useEffect(() => {
    fetchChannels(serverId);
  }, [serverId, fetchChannels]);

  // Auto-navigate to first channel
  useEffect(() => {
    if (!loadingChannels && channels.length > 0) {
      router.replace(`/servers/${serverId}/channels/${channels[0].id}`);
    }
  }, [loadingChannels, channels, serverId, router]);

  return (
    <div className="flex h-screen bg-room-bg overflow-hidden">
      <ServerSidebar />
      <ChannelSidebar />
      <div className="flex-1 flex items-center justify-center">
        {loadingChannels ? (
          <Loader2 size={28} className="animate-spin text-room-muted" />
        ) : channels.length === 0 ? (
          <div className="text-center max-w-sm px-6">
            <div className="w-14 h-14 rounded-2xl bg-room-surface flex items-center justify-center mx-auto mb-4 border border-room-border">
              <Hash size={24} className="text-room-muted" />
            </div>
            <h2 className="text-lg font-bold text-room-text mb-2">No rooms yet</h2>
            <p className="text-room-muted text-sm">
              Add a room using the <strong className="text-room-text">+</strong> button in the sidebar to create your first reading space.
            </p>
          </div>
        ) : (
          <Loader2 size={28} className="animate-spin text-room-muted" />
        )}
      </div>
    </div>
  );
}
