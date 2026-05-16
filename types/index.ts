// types/index.ts — Canonical ReadRoom types. No legacy aliases.

// ── User / Profile ────────────────────────────────────────────────────────────

export interface UserProfile {
  id: string;
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
  bio?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Ephemeral presence metadata (socket / Redis) */
export interface UserMeta {
  userId: string;
  userName: string;
  avatarColor: string;
  avatarInitials: string;
  avatarUrl?: string | null;
  joinedAt: number;
  isFollowing: boolean;
  page?: number;
  scroll?: number;
  zoom?: number;
  activePdfId?: string | null;
  activePdfName?: string | null;
  isActive?: boolean;
  lastSeen?: number;
}

// ── Library ───────────────────────────────────────────────────────────────────

export interface LibraryData {
  id: string;
  name: string;
  icon_url: string | null;
  owner_id: string;
  invite_code: string;
  created_at: string;
}

// ── Room (was "channel") ──────────────────────────────────────────────────────

export interface RoomData {
  id: string;
  library_id: string;
  /** Kept as server_id for workspaceStore backward compat */
  server_id: string;
  name: string;
  description: string | null;
  type: 'text' | 'pdf';
  position: number;
  current_page: number;
  scroll_pct: number;
  zoom: number;
  current_pdf_id: string | null;
  created_at: string;
  updated_at: string;
}

// ── PDF ───────────────────────────────────────────────────────────────────────

export interface PDFMeta {
  fileId: string;
  filename: string;
  owner: string;
  thumbnail: string | null;
  totalPages: number | null;
  url?: string | null;
}

/** Serialized room_pdfs row (frontend shape) */
export interface ChannelPDF {
  id: string;
  channelId: string;   // = roomId
  roomId: string;
  driveId: string;
  filename: string;
  thumbnailUrl: string | null;
  storagePath?: string | null;
  url?: string | null;
  position: number;
  folderId?: string | null;
  createdAt: string;
}

export interface PDFFolder {
  id: string;
  roomId: string;
  parentId: string | null;
  name: string;
  position: number;
  createdAt: string;
  children: PDFFolder[];
  pdfs: ChannelPDF[];
}

// ── Room state ────────────────────────────────────────────────────────────────

export interface RoomState {
  id: string;
  name: string;
  createdBy: string;
  createdAt: string;
  pdf: PDFMeta | null;
  currentPage: number;
  scrollPct: number;
  zoom: number;
}

export interface SyncPayload {
  roomId: string;
  userId: string;
  activePdfId?: string | null;
  activePdfName?: string | null;
  page: number;
  scroll: number;
  zoom: number;
  ts: number;
}

// ── Messages ──────────────────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  roomId: string;
  userId: string;
  userName: string;
  avatarColor: string;
  avatarUrl?: string | null;
  content: string;
  attachmentUrl?: string | null;
  attachmentType?: 'image' | 'pdf' | 'link' | null;
  deleted?: boolean;
  editedAt?: string | null;
  ts: number;
  createdAt?: string;
}

// ── Activity / Notifications ──────────────────────────────────────────────────

export interface RoomActivity {
  id: string;
  roomId: string;
  type: 'chat:message' | 'pdf:added' | 'presence:join' | 'presence:left' | 'mention' | 'room:activity' | 'library:updated';
  title: string;
  body?: string;
  userId?: string;
  userName?: string;
  ts: number;
  metadata?: Record<string, unknown>;
}

// ── Notes ─────────────────────────────────────────────────────────────────────

export interface RoomNote {
  id: string;
  roomId: string;
  userId: string;
  content: string;
  pageNum: number | null;
  createdAt: string;
}

// ── Connection ────────────────────────────────────────────────────────────────

export type ConnectionStatus = 'connected' | 'connecting' | 'reconnecting' | 'disconnected' | 'error';
export type PDFLoadState = 'idle' | 'loading' | 'ready' | 'error';

export interface PageDimension { width: number; height: number; }
export interface VisibleRange { start: number; end: number; }

// ── Google Drive ──────────────────────────────────────────────────────────────

export interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  thumbnailLink?: string;
  owners?: Array<{ emailAddress: string }>;
}

// ── Socket.io event maps ──────────────────────────────────────────────────────

export interface ClientToServerEvents {
  'room:join':             (payload: { roomId: string; user: UserMeta }) => void;
  'room:leave':            (payload: { roomId: string; userId: string }) => void;
  'sync:state':            (payload: SyncPayload) => void;
  'presence:update':       (payload: { roomId: string; user: Partial<UserMeta> }) => void;
  'chat:message':          (payload: ChatMessage) => void;
  'pdf:added':             (payload: RoomActivity) => void;
  'library:updated':       (payload: RoomActivity) => void;
  'notification:activity': (payload: RoomActivity) => void;
  'presence:ping':         (payload: { roomId: string; userId: string }) => void;
  'profile:updated':       (payload: { userId: string; userName: string; avatarUrl: string | null; avatarColor: string; avatarInitials: string }) => void;
}

export interface ServerToClientEvents {
  'room:state':            (payload: RoomState) => void;
  'sync:state':            (payload: SyncPayload) => void;
  'presence:list':         (payload: UserMeta[]) => void;
  'presence:join':         (payload: UserMeta) => void;
  'presence:update':       (payload: UserMeta) => void;
  'presence:left':         (payload: { userId: string }) => void;
  'chat:message':          (payload: ChatMessage) => void;
  'pdf:added':             (payload: RoomActivity) => void;
  'library:updated':       (payload: RoomActivity) => void;
  'notification:activity': (payload: RoomActivity) => void;
  'room:error':            (payload: { message: string }) => void;
  'profile:updated':       (payload: { userId: string; userName: string; avatarUrl: string | null; avatarColor: string; avatarInitials: string }) => void;
}
