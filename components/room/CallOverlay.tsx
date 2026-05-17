'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
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
  Phone, 
  GripHorizontal, 
  Minimize2, 
  Maximize2, 
  AlertCircle, 
  X,
  Users,
  Volume2
} from 'lucide-react';
import { stringToColor, makeInitials } from '@/lib/utils/avatar';

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

  // Dragging state
  const [position, setPosition] = useState({ x: 20, y: 80 }); // Default bottom-left / top-right spacing
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);

  // Position initialized on mount/resize
  useEffect(() => {
    if (typeof window !== 'undefined') {
      // Place default floating position: bottom-right above standard mobile bottom sheets
      const defaultX = window.innerWidth - 300;
      const defaultY = window.innerHeight - (window.innerWidth < 768 ? 200 : 150);
      setPosition({ x: Math.max(16, defaultX), y: Math.max(80, defaultY) });
    }
  }, []);

  // Keep widget within screen boundaries on window resize or rotation
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleResize = () => {
      setPosition((prev) => {
        const widgetWidth = isMinimized ? 180 : 280;
        const widgetHeight = isMinimized ? 52 : 360;
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
  }, [isMinimized]);

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
      const widgetWidth = isMinimized ? 180 : 280;
      const widgetHeight = isMinimized ? 52 : 360;
      const maxX = window.innerWidth - widgetWidth - 16;
      const maxY = window.innerHeight - widgetHeight - 16;

      newX = Math.max(16, Math.min(maxX, newX));
      newY = Math.max(80, Math.min(maxY, newY));
    }

    setPosition({ x: newX, y: newY });
  }, [isMinimized]);

  const handleDragEnd = useCallback(() => {
    isDraggingRef.current = false;
    setIsDragging(false);
  }, []);

  // Window event listeners for seamless drag support
  useEffect(() => {
    if (!isDragging) return;

    const onMouseMove = (e: MouseEvent) => {
      handleDragMove(e.clientX, e.clientY);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches[0]) {
        handleDragMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    };

    const onMouseUp = () => handleDragEnd();
    const onTouchEnd = () => handleDragEnd();

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
  }, [isDragging, handleDragMove, handleDragEnd]);

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
          Get a free Cloud sandbox keys from <a href="https://livekit.io" target="_blank" rel="noreferrer" className="text-indigo-400 underline">livekit.io</a>.
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
          />
        </div>
        <RoomAudioRenderer />
      </LiveKitRoom>
    );
  }

  // Otherwise, render floating "Join Voice Call" pill (Trigger state)
  return (
    <button
      onClick={handleJoinCall}
      disabled={isConnecting}
      style={{ left: position.x, top: position.y }}
      className="absolute z-[999] pointer-events-auto flex h-12 items-center gap-3 rounded-full bg-indigo-600/90 hover:bg-indigo-500 text-white font-medium pl-3 pr-4 shadow-[0_4px_24px_rgba(79,70,229,0.4)] backdrop-blur transition-all duration-300 hover:scale-105 active:scale-95 border border-indigo-400/30"
    >
      {isConnecting ? (
        <>
          <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          <span className="text-xs uppercase tracking-wider font-semibold">Joining Call…</span>
        </>
      ) : (
        <>
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-white/20 text-white animate-pulse">
            <Phone size={14} fill="white" />
          </div>
          <span className="text-xs uppercase tracking-wider font-semibold">Join Call</span>
        </>
      )}
      {error && (
        <span className="absolute -top-10 left-1/2 -translate-x-1/2 bg-red-600 text-white text-[10px] px-2.5 py-1 rounded shadow-lg whitespace-nowrap">
          {error}
        </span>
      )}
    </button>
  );
}

// Inner Widget rendering the media state and layout within the LiveKit context
interface InnerCallWidgetProps {
  isMinimized: boolean;
  setIsMinimized: (val: boolean) => void;
  handleDragStart: (clientX: number, clientY: number) => void;
  handleDisconnect: () => void;
  userId: string;
  userName: string;
}

