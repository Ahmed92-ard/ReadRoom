// store/workspaceStore.ts — Canonical workspace state.
// Entities: libraries → rooms → room_pdfs / pdf_folders
// No legacy server/channel/server_members aliases.

import { create } from 'zustand';
import type { LibraryData, RoomData, PDFFolder } from '@/types';

// Re-export RoomData as ChannelData for components that still use that name
export type { LibraryData };
export type ChannelData = RoomData;

interface WorkspaceStore {
  libraries: LibraryData[];
  channels: RoomData[];          // "channels" kept for component compat
  folders: PDFFolder[];
  activeLibraryId: string | null;
  activeChannelId: string | null;
  loadingLibraries: boolean;
  loadingChannels: boolean;
  error: string | null;

  setActiveLibrary: (libraryId: string) => void;
  setActiveChannel: (channelId: string) => void;
  fetchLibraries: () => Promise<void>;
  fetchChannels: (libraryId: string) => Promise<void>;
  fetchFolders: (libraryId: string, roomId: string) => Promise<void>;
  createLibrary: (name: string) => Promise<LibraryData | null>;
  joinLibrary: (inviteCode: string) => Promise<LibraryData | null>;
  updateLibrary: (libraryId: string, patch: Partial<Pick<LibraryData, 'name' | 'icon_url'>>) => Promise<boolean>;
  createChannel: (libraryId: string, name: string, type?: 'text' | 'pdf') => Promise<RoomData | null>;
  updateChannel: (libraryId: string, roomId: string, patch: Partial<RoomData>) => Promise<boolean>;
  deleteLibrary: (libraryId: string) => Promise<boolean>;
  deleteChannel: (libraryId: string, roomId: string) => Promise<boolean>;
  createFolder: (libraryId: string, roomId: string, name: string, parentId?: string | null) => Promise<PDFFolder | null>;
  deleteFolder: (libraryId: string, roomId: string, folderId: string) => Promise<boolean>;
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  libraries: [],
  channels: [],
  folders: [],
  activeLibraryId: null,
  activeChannelId: null,
  loadingLibraries: false,
  loadingChannels: false,
  error: null,

  setActiveLibrary: (libraryId) => {
    set({ activeLibraryId: libraryId, activeChannelId: null, channels: [], folders: [] });
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
      if (!res.ok) throw new Error('Failed to load rooms');
      const data = await res.json();
      // Normalize: add server_id alias for components that still read it
      const channels = (data.channels ?? []).map((c: any) => ({
        ...c,
        server_id: c.library_id ?? c.server_id,
        library_id: c.library_id ?? c.server_id,
      }));
      set({ channels, loadingChannels: false });
    } catch (err) {
      set({ error: String(err), loadingChannels: false });
    }
  },

  fetchFolders: async (libraryId, roomId) => {
    try {
      const res = await fetch(`/api/libraries/${libraryId}/channels/${roomId}/folders`);
      if (!res.ok) return;
      const data = await res.json();
      set({ folders: data.folders ?? [] });
    } catch { /* non-critical */ }
  },

  createLibrary: async (name) => {
    set({ error: null });
    try {
      const res = await fetch('/api/libraries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.error || `Failed to create library (${res.status})`;
        set({ error: msg });
        return null;
      }
      set((s) => ({ libraries: [...s.libraries, data.library] }));
      return data.library;
    } catch (err) {
      set({ error: String(err) });
      return null;
    }
  },

  joinLibrary: async (inviteCode) => {
    set({ error: null });
    try {
      const res = await fetch('/api/libraries/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inviteCode }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.error || `Invalid invite code (${res.status})`;
        set({ error: msg });
        return null;
      }
      set((s) => ({
        libraries: s.libraries.some((l) => l.id === data.library.id)
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
        libraries: s.libraries.map((l) => l.id === libraryId ? { ...l, ...data.library } : l),
      }));
      return true;
    } catch (err) {
      set({ error: String(err) });
      return false;
    }
  },

  createChannel: async (libraryId, name, type = 'pdf') => {
    try {
      const res = await fetch(`/api/libraries/${libraryId}/channels`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, type }),
      });
      if (!res.ok) throw new Error('Failed to create room');
      const data = await res.json();
      const channel = { ...data.channel, server_id: data.channel.library_id ?? data.channel.server_id };
      set((s) => ({ channels: [...s.channels, channel] }));
      return channel;
    } catch (err) {
      set({ error: String(err) });
      return null;
    }
  },

  updateChannel: async (libraryId, roomId, patch) => {
    try {
      const res = await fetch(`/api/libraries/${libraryId}/channels/${roomId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!res.ok) throw new Error('Failed to update room');
      set((s) => ({
        channels: s.channels.map((c) => c.id === roomId ? { ...c, ...patch } : c),
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
        libraries: s.libraries.filter((l) => l.id !== libraryId),
        activeLibraryId: s.activeLibraryId === libraryId ? null : s.activeLibraryId,
        channels: s.activeLibraryId === libraryId ? [] : s.channels,
      }));
      return true;
    } catch (err) {
      set({ error: String(err) });
      return false;
    }
  },

  deleteChannel: async (libraryId, roomId) => {
    try {
      const res = await fetch(`/api/libraries/${libraryId}/channels/${roomId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error('Failed to delete room');
      set((s) => ({
        channels: s.channels.filter((c) => c.id !== roomId),
        activeChannelId: s.activeChannelId === roomId ? null : s.activeChannelId,
      }));
      return true;
    } catch (err) {
      set({ error: String(err) });
      return false;
    }
  },

  createFolder: async (libraryId, roomId, name, parentId = null) => {
    try {
      const res = await fetch(`/api/libraries/${libraryId}/channels/${roomId}/folders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, parentId }),
      });
      if (!res.ok) throw new Error('Failed to create folder');
      const data = await res.json();
      set((s) => ({ folders: [...s.folders, data.folder] }));
      return data.folder;
    } catch (err) {
      set({ error: String(err) });
      return null;
    }
  },

  deleteFolder: async (libraryId, roomId, folderId) => {
    try {
      const res = await fetch(`/api/libraries/${libraryId}/channels/${roomId}/folders`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folderId }),
      });
      if (!res.ok) throw new Error('Failed to delete folder');
      set((s) => ({ folders: s.folders.filter((f) => f.id !== folderId) }));
      return true;
    } catch (err) {
      set({ error: String(err) });
      return false;
    }
  },
}));
