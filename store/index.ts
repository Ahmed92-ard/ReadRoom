// store/index.ts — Canonical Zustand stores.
// Includes persisted state versioning to prevent stale-state crashes on deploy.

import { create } from 'zustand';
import type { UserMeta, PDFMeta, RoomState, ChatMessage, ConnectionStatus } from '@/types';
import { ensureRuntimeStateVersion } from '@/lib/runtime/recovery';

if (typeof window !== 'undefined') {
  ensureRuntimeStateVersion();
}

// ── Room store ────────────────────────────────────────────────────────────────

interface RoomStore {
  room: RoomState | null;
  setRoom: (room: RoomState) => void;
  setPDF: (pdf: PDFMeta) => void;
  setName: (name: string) => void;
  clearRoom: () => void;
}

export const useRoomStore = create<RoomStore>((set) => ({
  room: null,
  setRoom: (room) => set({ room }),
  setPDF: (pdf) => set((s) => s.room ? { room: { ...s.room, pdf } } : s),
  setName: (name) => set((s) => s.room ? { room: { ...s.room, name } } : s),
  clearRoom: () => set({ room: null }),
}));

// ── PDF store ─────────────────────────────────────────────────────────────────

interface PDFStore {
  page: number;
  scroll: number;
  zoom: number;
  totalPages: number;
  setPage: (page: number) => void;
  setScroll: (scroll: number) => void;
  setZoom: (zoom: number) => void;
  setTotalPages: (n: number) => void;
  setSyncState: (state: Partial<{ page: number; scroll: number; zoom: number }>) => void;
  followMode: boolean;
  followTarget: string | null;
  setFollowMode: (follow: boolean, targetId?: string | null) => void;
  pageDimensions: Map<number, { width: number; height: number }>;
  setPageDimension: (page: number, dim: { width: number; height: number }) => void;
  loadState: 'idle' | 'loading' | 'ready' | 'error';
  setLoadState: (state: 'idle' | 'loading' | 'ready' | 'error') => void;
  visibleRange: { start: number; end: number };
  setVisibleRange: (range: { start: number; end: number }) => void;
  rotation: number;
  setRotation: (rotation: number) => void;
  rotate: () => void;
}

export const usePDFStore = create<PDFStore>((set) => ({
  page: 1,
  scroll: 0,
  zoom: 1,
  totalPages: 0,
  setPage: (page) => set({ page }),
  setScroll: (scroll) => set({ scroll }),
  setZoom: (zoom) => set({ zoom }),
  setTotalPages: (totalPages) => set({ totalPages }),
  setSyncState: (state) => set(state),
  followMode: false,
  followTarget: null,
  setFollowMode: (followMode, targetId = null) => set({
    followMode,
    followTarget: followMode ? targetId : null,
  }),
  loadState: 'idle',
  setLoadState: (loadState) => set({ loadState }),
  visibleRange: { start: 1, end: 3 },
  setVisibleRange: (visibleRange) => set({ visibleRange }),
  rotation: 0,
  setRotation: (rotation) => set({ rotation }),
  rotate: () => set((s) => ({ rotation: (s.rotation + 90) % 360 })),
  pageDimensions: new Map(),
  setPageDimension: (page, dim) => set((s) => {
    const pageDimensions = new Map(s.pageDimensions);
    pageDimensions.set(page, dim);
    return { pageDimensions };
  }),
}));

// ── Presence store ────────────────────────────────────────────────────────────

interface PresenceStore {
  self: UserMeta | null;
  users: Map<string, UserMeta>;
  connectionStatus: ConnectionStatus;
  setSelf: (user: UserMeta) => void;
  updateSelf: (patch: Partial<UserMeta>) => void;
  addUser: (user: UserMeta) => void;
  setMembers: (members: UserMeta[]) => void;
  removeUser: (userId: string) => void;
  updateUser: (userId: string, patch: Partial<UserMeta>) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  clearUsers: () => void;
}

