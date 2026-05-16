# ReadRoom — System Architecture

## 1. System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        CLIENT (Next.js PWA)                      │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────┐   │
│  │ Google Drive │  │  PDF.js      │  │  Socket.io Client    │   │
│  │ Picker API   │  │  Renderer    │  │  (sync layer)        │   │
│  └──────┬───────┘  └──────┬───────┘  └──────────┬───────────┘   │
│         │                 │                      │               │
│  ┌──────▼─────────────────▼──────────────────────▼───────────┐  │
│  │              React State (Zustand)                         │  │
│  │   roomStore | pdfStore | presenceStore | uiStore           │  │
│  └──────────────────────────────────────────────────────────-─┘  │
└─────────────────────────────────────────────────────────────────┘
          │ HTTPS/WSS          │ Drive API (client-side only)
          ▼                    ▼
┌─────────────────┐   ┌─────────────────────┐
│  Next.js API    │   │   Google OAuth 2.0  │
│  /api/rooms     │   │   Picker API v3     │
│  /api/presence  │   └─────────────────────┘
└────────┬────────┘
         │
    ┌────▼────┐
    │Supabase │  ← rooms, pages, notes (Postgres)
    │  DB     │
    └────┬────┘
         │
    ┌────▼──────┐
    │  Socket.io│  ← presence, scroll, chat (ephemeral)
    │  Server   │  ← backed by Upstash Redis pub/sub
    └───────────┘
```

## 2. Folder Structure

```
pdf-reading-room/
├── app/
│   ├── layout.tsx                  # Root layout with ThemeProvider
│   ├── page.tsx                    # Landing / room creation
│   ├── room/
│   │   └── [id]/
│   │       ├── page.tsx            # Room page (SSR room metadata)
│   │       └── loading.tsx         # Skeleton loader
│   └── api/
│       ├── rooms/
│       │   ├── route.ts            # POST: create room
│       │   └── [id]/
│       │       └── route.ts        # GET/PATCH: room state
│       ├── socket/
│       │   └── route.ts            # Socket.io upgrade handler
│       └── presence/
│           └── route.ts            # GET: room presence snapshot
├── components/
│   ├── pdf/
│   │   ├── PDFViewer.tsx           # Main viewer orchestrator
│   │   ├── VirtualizedPages.tsx    # Windowed page renderer
│   │   ├── PageCanvas.tsx          # Single PDF.js canvas
│   │   └── PageOverlay.tsx         # Annotations / cursor overlay
│   ├── room/
│   │   ├── RoomShell.tsx           # Layout shell (desktop/mobile)
│   │   ├── Sidebar.tsx             # Desktop persistent sidebar
│   │   ├── BottomSheet.tsx         # Mobile bottom drawer
│   │   ├── Chat.tsx                # Real-time chat
│   │   ├── PresenceBar.tsx         # Avatar row + status
│   │   └── Notes.tsx               # Quick notes panel
│   ├── drive/
│   │   └── GooglePicker.tsx        # Drive picker modal
│   ├── ui/
│   │   ├── StatusBadge.tsx         # Synced/Connecting/Offline
│   │   ├── Avatar.tsx              # Colored user avatar
│   │   ├── FollowToggle.tsx        # Follow-me mode toggle
│   │   └── ThemeToggle.tsx         # Dark/light switch
│   └── pwa/
│       └── InstallPrompt.tsx       # PWA install banner
├── lib/
│   ├── socket/
│   │   ├── client.ts               # Singleton socket client
│   │   ├── server.ts               # Socket.io server setup
│   │   └── events.ts               # Typed event definitions
│   ├── pdf/
│   │   ├── worker.ts               # PDF.js worker config
│   │   └── renderer.ts             # Page render utilities
│   ├── supabase/
│   │   ├── client.ts               # Browser Supabase client
│   │   ├── server.ts               # Server Supabase client
│   │   └── schema.sql              # DB schema
│   ├── redis/
│   │   └── client.ts               # Upstash Redis client
│   └── hooks/
│       ├── useRoom.ts              # Room state + sync
│       ├── usePDFSync.ts           # Scroll/page sync
│       ├── usePresence.ts          # Presence management
│       ├── useGoogleAuth.ts        # OAuth token management
│       └── useVirtualizer.ts       # Custom scroll virtualizer
├── store/
│   ├── roomStore.ts                # Zustand: room state
│   ├── pdfStore.ts                 # Zustand: PDF view state
│   ├── presenceStore.ts            # Zustand: online users
│   └── uiStore.ts                  # Zustand: UI toggles
├── types/
│   └── index.ts                    # All shared TypeScript types
├── public/
│   ├── manifest.json               # PWA manifest
│   ├── sw.js                       # Service worker
│   ├── icons/                      # PWA icons (72–512px)
│   └── offline.html                # Offline fallback
├── styles/
│   └── globals.css                 # Tailwind + CSS variables
├── next.config.ts
├── tailwind.config.ts
└── package.json
```

## 3. Database Schema (Supabase / Postgres)

```sql
-- rooms table
CREATE TABLE rooms (
  id            TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  name          TEXT NOT NULL,
  created_by    TEXT NOT NULL,           -- Google sub id
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW(),

  -- PDF state (persisted)
  pdf_file_id   TEXT,                    -- Google Drive fileId
  pdf_filename  TEXT,
  pdf_thumbnail TEXT,
  pdf_owner     TEXT,                    -- Drive owner email

  -- Reading state
  current_page  INT NOT NULL DEFAULT 1,
  scroll_pct    FLOAT NOT NULL DEFAULT 0,
  zoom          FLOAT NOT NULL DEFAULT 1.0,
  total_pages   INT,

  CONSTRAINT rooms_id_length CHECK (char_length(id) > 0)
);

