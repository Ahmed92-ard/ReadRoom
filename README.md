# PDF Reading Room

A production-ready real-time collaborative PDF workspace — an installable PWA where users read PDFs together in sync, like a "voice channel but for reading."

---

## Quick Start

```bash
# 1. Clone and install
npm install

# 2. Configure environment (copy and fill in)
cp .env.local.example .env.local

# 3. Run database migrations (Supabase SQL editor)
# → paste contents of lib/supabase/schema.sql

# 4. Start development server
npm run dev
```

---

## Environment Variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Your Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role (server-side) |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Google OAuth 2.0 client ID |
| `NEXT_PUBLIC_GOOGLE_API_KEY` | Google API key (for Picker) |
| `NEXT_PUBLIC_GOOGLE_APP_ID` | Google Cloud project number |
| `NEXT_PUBLIC_APP_URL` | Full public URL (e.g. https://yourapp.com) |

---

## Google Cloud Setup

1. Go to [console.cloud.google.com](https://console.cloud.google.com)
2. Create a project (note the **Project Number** → `NEXT_PUBLIC_GOOGLE_APP_ID`)
3. Enable: **Google Drive API**, **Google Picker API**
4. Create OAuth 2.0 credentials:
   - Type: **Web application**
   - Add your domain to Authorized JavaScript Origins
5. Create an API Key → restrict to **Google Picker API** + your domain
6. Set `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (OAuth client ID)
7. Set `NEXT_PUBLIC_GOOGLE_API_KEY` (API key)

---

## Architecture Summary

```
Browser
  ├── Next.js App Router (SSR room metadata)
  ├── PDF.js (client-side rendering, no server processing)
  ├── Socket.io Client (real-time sync over WebSocket)
  └── Zustand (roomStore, pdfStore, presenceStore, uiStore)

Custom HTTP Server (server.ts)
  ├── Next.js request handler
  └── Socket.io Server
        ├── room:join / room:leave
        ├── sync:state (page, scroll, zoom — 100ms throttle)
        ├── chat:message
        └── presence:ping

Supabase (Postgres)
  ├── rooms (persistent room state + PDF metadata)
  ├── room_notes (per-page notes)
  └── room_chat_messages (last 200 msgs)

Upstash Redis
  ├── presence:{roomId}:{userId} (TTL 30s, pinged every 15s)
  └── room:sync:{roomId} (latest sync state for late joiners)
```

---

## Key Design Decisions

### Why not store PDFs?
Google Drive CDN serves the PDF directly to each client with their own OAuth token. This means:
- Zero storage costs
- No GDPR/data liability for PDF content  
- Drive's own access controls apply
- No re-upload friction

### Sync payload size
The sync payload is intentionally minimal (~200 bytes):
```json
{ "roomId": "abc123", "userId": "xyz", "page": 42, "scroll": 0.3751, "zoom": 1.0, "ts": 1716123456789 }
```
At 10 users syncing every 100ms = ~20KB/s total bandwidth.

### Scroll sync by percentage (not pixels)
Different users have different viewport sizes, zoom levels, and DPR. Syncing by normalized `scroll_pct` (0.0–1.0) ensures everyone sees the same relative position regardless of device.

### Virtualization
Only pages within `visibleRange ± 1` are rendered. A page of 1000 pages only has 3–5 active canvases at any time. Pages outside this range are placeholder `<div>` elements with cached dimensions to prevent layout reflow.

### Low-end Android optimizations
- `devicePixelRatio` capped at 1.5 (saves 44% canvas memory vs 2x)
- Render buffer reduced from ±1 to ±0 pages
- Animations disabled via `prefers-reduced-motion`
- `hardwareConcurrency <= 2` detection triggers low-end mode

---

## Deployment

### Vercel (recommended for Next.js)
> ⚠️ Socket.io requires a persistent WebSocket connection.  
> Use Vercel's custom server or deploy the Socket.io layer separately.

**Option A: Railway / Render (easiest)**
```bash
# Set all env vars in dashboard
# Start command: npm start
# Build command: npm run build
```

**Option B: Docker**
```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

**Option C: Vercel + separate Socket.io server**
- Deploy Next.js to Vercel (disable custom server)
- Deploy `lib/socket/server.ts` as a standalone Express+Socket.io service
- Point `NEXT_PUBLIC_APP_URL` to the socket server URL

---

## File Structure

```
pdf-reading-room/
├── app/
│   ├── layout.tsx               # Root layout + theme init
│   ├── page.tsx                 # Landing / room creation
│   └── room/[id]/page.tsx       # Room page
├── components/
│   ├── pdf/
│   │   ├── PDFViewer.tsx        # Main viewer + toolbar
│   │   ├── VirtualizedPages.tsx # Windowed page renderer
│   │   └── PageCanvas.tsx       # Single PDF.js canvas
│   ├── room/
│   │   ├── RoomShell.tsx        # Layout + sidebar + mobile sheet
│   │   ├── PresenceBar.tsx      # Avatar row + status
│   │   └── Chat.tsx             # Real-time chat
│   ├── drive/
│   │   └── GooglePicker.tsx     # Drive file picker modal
│   ├── ui/
│   │   ├── Avatar.tsx
│   │   ├── StatusBadge.tsx
│   │   ├── FollowToggle.tsx
│   │   └── ThemeToggle.tsx
│   └── pwa/
│       └── InstallPrompt.tsx
├── lib/
│   ├── socket/client.ts         # Socket singleton
│   ├── socket/server.ts         # Socket.io server init
│   ├── hooks/index.ts           # usePDFSync, usePresence, useRoom, useGoogleAuth
│   ├── supabase/client.ts
│   ├── supabase/server.ts
│   └── redis/client.ts
├── store/index.ts               # All Zustand stores
├── types/index.ts               # Shared TypeScript types
├── styles/globals.css           # Tailwind + CSS design tokens
├── public/
│   ├── manifest.json            # PWA manifest
│   ├── sw.js                    # Service worker
│   └── offline.html
├── server.ts                    # Custom HTTP server (Socket.io)
├── next.config.ts
├── tailwind.config.ts
└── package.json
```

---

## PWA Installation

The app registers a service worker and responds to the `beforeinstallprompt` event. Users will see an install banner after their first visit. Once installed:
- Works offline with cached app shell
- Opens like a native app (no browser chrome)
- Works on Android, Windows, macOS, Linux

---

## License

MIT
