import { create } from 'zustand';
import { createClient } from '@/lib/supabase/client';

export interface LibraryData {
  id: string;
  name: string;
  icon_url: string | null;
  owner_id: string;
  invite_code: string;
  created_at: string;
}

export interface ChannelData {
  id: string;
  server_id: string; // Internal DB field name remains server_id for now to avoid migration
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
  libraries: LibraryData[];
  channels: ChannelData[];
  activeLibraryId: string | null;
  activeChannelId: string | null;
  loadingLibraries: boolean;
  loadingChannels: boolean;
  error: string | null;

  // Actions
  setActiveLibrary: (libraryId: string) => void;
  setActiveChannel: (channelId: string) => void;
  fetchLibraries: () => Promise<void>;
  fetchChannels: (libraryId: string) => Promise<void>;
  createLibrary: (name: string) => Promise<LibraryData | null>;
  joinLibrary: (inviteCode: string) => Promise<LibraryData | null>;
  updateLibrary: (libraryId: string, patch: Partial<Pick<LibraryData, 'name' | 'icon_url'>>) => Promise<boolean>;
  createChannel: (libraryId: string, name: string, type: 'text' | 'pdf') => Promise<ChannelData | null>;
  updateChannelPDF: (channelId: string, pdf: { driveId: string; name: string; url: string | null }) => Promise<void>;
  updateChannel: (libraryId: string, channelId: string, patch: Partial<ChannelData>) => Promise<boolean>;
  deleteLibrary: (libraryId: string) => Promise<boolean>;
  deleteChannel: (libraryId: string, channelId: string) => Promise<boolean>;
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  libraries: [],
  channels: [],
  activeLibraryId: null,
  activeChannelId: null,
  loadingLibraries: false,
  loadingChannels: false,
  error: null,

  setActiveLibrary: (libraryId) => {
    set({ activeLibraryId: libraryId, activeChannelId: null, channels: [] });
    get().fetchChannels(libraryId);
  },

  setActiveChannel: (channelId) => set({ activeChannelId: channelId }),

  fetchLibraries: async () => {
    set({ loadingLibraries: true, error: null });
    try {
      const res = await fetch('/api/libraries');
      if (!res.ok) throw new Error('Failed to load libraries');
      const data = await res.json();
      set({ libraries: data.libraries ?? [], loadingLibraries: false });
    } catch (err) {
      set({ error: String(err), loadingLibraries: false });
    }
  },

  fetchChannels: async (libraryId) => {
    set({ loadingChannels: true });
    try {
      const res = await fetch(`/api/libraries/${libraryId}/channels`);
      if (!res.ok) throw new Error('Failed to load channels');
      const data = await res.json();
      set({ channels: data.channels ?? [], loadingChannels: false });
    } catch (err) {
      set({ error: String(err), loadingChannels: false });
    }
  },

  createLibrary: async (name) => {
    try {
      const res = await fetch('/api/libraries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      if (!res.ok) throw new Error('Failed to create library');
      const data = await res.json();
      set((s) => ({ libraries: [...s.libraries, data.library] }));
      return data.library;
    } catch (err) {
      set({ error: String(err) });
      return null;
    }
  },

  joinLibrary: async (inviteCode) => {
    try {
      const res = await fetch('/api/libraries/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode }),
      });
      if (!res.ok) throw new Error('Invalid invite code');
      const data = await res.json();
      set((s) => ({
        libraries: s.libraries.some((sv) => sv.id === data.library.id)
          ? s.libraries
          : [...s.libraries, data.library],
      }));
      return data.library;
    } catch (err) {
      set({ error: String(err) });
      return null;
    }
  },

  updateLibrary: async (libraryId, patch) => {
    try {
      const res = await fetch('/api/libraries', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ libraryId, ...patch }),
      });
      if (!res.ok) throw new Error('Failed to update library');
      const data = await res.json();
      set((s) => ({
        libraries: s.libraries.map((library) =>
          library.id === libraryId ? { ...library, ...data.library } : library
        ),
      }));
      return true;
    } catch (err) {
      set({ error: String(err) });
      return false;
    }
  },

  createChannel: async (libraryId, name, type) => {
    try {
      const res = await fetch(`/api/libraries/${libraryId}/channels`, {
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
    const libraryId = get().activeLibraryId;
    console.log('[workspace] updateChannelPDF — libraryId:', libraryId, 'channelId:', channelId, 'pdf:', pdf);
    if (!libraryId) {
      console.warn('[workspace] updateChannelPDF SKIPPED — activeLibraryId is null!');
      return;
    }
    const res = await fetch(`/api/libraries/${libraryId}/channels/${channelId}`, {
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
 
  updateChannel: async (libraryId, channelId, patch) => {
    try {
      const res = await fetch(`/api/libraries/${libraryId}/channels/${channelId}`, {
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

  deleteLibrary: async (libraryId) => {
    try {
      const res = await fetch('/api/libraries', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ libraryId }),
      });
      if (!res.ok) throw new Error('Failed to delete library');
      set((s) => ({
        libraries: s.libraries.filter((sv) => sv.id !== libraryId),
        activeLibraryId: s.activeLibraryId === libraryId ? null : s.activeLibraryId,
        channels: s.activeLibraryId === libraryId ? [] : s.channels,
      }));
      return true;
    } catch (err) {
      set({ error: String(err) });
      return false;
    }
  },

  deleteChannel: async (libraryId, channelId) => {
    try {
      const res = await fetch(`/api/libraries/${libraryId}/channels/${channelId}`, {
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
