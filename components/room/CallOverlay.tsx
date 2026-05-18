'use client';

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { 
  LiveKitRoom, 
  useTracks, 
  useParticipants, 
  useLocalParticipant, 
  VideoTrack, 
  RoomAudioRenderer 
} from '@livekit/components-react';
import { Track } from 'livekit-client';
import { 
  Mic, 
  MicOff, 
  Video as VideoIcon, 
  VideoOff, 
  PhoneOff, 
  GripHorizontal, 
  Minimize2, 
  Maximize2, 
  AlertCircle, 
  X,
  Volume2
} from 'lucide-react';
import { stringToColor, makeInitials } from '@/lib/utils/avatar';
import { usePresenceStore } from '@/store/presenceStore';

interface CallOverlayProps {
  roomId: string;
  userId: string;
  userName: string;
}

export function CallOverlay({ roomId, userId, userName }: CallOverlayProps) {
  const [token, setToken] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isMinimized, setIsMinimized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConfigError, setIsConfigError] = useState(false);

  // Resize State & Ref
  const [dimensions, setDimensions] = useState({ width: 280, height: 360 });
  const [isResizing, setIsResizing] = useState(false);
  const resizeStartRef = useRef({ x: 0, y: 0, w: 280, h: 360 });

  // Dragging state
  const [position, setPosition] = useState({ x: 20, y: 80 }); // Default bottom-left / top-right spacing
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);

  // Position initialized on mount/resize
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const widgetWidth = isMinimized ? 190 : dimensions.width;
      const widgetHeight = isMinimized ? 52 : dimensions.height;
      const defaultX = window.innerWidth - widgetWidth - 16;
      // Subtract safe bottom offset (80px in mobile for navigation sheets, 16px in desktop)
      const bottomOffset = window.innerWidth < 768 ? 80 : 16;
      const defaultY = window.innerHeight - widgetHeight - bottomOffset;
      setPosition({ x: Math.max(16, defaultX), y: Math.max(80, defaultY) });
    }
  }, []);

  // Keep widget within screen boundaries on window resize or rotation
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleResize = () => {
      setPosition((prev) => {
        const widgetWidth = isMinimized ? 180 : dimensions.width;
        const widgetHeight = isMinimized ? 52 : dimensions.height;
        const maxX = window.innerWidth - widgetWidth - 16;
        const maxY = window.innerHeight - widgetHeight - 16;

        return {
          x: Math.max(16, Math.min(maxX, prev.x)),
          y: Math.max(80, Math.min(maxY, prev.y))
        };
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [isMinimized, dimensions]);

  // Listen to the chat-header "Join Call" trigger event
  useEffect(() => {
    const handleJoinEvent = () => {
      if (!isConnected && !isConnecting) {
        handleJoinCall();
      } else {
        // Focus and maximize if already connected
        setIsMinimized(false);
        if (typeof window !== 'undefined') {
          const defaultX = window.innerWidth - dimensions.width - 16;
          const defaultY = window.innerHeight - (isMinimized ? 52 : dimensions.height) - 16;
          setPosition({ x: Math.max(16, defaultX), y: Math.max(80, defaultY) });
        }
      }
    };
    window.addEventListener('readroom-join-call', handleJoinEvent);

    // Trigger auto-join if routed via a push notification click
    try {
      if (sessionStorage.getItem('__readroom_join_call_pending__') === '1') {
        sessionStorage.removeItem('__readroom_join_call_pending__');
        handleJoinEvent();
      }
    } catch {}

    return () => window.removeEventListener('readroom-join-call', handleJoinEvent);
  }, [isConnected, isConnecting, dimensions, isMinimized]);

  // Fetch token and join
  const handleJoinCall = async () => {
    setError(null);
    setIsConfigError(false);
    setIsConnecting(true);

    try {
      const res = await fetch(`/api/livekit/token?roomId=${roomId}&userId=${userId}&userName=${encodeURIComponent(userName)}`);
      const data = await res.json().catch(() => ({}));
      
      if (!res.ok) {
        throw new Error(data.error || 'Failed to fetch calling session');
      }

      if (data.status === 'unconfigured') {
        setIsConfigError(true);
        setIsConnecting(false);
        return;
      }

      setToken(data.token);
      setUrl(data.url);
      setIsConnected(true);

      // Notify other library members of this incoming call (non-blocking)
      fetch(`/api/rooms/${roomId}/call/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ callerName: userName }),
      }).catch((notifyErr) => {
        console.warn('[CallOverlay] Failed to dispatch push notifications:', notifyErr);
      });
    } catch (err) {
      console.error('[CallOverlay] Failed to join call:', err);
      setError(err instanceof Error ? err.message : 'Calling server unreachable');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleDisconnected = useCallback(() => {
    setIsConnected(false);
    setToken(null);
    setUrl(null);
  }, []);

  // Drag handlers
  const handleDragStart = (clientX: number, clientY: number) => {
    isDraggingRef.current = true;
    setIsDragging(true);
    dragStartRef.current = {
      x: clientX - position.x,
      y: clientY - position.y
    };
  };

  const handleDragMove = useCallback((clientX: number, clientY: number) => {
    if (!isDraggingRef.current) return;

    let newX = clientX - dragStartRef.current.x;
    let newY = clientY - dragStartRef.current.y;

    if (typeof window !== 'undefined') {
      const widgetWidth = isMinimized ? 180 : dimensions.width;
      const widgetHeight = isMinimized ? 52 : dimensions.height;
      const maxX = window.innerWidth - widgetWidth - 16;
      const maxY = window.innerHeight - widgetHeight - 16;

      newX = Math.max(16, Math.min(maxX, newX));
      newY = Math.max(80, Math.min(maxY, newY));
    }

    setPosition({ x: newX, y: newY });
  }, [isMinimized, dimensions]);

  const handleDragEnd = useCallback(() => {
    isDraggingRef.current = false;
    setIsDragging(false);
  }, []);

  // Custom Resize handlers
  const handleResizeStart = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsResizing(true);
    resizeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      w: dimensions.width,
      h: dimensions.height
    };
  };

  const handleResizeTouchStart = (e: React.TouchEvent) => {
    const touch = e.touches[0];
    if (!touch) return;
    e.stopPropagation();
    setIsResizing(true);
    resizeStartRef.current = {
      x: touch.clientX,
      y: touch.clientY,
      w: dimensions.width,
      h: dimensions.height
    };
  };

  const handleResizeMove = useCallback((clientX: number, clientY: number) => {
    if (!isResizing) return;

    const deltaX = clientX - resizeStartRef.current.x;
    const deltaY = clientY - resizeStartRef.current.y;

    let newWidth = resizeStartRef.current.w + deltaX;
    let newHeight = resizeStartRef.current.h + deltaY;

    // Enforce min and max dimensions
    newWidth = Math.max(260, Math.min(600, newWidth));
    newHeight = Math.max(280, Math.min(600, newHeight));

    // Ensure it doesn't expand off-screen
    if (typeof window !== 'undefined') {
      const maxX = window.innerWidth - position.x - 16;
      const maxY = window.innerHeight - position.y - 16;
      newWidth = Math.min(newWidth, Math.max(260, maxX));
      newHeight = Math.min(newHeight, Math.max(280, maxY));
    }

    setDimensions({ width: newWidth, height: newHeight });
  }, [isResizing, position]);

  // Window event listeners for seamless drag and resize support
  useEffect(() => {
    if (!isDragging && !isResizing) return;

    const onMouseMove = (e: MouseEvent) => {
      if (isDragging) handleDragMove(e.clientX, e.clientY);
      else if (isResizing) handleResizeMove(e.clientX, e.clientY);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches[0]) {
        if (isDragging) handleDragMove(e.touches[0].clientX, e.touches[0].clientY);
        else if (isResizing) handleResizeMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    };

    const onMouseUp = () => {
      setIsDragging(false);
      setIsResizing(false);
      isDraggingRef.current = false;
    };
    const onTouchEnd = () => {
      setIsDragging(false);
      setIsResizing(false);
      isDraggingRef.current = false;
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('touchmove', onTouchMove, { passive: true });
    window.addEventListener('touchend', onTouchEnd);

    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', onTouchEnd);
    };
  }, [isDragging, isResizing, handleDragMove, handleResizeMove, handleDragEnd]);

  // Render Setup Configuration Helper
  if (isConfigError) {
    return (
      <div 
        style={{ left: position.x, top: position.y }}
        className="absolute z-[999] w-[320px] rounded-2xl border border-slate-700 bg-slate-900/95 p-4 shadow-2xl backdrop-blur-xl pointer-events-auto transition-all text-slate-100"
      >
        <div className="flex items-center justify-between mb-3 border-b border-slate-800 pb-2">
          <div className="flex items-center gap-2 text-indigo-400 font-semibold text-sm">
            <AlertCircle size={18} />
            <span>Voice Call Config</span>
          </div>
          <button 
            onClick={() => setIsConfigError(false)}
            className="rounded p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
          >
            <X size={16} />
          </button>
        </div>
        <p className="text-xs text-slate-300 leading-relaxed mb-4">
          To enable calling features in ReadRoom, add these key settings to your <code className="bg-slate-950 px-1 py-0.5 rounded text-amber-300">.env.local</code> file and restart the server:
        </p>
        <pre className="text-[10px] bg-slate-950 p-2.5 rounded-lg text-emerald-400 overflow-x-auto select-all leading-normal">
{`NEXT_PUBLIC_LIVEKIT_URL=wss://...
LIVEKIT_API_KEY=your-api-key
LIVEKIT_API_SECRET=your-api-secret`}
        </pre>
        <p className="text-[10px] text-slate-400 mt-3 text-center">
          Get free Cloud sandbox keys from <a href="https://livekit.io" target="_blank" rel="noreferrer" className="text-indigo-400 underline">livekit.io</a>.
        </p>
      </div>
    );
  }

  // Render Connected Call UI using LiveKit Room context
  if (isConnected && token && url) {
    return (
      <LiveKitRoom
        token={token}
        serverUrl={url}
        connect={true}
        audio={true}
        video={false}
        onDisconnected={handleDisconnected}
        connectOptions={{ autoSubscribe: true }}
      >
        <div 
          style={{ left: position.x, top: position.y }}
          className="absolute z-[999] pointer-events-auto transition-transform"
        >
          <InnerCallWidget 
            isMinimized={isMinimized}
            setIsMinimized={setIsMinimized}
            handleDragStart={handleDragStart}
            handleDisconnect={handleDisconnected}
            userId={userId}
            userName={userName}
            dimensions={dimensions}
            handleResizeStart={handleResizeStart}
            handleResizeTouchStart={handleResizeTouchStart}
          />
        </div>
        <RoomAudioRenderer />
      </LiveKitRoom>
    );
  }

  // Otherwise, render nothing
  return null;
}

// Inner Widget rendering the media state and layout within the LiveKit context
interface InnerCallWidgetProps {
  isMinimized: boolean;
  setIsMinimized: (val: boolean) => void;
  handleDragStart: (clientX: number, clientY: number) => void;
  handleDisconnect: () => void;
  userId: string;
  userName: string;
  dimensions?: { width: number; height: number };
  handleResizeStart?: (e: React.MouseEvent) => void;
  handleResizeTouchStart?: (e: React.TouchEvent) => void;
}

function InnerCallWidget({
  isMinimized,
  setIsMinimized,
  handleDragStart,
  handleDisconnect,
  userId,
  userName,
  dimensions,
  handleResizeStart,
  handleResizeTouchStart
}: InnerCallWidgetProps) {
  const { localParticipant } = useLocalParticipant();
  const participants = useParticipants();
  const videoTracks = useTracks([Track.Source.Camera]);

  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCamOn, setIsCamOn] = useState(false);
  const [focusedParticipantIdentity, setFocusedParticipantIdentity] = useState<string | null>(null);

  // Profile data from globally synchronized presence store
  const selfMeta = usePresenceStore((s) => s.self);
  const remoteUsersMap = usePresenceStore((s) => s.users);

  // Sync mic track
  useEffect(() => {
    if (localParticipant) {
      localParticipant.setMicrophoneEnabled(!isMicMuted).catch(console.error);
    }
  }, [isMicMuted, localParticipant]);

  // Sync camera track
  useEffect(() => {
    if (localParticipant) {
      localParticipant.setCameraEnabled(isCamOn).catch(console.error);
    }
  }, [isCamOn, localParticipant]);

  // Strict Set-based participant deduplication (Resolves Issue 1)
  const allParticipants = useMemo(() => {
    const seen = new Set<string>();
    const uniq: any[] = [];

    if (localParticipant) {
      seen.add(localParticipant.identity);
      uniq.push(localParticipant);
    }

    participants.forEach((p) => {
      if (!seen.has(p.identity)) {
        seen.add(p.identity);
        uniq.push(p);
      }
    });

    return uniq;
  }, [localParticipant, participants]);

  const activeSpeakers = allParticipants.filter((p) => p.isSpeaking);

  const focusedParticipant = allParticipants.find((p) => p.identity === focusedParticipantIdentity);
  const thumbnailParticipants = allParticipants.filter((p) => p.identity !== focusedParticipantIdentity);

  // Resolve camera video track by participant identity
  const getCameraTrack = useCallback((p: any) => {
    return videoTracks.find((t) => t.participant.identity === p.identity);
  }, [videoTracks]);

  // Dynamic Presence profile selector
  const getParticipantMeta = useCallback((identity: string) => {
    if (localParticipant && identity === localParticipant.identity) {
      return selfMeta;
    }
    return remoteUsersMap.get(identity) || null;
  }, [localParticipant, selfMeta, remoteUsersMap]);

  // MINIMIZED MODE: Sleek Capsule/Pill Layout
  if (isMinimized) {
    return (
      <div className="flex h-12 w-[190px] items-center justify-between rounded-full border border-slate-700/60 bg-slate-900/90 pl-3 pr-2 shadow-2xl backdrop-blur-xl">
        {/* Drag handler area */}
        <div 
          onMouseDown={(e) => handleDragStart(e.clientX, e.clientY)}
          onTouchStart={(e) => e.touches[0] && handleDragStart(e.touches[0].clientX, e.touches[0].clientY)}
          className="cursor-grab active:cursor-grabbing mr-1"
          title="Drag Call"
        >
          <GripHorizontal size={14} className="text-slate-500 hover:text-slate-300" />
        </div>

        {/* Speaking / Connection Indicators */}
        <div className="flex-1 min-w-0 flex items-center gap-1.5">
          {activeSpeakers.length > 0 ? (
            <div className="relative flex items-center justify-center">
              {(() => {
                const meta = getParticipantMeta(activeSpeakers[0].identity);
                const avatarUrl = meta?.avatarUrl;
                const avatarColor = meta?.avatarColor || stringToColor(activeSpeakers[0].identity);
                const initials = meta?.avatarInitials || makeInitials(activeSpeakers[0].name || '');

                return (
                  <div 
                    style={{ backgroundColor: avatarColor }}
                    className="w-6 h-6 rounded-full flex items-center justify-center font-bold text-[9px] text-white ring-2 ring-emerald-500 animate-pulse overflow-hidden relative"
                  >
                    {avatarUrl ? (
                      <img 
                        src={avatarUrl} 
                        alt="" 
                        className="w-full h-full object-cover pointer-events-none"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      initials
                    )}
                  </div>
                );
              })()}
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
              <span className="text-[10px] text-slate-300 font-medium font-mono uppercase truncate max-w-[70px]">Connected</span>
            </div>
          )}
          <span className="text-[10px] text-slate-400 font-semibold font-mono">
            ({allParticipants.length})
          </span>
        </div>

        {/* Controls strip */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => setIsMicMuted(!isMicMuted)}
            className={`p-1.5 rounded-full transition-all duration-300 ${
              isMicMuted 
                ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30' 
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            {isMicMuted ? <MicOff size={12} /> : <Mic size={12} />}
          </button>
          
          <button
            onClick={() => setIsMinimized(false)}
            className="p-1.5 rounded-full text-slate-400 hover:text-slate-200 hover:bg-slate-800 transition-colors"
          >
            <Maximize2 size={12} />
          </button>

          <button
            onClick={handleDisconnect}
            className="p-1.5 rounded-full bg-rose-600 hover:bg-rose-500 text-white shadow transition-all duration-300 active:scale-95"
          >
            <PhoneOff size={12} />
          </button>
        </div>
      </div>
    );
  }

  // EXPANDED MODE: Rich Glassmorphic Dock UI
  return (
    <div 
      style={!isMinimized && dimensions ? { width: dimensions.width, height: dimensions.height } : undefined}
      className="w-[280px] rounded-2xl border border-slate-700/60 bg-slate-900/90 p-4 shadow-2xl backdrop-blur-xl text-slate-100 flex flex-col gap-3.5 relative overflow-hidden h-full"
    >
      
      {/* Draggable grip and header */}
      <div 
        onMouseDown={(e) => handleDragStart(e.clientX, e.clientY)}
        onTouchStart={(e) => e.touches[0] && handleDragStart(e.touches[0].clientX, e.touches[0].clientY)}
        className="cursor-grab active:cursor-grabbing flex flex-col gap-1 border-b border-slate-800 pb-2 relative flex-shrink-0"
      >
        <GripHorizontal size={16} className="text-slate-500 hover:text-slate-300 mx-auto transition-colors" />
        <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-400 select-none">
          <div className="flex items-center gap-1.5">
            <Volume2 size={14} className="text-emerald-400" />
            <span>Call</span>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setIsMinimized(true)}
              className="rounded p-1 hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors pointer-events-auto"
              title="Minimize panel"
            >
              <Minimize2 size={13} />
            </button>
          </div>
        </div>
      </div>

      {/* Media elements: Active Video Grid / Enlarged Focus view */}
      {allParticipants.length > 0 && (
        <div className="flex flex-col flex-1 min-h-0">
          {focusedParticipant ? (
            <div className="flex flex-col flex-1 min-h-0">
              {/* Enlarged tile (Focus View) */}
              <div className="relative w-full flex-1 min-h-[120px] bg-slate-950 rounded-xl overflow-hidden border border-slate-700/60 shadow-lg group flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-950">
                {getCameraTrack(focusedParticipant) ? (
                  <VideoTrack trackRef={getCameraTrack(focusedParticipant)!} className="w-full h-full object-cover" />
                ) : (
                  (() => {
                    const meta = getParticipantMeta(focusedParticipant.identity);
                    const avatarUrl = meta?.avatarUrl;
                    const avatarColor = meta?.avatarColor || stringToColor(focusedParticipant.identity);
                    const initials = meta?.avatarInitials || makeInitials(focusedParticipant.name || (focusedParticipant.identity === localParticipant?.identity ? userName : ''));

                    return (
                      <div 
                        style={{ backgroundColor: avatarColor }}
                        className={`w-16 h-16 rounded-full flex items-center justify-center font-bold text-lg text-white shadow-xl overflow-hidden relative transition-all duration-300 ${
                          focusedParticipant.isSpeaking 
                            ? 'ring-4 ring-emerald-500/80 shadow-[0_0_20px_rgba(16,185,129,0.8)] scale-105 animate-pulse' 
                            : 'border-2 border-slate-700'
                        }`}
                      >
                        {avatarUrl ? (
                          <img 
                            src={avatarUrl} 
                            alt={focusedParticipant.name || ''} 
                            className="w-full h-full object-cover pointer-events-none"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        ) : (
                          initials
                        )}
                      </div>
                    );
                  })()
                )}

                {/* Bottom Speaking Indicator */}
                {focusedParticipant.isSpeaking && (
                  <div className="absolute bottom-0 left-0 w-full h-[3px] bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-500 animate-pulse shadow-[0_-1px_6px_rgba(16,185,129,0.6)]" />
                )}

                {/* Muted Mic Indicator Overlay */}
                {!focusedParticipant.isMicrophoneEnabled && (
                  <div className="absolute bottom-2 right-2 bg-rose-500/90 text-white p-1.5 rounded-md shadow-md backdrop-blur-sm border border-rose-600/30 flex items-center justify-center z-20 pointer-events-none" title="Microphone muted">
                    <MicOff size={12} className="w-3 h-3" />
                  </div>
                )}

                <div className="absolute bottom-2 left-2 bg-slate-900/80 px-2 py-0.5 rounded-md text-[10px] text-slate-100 border border-slate-800 font-medium">
                  {focusedParticipant.identity === localParticipant?.identity ? `${focusedParticipant.name || userName} (You)` : focusedParticipant.name || 'Reader'}
                </div>

                {/* Exit Focus Button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setFocusedParticipantIdentity(null);
                  }}
                  className="absolute top-2 right-2 rounded-full p-1 bg-slate-900/80 hover:bg-slate-800 text-slate-300 hover:text-slate-100 border border-slate-700 transition-colors pointer-events-auto shadow-md"
                  title="Exit focused view"
                >
                  <Minimize2 size={13} />
                </button>
              </div>

              {/* Thumbnails strip */}
              {thumbnailParticipants.length > 0 && (
                <div className="flex gap-2 overflow-x-auto pb-1 mt-2 max-h-[56px] shrink-0 scrollbar-thin scrollbar-thumb-slate-800 pr-1 select-none">
                  {thumbnailParticipants.map((p) => {
                    const cameraTrack = getCameraTrack(p);
                    const isSpeaking = p.isSpeaking;

                    return (
                      <div
                        key={p.identity}
                        onClick={() => setFocusedParticipantIdentity(p.identity)}
                        className="relative w-[76px] aspect-video shrink-0 bg-slate-950 rounded-lg overflow-hidden border border-slate-800 hover:border-indigo-500 transition-all cursor-pointer shadow group flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-900"
                      >
                        {cameraTrack ? (
                          <VideoTrack trackRef={cameraTrack} className="w-full h-full object-cover pointer-events-none" />
                        ) : (
                          (() => {
                            const meta = getParticipantMeta(p.identity);
                            const avatarUrl = meta?.avatarUrl;
                            const avatarColor = meta?.avatarColor || stringToColor(p.identity);
                            const initials = meta?.avatarInitials || makeInitials(p.name || (p.identity === localParticipant?.identity ? userName : ''));

                            return (
                              <div 
                                style={{ backgroundColor: avatarColor }}
                                className={`w-6 h-6 rounded-full flex items-center justify-center font-bold text-[8px] text-white shadow overflow-hidden relative transition-all duration-300 ${
                                  isSpeaking 
                                    ? 'ring-2 ring-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)] scale-105 animate-pulse' 
                                    : 'border border-slate-700'
                                }`}
                              >
                                {avatarUrl ? (
                                  <img 
                                    src={avatarUrl} 
                                    alt={p.name || ''} 
                                    className="w-full h-full object-cover pointer-events-none"
                                    onError={(e) => {
                                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                                    }}
                                  />
                                ) : (
                                  initials
                                )}
                              </div>
                            );
                          })()
                        )}
                        
                        {/* Bottom Speaking Indicator */}
                        {isSpeaking && (
                          <div className="absolute bottom-0 left-0 w-full h-[2px] bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-500 animate-pulse shadow-[0_-0.5px_4px_rgba(16,185,129,0.6)]" />
                        )}

                        {/* Muted Mic Indicator Overlay */}
                        {!p.isMicrophoneEnabled && (
                          <div className="absolute bottom-1 right-1 bg-rose-500/90 text-white p-0.5 rounded shadow-sm border border-rose-600/30 flex items-center justify-center z-20 pointer-events-none" title="Microphone muted">
                            <MicOff size={8} className="w-2 h-2" />
                          </div>
                        )}

                        <div className="absolute bottom-0.5 left-1 bg-slate-900/70 px-1 py-0.2 rounded text-[7px] text-slate-300 truncate max-w-[90%] pointer-events-none">
                          {p.identity === localParticipant?.identity ? 'You' : p.name || 'Reader'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : (
            /* Standard Grid View of unified members: Responsive and Dynamic */
            (() => {
              const isSingle = allParticipants.length === 1;
              const gridCols = isSingle ? 'grid-cols-1' : 'grid-cols-2';

              return (
                <div className={`grid ${gridCols} gap-2 overflow-y-auto pr-1 flex-1 min-h-[80px] select-none h-full`}>
                  {allParticipants.map((p) => {
                    const cameraTrack = getCameraTrack(p);
                    const isSpeaking = p.isSpeaking;
                    const isMuted = !p.isMicrophoneEnabled;

                    return (
                      <div
                        key={p.identity}
                        onClick={() => setFocusedParticipantIdentity(p.identity)}
                        className={
                          isSingle
                            ? "relative flex-1 w-full h-full min-h-[140px] rounded-xl overflow-hidden border border-slate-800 hover:border-indigo-500 transition-all cursor-pointer group shadow-lg flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-950"
                            : "relative aspect-video rounded-lg overflow-hidden border border-slate-800 hover:border-indigo-500 transition-all cursor-pointer group shadow-md shadow-black/20 flex items-center justify-center bg-gradient-to-br from-slate-800 to-slate-950"
                        }
                        title="Click to focus video"
                      >
                        {cameraTrack ? (
                          <VideoTrack trackRef={cameraTrack} className="w-full h-full object-cover pointer-events-none" />
                        ) : (
                          (() => {
                            const meta = getParticipantMeta(p.identity);
                            const avatarUrl = meta?.avatarUrl;
                            const avatarColor = meta?.avatarColor || stringToColor(p.identity);
                            const initials = meta?.avatarInitials || makeInitials(p.name || (p.identity === localParticipant?.identity ? userName : ''));

                            return (
                              <div 
                                style={{ backgroundColor: avatarColor }}
                                className={`rounded-full flex items-center justify-center font-bold text-white shadow-md overflow-hidden relative transition-all duration-300 ${
                                  isSingle ? 'w-16 h-16 text-lg' : 'w-10 h-10 text-xs'
                                } ${
                                  isSpeaking 
                                    ? isSingle
                                      ? 'ring-4 ring-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.8)] scale-105 animate-pulse'
                                      : 'ring-2 ring-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.7)] scale-105 animate-pulse' 
                                    : 'border border-slate-700'
                                }`}
                              >
                                {avatarUrl ? (
                                  <img 
                                    src={avatarUrl} 
                                    alt={p.name || ''} 
                                    className="w-full h-full object-cover pointer-events-none"
                                    onError={(e) => {
                                      (e.currentTarget as HTMLImageElement).style.display = 'none';
                                    }}
                                  />
                                ) : (
                                  initials
                                )}
                              </div>
                            );
                          })()
                        )}

                        {/* Bottom Speaking Indicator */}
                        {isSpeaking && (
                          <div className="absolute bottom-0 left-0 w-full h-[3px] bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-500 animate-pulse shadow-[0_-1px_6px_rgba(16,185,129,0.6)]" />
                        )}

                        {/* Muted Mic Indicator Overlay */}
                        {isMuted && (
                          <div className="absolute bottom-1.5 right-1.5 bg-rose-500/90 text-white p-1 rounded-md shadow-md backdrop-blur-sm border border-rose-600/30 flex items-center justify-center z-20 pointer-events-none" title="Microphone muted">
                            <MicOff size={10} className="w-2.5 h-2.5" />
                          </div>
                        )}

                        <div className="absolute bottom-1 left-1.5 bg-slate-900/80 px-1.5 py-0.5 rounded text-[9px] text-slate-200 truncate max-w-[85%] border border-slate-800/60 pointer-events-none">
                          {p.identity === localParticipant?.identity ? `${p.name || userName} (You)` : p.name || 'Reader'}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })()
          )}
        </div>
      )}

      {/* Control row with premium circle action buttons */}
      <div className="flex justify-around items-center border-t border-slate-800 pt-3 flex-shrink-0">
        {/* Microphone mute toggle */}
        <button
          onClick={() => setIsMicMuted(!isMicMuted)}
          className={`flex h-10 w-10 items-center justify-center rounded-full border shadow transition-all duration-300 active:scale-95 ${
            isMicMuted
              ? 'bg-rose-500/20 text-rose-400 border-rose-500/30 hover:bg-rose-500/30'
              : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700 hover:text-white'
          }`}
          title={isMicMuted ? 'Unmute microphone' : 'Mute microphone'}
        >
          {isMicMuted ? <MicOff size={16} /> : <Mic size={16} />}
        </button>

        {/* Video camera toggle */}
        <button
          onClick={() => setIsCamOn(!isCamOn)}
          className={`flex h-10 w-10 items-center justify-center rounded-full border shadow transition-all duration-300 active:scale-95 ${
            !isCamOn
              ? 'bg-rose-500/20 text-rose-400 border-rose-500/30 hover:bg-rose-500/30'
              : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700 hover:text-white'
          }`}
          title={isCamOn ? 'Disable camera' : 'Enable camera'}
        >
          {!isCamOn ? <VideoOff size={16} /> : <VideoIcon size={16} />}
        </button>

        {/* Disconnect/Leave call button */}
        <button
          onClick={handleDisconnect}
          className="flex h-10 w-10 items-center justify-center rounded-full bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/30 transition-all duration-300 active:scale-95"
          title="Leave voice call"
        >
          <PhoneOff size={16} />
        </button>
      </div>

      {/* Resize handle (desktop/mobile custom zone) */}
      {!isMinimized && handleResizeStart && handleResizeTouchStart && (
        <div 
          onMouseDown={handleResizeStart}
          onTouchStart={handleResizeTouchStart}
          className="absolute bottom-1 right-1 w-4 h-4 cursor-se-resize z-50 flex items-end justify-end p-0.5 group pointer-events-auto"
          title="Drag to resize call panel"
        >
          <svg width="8" height="8" viewBox="0 0 8 8" className="text-slate-500 group-hover:text-indigo-400 transition-colors">
            <line x1="6" y1="0" x2="0" y2="6" stroke="currentColor" strokeWidth="1.2" />
            <line x1="8" y1="3" x2="3" y2="8" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </div>
      )}

    </div>
  );
}