export const usePresenceStore = create<PresenceStore>((set) => ({
  self: null,
  users: new Map(),
  connectionStatus: 'disconnected',
  setSelf: (user) => set({ self: user }),
  updateSelf: (patch) => set((s) => s.self ? { self: { ...s.self, ...patch } } : s),
  addUser: (user) => set((s) => {
    const users = new Map(s.users);
    const existing = users.get(user.userId);
    const userName = (user.userName === 'Reader' && existing?.userName && existing.userName !== 'Reader')
      ? existing.userName
      : user.userName;
    users.set(user.userId, existing ? { ...existing, ...user, userName } : user);
    return { users };
  }),
  setMembers: (members) => set((s) => {
    const users = new Map(s.users);
    members.forEach((m) => {
      const existing = users.get(m.userId);
      if (!existing) users.set(m.userId, m);
      else users.set(m.userId, { ...m, ...existing });
    });
    return { users };
  }),
  removeUser: (userId) => set((s) => {
    const users = new Map(s.users);
    users.delete(userId);
    return { users };
  }),
  updateUser: (userId, patch) => set((s) => {
    const users = new Map(s.users);
    const existing = users.get(userId);
    if (existing) {
      const userName = (patch.userName === 'Reader' && existing.userName !== 'Reader')
        ? existing.userName
        : (patch.userName ?? existing.userName);
      users.set(userId, { ...existing, ...patch, userName });
    } else if (patch.userName) {
      users.set(userId, patch as UserMeta);
    }
    return { users };
  }),
  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
  clearUsers: () => set({ users: new Map() }),
}));

// ── UI store ──────────────────────────────────────────────────────────────────

export type ActivePanel = 'chat' | 'notes' | 'presence' | 'libraries' | 'channels' | 'shelf';

function applyThemeToDOM(theme: 'dark' | 'light') {
  if (typeof window === 'undefined') return;
  const html = document.documentElement;
  html.classList.remove('dark', 'light');
  html.classList.add(theme);
  html.style.colorScheme = theme;
  document.body.classList.remove('dark', 'light');
  document.body.classList.add(theme);
  try { localStorage.setItem('theme', theme); } catch {}
}

interface UIStore {
  sidebarOpen: boolean;
  librarySidebarCollapsed: boolean;
  channelSidebarCollapsed: boolean;
  chatSidebarCollapsed: boolean;
  activePanel: ActivePanel;
  theme: 'dark' | 'light';
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  toggleLibrarySidebar: () => void;
  toggleChannelSidebar: () => void;
  toggleChatSidebar: () => void;
  setActivePanel: (panel: ActivePanel) => void;
  setTheme: (theme: 'dark' | 'light') => void;
  toggleTheme: () => void;
  toggleNavigation: () => void;
  leftSidebarWidth: number;
  setLeftSidebarWidth: (width: number) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  settingsOpen: false,
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  sidebarOpen: true,
  librarySidebarCollapsed: true,
  channelSidebarCollapsed: true,
  chatSidebarCollapsed: false,
  activePanel: 'presence',
  theme: 'dark',
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  toggleLibrarySidebar: () => set((s) => ({ librarySidebarCollapsed: !s.librarySidebarCollapsed })),
  toggleChannelSidebar: () => set((s) => ({ channelSidebarCollapsed: !s.channelSidebarCollapsed })),
  toggleChatSidebar: () => set((s) => ({ chatSidebarCollapsed: !s.chatSidebarCollapsed })),
  setActivePanel: (activePanel) => set({ activePanel }),
  setTheme: (theme) => { applyThemeToDOM(theme); set({ theme }); },
  toggleTheme: () => set((s) => {
    const next = s.theme === 'dark' ? 'light' : 'dark';
    applyThemeToDOM(next);
    return { theme: next };
  }),
  toggleNavigation: () => set((s) => ({
    librarySidebarCollapsed: !s.librarySidebarCollapsed,
    channelSidebarCollapsed: !s.librarySidebarCollapsed,
  })),
  leftSidebarWidth: 260,
  setLeftSidebarWidth: (leftSidebarWidth) => set({ leftSidebarWidth }),
}));
