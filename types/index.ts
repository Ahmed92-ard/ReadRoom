// types/index.ts

export interface UserMeta {
  userId: string;
  userName: string;
  avatarColor: string; // hex
  avatarInitials: string;
  avatarUrl?: string | null; // optional uploaded profile image
  joinedAt: number; // epoch ms
  isFollowing: boolean;
  page?: number;
  scroll?: number;
  zoom?: number;
  activePdfId?: string | null;
  activePdfName?: string | null;
  isActive?: boolean;
  lastSeen?: number;
}

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
  channelId: string;
  driveId: string;
  filename: string;
  thumbnailUrl: string | null;
  storagePath?: string | null;
  url?: string | null;
  position: number;
  createdAt: string;
}

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
  scroll: number; // 0.0 – 1.0
  zoom: number;
  ts: number;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  userId: string;
  userName: string;
  avatarColor: string;
  content: string;
  ts: number;
}

export interface RoomActivity {
  id: string;
  roomId: string;
  type: 'chat:message' | 'pdf:added' | 'presence:join' | 'presence:left' | 'mention' | 'room:activity';
  title: string;
  body?: string;
  userId?: string;
  userName?: string;
  ts: number;
  metadata?: Record<string, unknown>;
}

export interface RoomNote {
  id: string;
  roomId: string;
  userId: string;
  content: string;
  pageNum: number | null;
  createdAt: string;
}

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

// Socket.io typed event maps
export interface ClientToServerEvents {
  'room:join': (payload: { roomId: string; user: UserMeta }) => void;
  'room:leave': (payload: { roomId: string; userId: string }) => void;
  'sync:state': (payload: SyncPayload) => void;
  'presence:update': (payload: { roomId: string; user: Partial<UserMeta> }) => void;
  'chat:message': (payload: ChatMessage) => void;
  'pdf:added': (payload: RoomActivity) => void;
  'library:updated': (payload: RoomActivity) => void;
  'notification:activity': (payload: RoomActivity) => void;
  'presence:ping': (payload: { roomId: string; userId: string }) => void;
}

export interface ServerToClientEvents {
  'room:state': (payload: RoomState) => void;
  'sync:state': (payload: SyncPayload) => void;
  'presence:list': (payload: UserMeta[]) => void;
  'presence:join': (payload: UserMeta) => void;
  'presence:update': (payload: UserMeta) => void;
  'presence:left': (payload: { userId: string }) => void;
  'chat:message': (payload: ChatMessage) => void;
  'pdf:added': (payload: RoomActivity) => void;
  'library:updated': (payload: RoomActivity) => void;
  'notification:activity': (payload: RoomActivity) => void;
  'room:error': (payload: { message: string }) => void;
}

export interface GoogleDriveFile {
  id: string;
  name: string;
  mimeType: string;
  thumbnailLink?: string;
  owners?: Array<{ emailAddress: string }>;
}