function InnerCallWidget({
  isMinimized,
  setIsMinimized,
  handleDragStart,
  handleDisconnect,
  userId,
  userName
}: InnerCallWidgetProps) {
  const { localParticipant } = useLocalParticipant();
  const participants = useParticipants();
  const videoTracks = useTracks([Track.Source.Camera]);

  const [isMicMuted, setIsMicMuted] = useState(false);
  const [isCamOn, setIsCamOn] = useState(false);

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

  const activeSpeakers = participants.filter((p) => p.isSpeaking);

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
              <div 
                style={{ backgroundColor: stringToColor(activeSpeakers[0].identity) }}
                className="w-6 h-6 rounded-full flex items-center justify-center font-bold text-[9px] text-white ring-2 ring-emerald-500 animate-pulse"
              >
                {makeInitials(activeSpeakers[0].name || '')}
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
              <span className="text-[10px] text-slate-300 font-medium font-mono uppercase truncate max-w-[70px]">Connected</span>
            </div>
          )}
          <span className="text-[10px] text-slate-400 font-semibold font-mono">
            ({participants.length})
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
    <div className="w-[280px] rounded-2xl border border-slate-700/60 bg-slate-900/90 p-4 shadow-2xl backdrop-blur-xl text-slate-100 flex flex-col gap-3.5">
      
      {/* Draggable grip and header */}
      <div 
        onMouseDown={(e) => handleDragStart(e.clientX, e.clientY)}
        onTouchStart={(e) => e.touches[0] && handleDragStart(e.touches[0].clientX, e.touches[0].clientY)}
        className="cursor-grab active:cursor-grabbing flex flex-col gap-1 border-b border-slate-800 pb-2 relative"
      >
        <GripHorizontal size={16} className="text-slate-500 hover:text-slate-300 mx-auto transition-colors" />
        <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-slate-400 select-none">
          <div className="flex items-center gap-1.5">
            <Volume2 size={14} className="text-emerald-400" />
            <span>Voice Call</span>
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

      {/* Media elements: Active Video Grid */}
      {videoTracks.length > 0 && (
        <div className="grid grid-cols-2 gap-2 max-h-[160px] overflow-y-auto pr-1">
          {videoTracks.map((track) => (
            <div key={track.participant.sid} className="relative aspect-video bg-slate-950 rounded-lg overflow-hidden border border-slate-800 group shadow-md shadow-black/20">
              <VideoTrack trackRef={track} className="w-full h-full object-cover" />
              <div className="absolute bottom-1 left-1.5 bg-slate-900/70 px-1.5 py-0.5 rounded text-[9px] text-slate-200 truncate max-w-[85%] border border-slate-800">
                {track.participant.name || 'Reader'}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Participants presence strip */}
      <div className="flex flex-col gap-2 max-h-[150px] overflow-y-auto pr-1">
        <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">
          <Users size={12} />
          <span>Call Members ({participants.length})</span>
        </div>

        {/* Local Participant row */}
        <div className="flex items-center justify-between py-1 px-2 rounded-lg bg-slate-950/20 border border-slate-800/40">
          <div className="flex items-center gap-2.5 min-w-0">
            <div 
              style={{ backgroundColor: stringToColor(userId) }}
              className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs text-white border transition-all ${
                localParticipant?.isSpeaking 
                  ? 'ring-2 ring-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)] scale-105' 
                  : 'border-slate-700'
              }`}
            >
              {makeInitials(userName)}
            </div>
            <span className="text-xs font-semibold truncate text-slate-200">
              {userName} <span className="text-[10px] text-slate-400 font-normal">(You)</span>
            </span>
          </div>
          <div className="flex gap-1.5">
            {isMicMuted && <MicOff size={11} className="text-rose-400" />}
            {isCamOn && <div className="w-1.5 h-1.5 rounded-full bg-indigo-400" />}
          </div>
        </div>

        {/* Other participants */}
        {participants.filter(p => p.identity !== localParticipant?.identity).map((p) => {
          const isMuted = !p.isMicrophoneEnabled;
          const isCam = p.isCameraEnabled;
          
          return (
            <div key={p.sid} className="flex items-center justify-between py-1 px-2 rounded-lg bg-slate-950/20 border border-slate-800/40">
              <div className="flex items-center gap-2.5 min-w-0">
                <div 
                  style={{ backgroundColor: stringToColor(p.identity) }}
                  className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs text-white border transition-all ${
                    p.isSpeaking 
                      ? 'ring-2 ring-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.5)] scale-105' 
                      : 'border-slate-700'
                  }`}
                >
                  {makeInitials(p.name || '')}
                </div>
                <span className="text-xs font-semibold truncate text-slate-200">
                  {p.name || 'Reader'}
                </span>
              </div>
              <div className="flex gap-1.5 items-center">
                {isMuted && <MicOff size={11} className="text-rose-400" />}
                {isCam && <div className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-pulse" />}
              </div>
            </div>
          );
        })}
      </div>

      {/* Control row with premium circle action buttons */}
      <div className="flex justify-around items-center border-t border-slate-800 pt-3">
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

    </div>
  );
}
