// types/index.ts — canonical shared types for ReadRoom

// ── User / Profile ────────────────────────────────────────────────────────────

/** Persistent profile stored in Supabase `users` table */
export interface UserProfile {
  id: string;           // UUID — matches auth.users.id
  email: string | null;
  displayName: string;
  avatarUrl: string | null;
  bio?: string | null;
  username?: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Ephemeral presence metadata (socket / Redis) */
export interface UserMeta {
  userId: string;
  userName: string;
  avatarColor: string;       // hex
  avatarInitials: string;
  avatarUrl?: string | null; // from UserProfile.avatarUrl
  joinedAt: number;          // epoch ms
  isFollowing: boolean;
  page?: number;
  scroll?: number;
  zoom?: number;
  activePdfId?: string | null;
  activePdfName?: string | null;
  isActive?: boolean;
  lastSeen?: number;
}

// ── Library / Room ────────────────────────────────────────────────────────────

/** A library (was "server" in DB) */
export interface LibraryData {
  id: string;
  name: string;
  iconUrl: string | null;
  ownerId: string;
  inviteCode: string;
  createdAt: string;
}

/** A room inside a library (was "channel" in DB) */
export interface RoomData {
  id: string;
  libraryId: string;
  name: string;
  description: string | null;
  type: 'text' | 'pdf';
  position: number;
  currentPage: number;
  scrollPct: number;
  zoom: number;
  currentPdfId: string | null;
  createdAt: string;
  updatedAt: string;
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

export interface ChannelPDF {
  id: string;
  /** room_id in DB — kept as channelId in frontend for backward compat */
  channelId: string;
  driveId: string;
  filename: string;
  thumbnailUrl: string | null;
  storagePath?: string | null;
  url?: string | null;
  position: number;
  folderId?: string | null;
  createdAt: string;
}

/** A folder that can contain PDFs (Google Drive-style) */
export interface PDFFolder {
  id: string;
  roomId: string;
  parentId: string | null;
  name: string;
  position: number;
  createdAt: string;
  /** Client-side: child folders */
  children?: PDFFolder[];
  /** Client-side: PDFs directly in this folder */
  pdfs?: ChannelPDF[];
}

// ── Room State ────────────────────────────────────────────────────────────────

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
  scroll: number;   // 0.0 – 1.0
  zoom: number;
  ts: number;
}

// ── Messages ──────────────────────────────────────────────────────────────────

/** Persistent chat message stored in Supabase `messages` table */
export interface ChatMessage {
  id: string;
  roomId: string;
  userId: string;       // sender_id (UUID)
  userName: string;     // denormalized sender_name
  avatarColor: string;
  avatarUrl?: string | null;
  content: string;
  attachmentUrl?: string | null;
  attachmentType?: 'image' | 'pdf' | 'link' | null;
  deleted?: boolean;
  editedAt?: string | null;
  ts: number;           // created_at as epoch ms (for socket compat)
  createdAt?: string;   // ISO string from DB
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

export type ConnectionStatus =
  | 'connected'
  | 'connecting'
  | 'reconnecting'
  | 'disconnected'
  | 'error';

export type PDFLoadState =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'error';

export interface PageDimension {
  width: number;
  height: number;
}

export interface VisibleRange {
  start: number;
  end: number;
}

// ── Google Drive ──────────────────────────────────────────────────────────────

export interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  thumbnailLink?: string;
  owners?: Array<{ emailAddress: string }>;
}

export interface GoogleDriveFolder {
  id: string;
  name: string;
  mimeType: 'application/vnd.google-apps.folder';
  children?: GoogleDriveFile[];
}

// ── Socket.io typed event maps ────────────────────────────────────────────────

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
