import { create } from 'zustand';
import { createClient } from '@/lib/supabase/client';

export interface ServerData {
  id: string;
  name: string;
  icon_url: string | null;
  owner_id: string;
  invite_code: string;
  created_at: string;
}

export interface ChannelData {
  id: string;
  server_id: string;
  name: string;
  description: string | null;
  type: 'text' | 'pdf';
  position: number;
  pdf_drive_id: string | null;
  pdf_name: string | null;
  pdf_url: string | null;
  current_page: number;
  scroll_pct: number;
  zoom: number;
  current_pdf_id?: string | null;
}

interface WorkspaceStore {
  // State
  servers: ServerData[];
  channels: ChannelData[];
  activeServerId: string | null;
  activeChannelId: string | null;
  loadingServers: boolean;
  loadingChannels: boolean;
  error: string | null;

  // Actions
  setActiveServer: (serverId: string) => void;
  setActiveChannel: (channelId: string) => void;
  fetchServers: () => Promise<void>;
  fetchChannels: (serverId: string) => Promise<void>;
  createServer: (name: string) => Promise<ServerData | null>;
  joinServer: (inviteCode: string) => Promise<ServerData | null>;
  updateServer: (serverId: string, patch: Partial<Pick<ServerData, 'name' | 'icon_url'>>) => Promise<boolean>;
  createChannel: (serverId: string, name: string, type: 'text' | 'pdf') => Promise<ChannelData | null>;
  updateChannelPDF: (channelId: string, pdf: { driveId: string; name: string; url: string | null }) => Promise<void>;
  updateChannel: (serverId: string, channelId: string, patch: Partial<ChannelData>) => Promise<boolean>;
  deleteServer: (serverId: string) => Promise<boolean>;
  deleteChannel: (serverId: string, channelId: string) => Promise<boolean>;
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  servers: [],
  channels: [],
  activeServerId: null,
  activeChannelId: null,
  loadingServers: false,
  loadingChannels: false,
  error: null,

  setActiveServer: (serverId) => {
    set({ activeServerId: serverId, activeChannelId: null, channels: [] });
    get().fetchChannels(serverId);
  },

  setActiveChannel: (channelId) => set({ activeChannelId: channelId }),

  fetchServers: async () => {
    set({ loadingServers: true, error: null });
    try {
      const res = await fetch('/api/servers');
      if (!res.ok) throw new Error('Failed to load servers');
      const data = await res.json();
      set({ servers: data.servers ?? [], loadingServers: false });
    } catch (err) {
      set({ error: String(err), loadingServers: false });
    }
  },

  fetchChannels: async (serverId) => {
    set({ loadingChannels: true });
    try {
      const res = await fetch(`/api/servers/${serverId}/channels`);
      if (!res.ok) throw new Error('Failed to load channels');
      const data = await res.json();
      set({ channels: data.channels ?? [], loadingChannels: false });
    } catch (err) {
      set({ error: String(err), loadingChannels: false });
    }
  },

  createServer: async (name) => {
    try {
      const res = await fetch('/api/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error('Failed to create server');
      const data = await res.json();
      set((s) => ({ servers: [...s.servers, data.server] }));
      return data.server;
    } catch (err) {
      set({ error: String(err) });
      return null;
    }
  },

  joinServer: async (inviteCode) => {
    try {
      const res = await fetch('/api/servers/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode }),
      });
      if (!res.ok) throw new Error('Invalid invite code');
      const data = await res.json();
      set((s) => ({
        servers: s.servers.some((sv) => sv.id === data.server.id)
          ? s.servers
          : [...s.servers, data.server],
      }));
      return data.server;
    } catch (err) {
      set({ error: String(err) });
      return null;
    }
  },

  updateServer: async (serverId, patch) => {
    try {
      const res = await fetch('/api/servers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId, ...patch }),
      });
      if (!res.ok) throw new Error('Failed to update library');
      const data = await res.json();
      set((s) => ({
        servers: s.servers.map((server) =>
          server.id === serverId ? { ...server, ...data.server } : server
        ),
      }));
      return true;
    } catch (err) {
      set({ error: String(err) });
      return false;
    }
  },

  createChannel: async (serverId, name, type) => {
    try {
      const res = await fetch(`/api/servers/${serverId}/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type }),
      });
      if (!res.ok) throw new Error('Failed to create channel');
      const data = await res.json();
      set((s) => ({ channels: [...s.channels, data.channel] }));
      return data.channel;
    } catch (err) {
      set({ error: String(err) });
      return null;
    }
  },

  updateChannelPDF: async (channelId, pdf) => {
    const serverId = get().activeServerId;
    console.log('[workspace] updateChannelPDF — serverId:', serverId, 'channelId:', channelId, 'pdf:', pdf);
    if (!serverId) {
      console.warn('[workspace] updateChannelPDF SKIPPED — activeServerId is null!');
      return;
    }
    const res = await fetch(`/api/servers/${serverId}/channels/${channelId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pdfDriveId: pdf.driveId, pdfName: pdf.name, pdfUrl: pdf.url }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('[workspace] updateChannelPDF PATCH failed:', res.status, err);
    } else {
      console.log('[workspace] updateChannelPDF PATCH success');
    }
    set((s) => ({
      channels: s.channels.map((ch) =>
        ch.id === channelId
          ? { ...ch, pdf_drive_id: pdf.driveId, pdf_name: pdf.name, pdf_url: pdf.url }
          : ch
      ),
    }));
  },
 
  updateChannel: async (serverId, channelId, patch) => {
    try {
      const res = await fetch(`/api/servers/${serverId}/channels/${channelId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error('Failed to update channel');
      set((s) => ({
        channels: s.channels.map((ch) =>
          ch.id === channelId ? { ...ch, ...patch } : ch
        ),
      }));
      return true;
    } catch (err) {
      set({ error: String(err) });
      return false;
    }
  },

  updateServer: async (serverId, patch) => {
    try {
      const res = await fetch('/api/servers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId, ...patch }),
      });
      if (!res.ok) throw new Error('Failed to update server');
      set((s) => ({
        servers: s.servers.map((sv) =>
          sv.id === serverId ? { ...sv, ...patch } : sv
        ),
      }));
      return true;
    } catch (err) {
      set({ error: String(err) });
      return false;
    }
  },

  deleteServer: async (serverId) => {
    try {
      const res = await fetch('/api/servers', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ serverId }),
      });
      if (!res.ok) throw new Error('Failed to delete server');
      set((s) => ({
        servers: s.servers.filter((sv) => sv.id !== serverId),
        activeServerId: s.activeServerId === serverId ? null : s.activeServerId,
        channels: s.activeServerId === serverId ? [] : s.channels,
      }));
      return true;
    } catch (err) {
      set({ error: String(err) });
      return false;
    }
  },

  deleteChannel: async (serverId, channelId) => {
    try {
      const res = await fetch(`/api/servers/${serverId}/channels/${channelId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete channel');
      set((s) => ({
        channels: s.channels.filter((ch) => ch.id !== channelId),
        activeChannelId: s.activeChannelId === channelId ? null : s.activeChannelId,
      }));
      return true;
    } catch (err) {
      set({ error: String(err) });
      return false;
    }
  },
}));