-- room_notes table
CREATE TABLE room_notes (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id    TEXT REFERENCES rooms(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL,
  content    TEXT NOT NULL,
  page_num   INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- room_chat_messages table (persist last 200)
CREATE TABLE room_chat_messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  room_id    TEXT REFERENCES rooms(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL,
  user_name  TEXT NOT NULL,
  avatar_color TEXT NOT NULL,
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_rooms_created_by ON rooms(created_by);
CREATE INDEX idx_notes_room ON room_notes(room_id);
CREATE INDEX idx_chat_room_time ON room_chat_messages(room_id, created_at DESC);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER rooms_updated_at
  BEFORE UPDATE ON rooms
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

## 4. Socket.io Event Schema

```typescript
// CLIENT → SERVER
interface ClientToServerEvents {
  'room:join':     (payload: { roomId: string; user: UserMeta }) => void;
  'room:leave':    (payload: { roomId: string; userId: string }) => void;
  'sync:state':    (payload: SyncPayload) => void;      // throttled 100ms
  'chat:message':  (payload: ChatPayload) => void;
  'presence:ping': (payload: { roomId: string; userId: string }) => void;
}

// SERVER → CLIENT
interface ServerToClientEvents {
  'room:state':     (payload: RoomState) => void;       // on join: full state
  'sync:state':     (payload: SyncPayload) => void;     // broadcast to room
  'presence:list':  (payload: UserMeta[]) => void;      // full presence list
  'presence:join':  (payload: UserMeta) => void;        // someone joined
  'presence:leave': (payload: { userId: string }) => void;
  'chat:message':   (payload: ChatPayload) => void;
  'room:error':     (payload: { message: string }) => void;
}

// Sync payload — keep under 200 bytes
interface SyncPayload {
  roomId:  string;       // ~36 chars
  userId:  string;       // ~20 chars
  page:    number;       // int
  scroll:  number;       // 0.0–1.0, 4 decimal places
  zoom:    number;       // 0.5–4.0
  ts:      number;       // epoch ms (for conflict resolution)
}

// Chat payload
interface ChatPayload {
  roomId:    string;
  userId:    string;
  userName:  string;
  avatarColor: string;
  content:   string;     // max 500 chars
  ts:        number;
}
```

## 5. State Management Strategy

**Zustand** (no context hell, minimal re-renders):

```
roomStore     → roomId, roomName, pdfMeta, lastSaved
pdfStore      → page, scroll, zoom, totalPages, followMode, loadingState
presenceStore → Map<userId, UserMeta>, self
uiStore       → sidebarOpen, theme, installPrompt, connectionStatus
```

**Rules:**
- Socket events update stores directly (no Redux dispatch overhead)
- `pdfStore.scroll` updates are throttled at the store level (100ms)
- `presenceStore` uses `Map` for O(1) user lookup
- Selectors memoized with `useShallow` to prevent unnecessary renders

## 6. Rendering Optimization Strategy

**PDF.js Virtualization:**
- Maintain a `visibleRange: [startPage, endPage]` computed from scroll position
- Render only `visibleRange ± 1` pages (buffer zone)
- Pages outside buffer are replaced with placeholder `<div>` matching cached dimensions
- Page dimensions cached after first render to prevent layout shift
- Canvas rendered at `devicePixelRatio` for retina, downscaled via CSS transform on low-end
- Render queue: pending renders canceled via `renderTask.cancel()` on scroll

**requestAnimationFrame usage:**
- Scroll sync fires inside rAF callback
- Page transitions use rAF for smooth seek
- Presence cursor positions batched per frame

**Throttling:**
- Scroll events: 16ms (rAF) locally, 100ms for socket broadcast
- Zoom events: debounced 300ms before re-render
- Chat typing: debounced 500ms

## 7. Mobile Optimization Strategy

**Layout:**
- `< 768px`: bottom sheet replaces sidebar, full-viewport PDF canvas
- PDF container: `height: calc(100dvh - 56px)` (avoids mobile chrome bar issues)
- Bottom sheet: `transform: translateY()` driven by pan gesture

**Touch handling:**
- `touchstart` / `touchmove` / `touchend` with `passive: true` listeners
- Pinch-to-zoom via two-pointer distance delta
- Swipe left/right for page turn (threshold 50px)
- All tap targets minimum `44×44px` per Apple HIG

**Performance:**
- GPU layers: `transform: translate3d(0,0,0)` on PDF canvas and sidebar
- `will-change: transform` only applied during active animation, removed after
- Image decoding: `loading="lazy"` on thumbnails
- Service worker pre-caches app shell; PDF served directly from Drive CDN

**Low-end Android:**
- Detect `navigator.hardwareConcurrency <= 2` → disable animations, reduce buffer to ±0 pages
- `navigator.connection.effectiveType === '2g'` → show "Low bandwidth" warning
- Canvas pixel ratio capped at 1.5 on low-end devices
