// components/layout/ChannelSidebar.tsx
'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { BookOpen, Plus, ChevronDown, ChevronRight, Link2, Check, Trash2, MoreVertical, Settings, Pencil , X } from 'lucide-react';
import { useWorkspaceStore, type ChannelData } from '@/store/workspaceStore';
import { useUIStore } from '@/store/uiStore';
import { useIsMobile } from '@/lib/hooks/useIsMobile';

function ChannelRow({ channel, active, onClick }: { channel: ChannelData; active: boolean; onClick: () => void }) {
  const Icon = BookOpen;
  const { deleteChannel } = useWorkspaceStore();
  const { libraries } = useWorkspaceStore();
  const params = useParams();
  const router = useRouter();
  const libraryId = params?.libraryId as string;
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newName, setNewName] = useState(channel.name);
  const [copied, setCopied] = useState(false);

  const { updateChannel } = useWorkspaceStore();

  const handleRename = async () => {
    if (!newName.trim() || newName === channel.name) {
      setIsRenaming(false);
      return;
    }
    const success = await updateChannel(libraryId, channel.id, { name: newName.trim() });
    if (success) setIsRenaming(false);
  };

  const handleCopyLink = (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = `${window.location.origin}/libraries/${libraryId}/channels/${channel.id}`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    setShowMenu(false);
  };

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const success = await deleteChannel(libraryId, channel.id);
    if (success) {
      setShowDeleteConfirm(false);
      // Navigate to another channel or library page if this was the active channel
      router.push(`/libraries/${libraryId}`);
    }
  };

  return (
    <>
      <button
        onClick={onClick}
        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition-colors group relative
          ${active
            ? 'bg-room-hover text-room-text font-medium'
            : 'text-room-muted hover:bg-room-hover hover:text-room-text'
          }`}
      >
        <Icon size={16} className="flex-shrink-0 opacity-70" />
        {isRenaming ? (
          <input
            autoFocus
            className="flex-1 bg-room-bg border border-blue-500/50 rounded px-1.5 py-0.5 text-xs text-room-text outline-none"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onBlur={handleRename}
            onKeyDown={(e) => e.key === 'Enter' && handleRename()}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="truncate flex-1 text-left">{channel.name}</span>
        )}
        
        <div className="relative">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowMenu(!showMenu);
            }}
            className={`flex-shrink-0 p-1 transition-all rounded hover:bg-room-bg ${showMenu ? 'text-room-text bg-room-bg' : 'text-room-muted'}`}
            title="Channel settings"
          >
            <MoreVertical size={16} />
          </button>

          {showMenu && (
            <div className="absolute right-0 top-full mt-1 w-40 bg-room-surface border border-room-border rounded-xl shadow-2xl z-[60] p-1 animate-in fade-in zoom-in-95" onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => { setIsRenaming(true); setShowMenu(false); }}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-room-muted hover:text-room-text hover:bg-room-hover rounded-lg transition-colors"
              >
                <Settings size={16} />
                <span>Rename</span>
              </button>
              <button
                onClick={handleCopyLink}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-room-muted hover:text-room-text hover:bg-room-hover rounded-lg transition-colors"
              >
                {copied ? <Check size={16} className="text-green-400" /> : <Link2 size={16} />}
                <span>{copied ? 'Copied!' : 'Copy Link'}</span>
              </button>
              <div className="h-px bg-room-border my-1" />
              <button
                onClick={() => { setShowDeleteConfirm(true); setShowMenu(false); }}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
              >
                <Trash2 size={16} />
                <span>Delete Channel</span>
              </button>
            </div>
          )}
        </div>
      </button>

      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setShowDeleteConfirm(false)}>
          <div className="bg-room-surface border border-room-border rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-red-400 mb-2">Delete Channel</h2>
            <p className="text-sm text-room-muted mb-5">
              Are you sure you want to delete <strong className="text-room-text">{channel.name}</strong>? This action cannot be undone.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setShowDeleteConfirm(false)} className="flex-1 py-2.5 rounded-xl border border-room-border text-room-muted text-sm hover:text-room-text transition-colors">
                Cancel
              </button>
              <button onClick={handleDelete} className="flex-1 py-2.5 rounded-xl bg-red-500 hover:bg-red-600 text-white text-sm font-medium transition-colors">
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function ChannelSidebar({ inBottomSheet = false, onClose }: { inBottomSheet?: boolean; onClose?: () => void }) {
  const router = useRouter();
  const params = useParams();
  const libraryId = params?.libraryId as string;
  const activeChannelId = params?.channelId as string | undefined;

  const { libraries, channels, fetchChannels, createChannel, updateLibrary } = useWorkspaceStore();
  const library = libraries.find((s) => s.id === libraryId);

  const [showAddChannel, setShowAddChannel] = useState(false);
  const [newChannelName, setNewName] = useState('');
  const [isRenamingLibrary, setIsRenamingLibrary] = useState(false);
  const [libraryName, setLibraryName] = useState('');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  const { channelSidebarCollapsed } = useUIStore();
  const isMobile = useIsMobile();

  useEffect(() => {
    if (libraryId) fetchChannels(libraryId);
  }, [libraryId, fetchChannels]);

  useEffect(() => {
    setLibraryName(library?.name ?? '');
  }, [library?.name]);

  const handleChannelClick = (channel: ChannelData) => {
    if (channel.id === activeChannelId && onClose) {
      onClose();
    } else {
      router.push(`/libraries/${libraryId}/channels/${channel.id}`);
    }
  };

  const handleCreateRoom = async () => {
    if (!newChannelName.trim() || !libraryId) return;
    setLoading(true);
    const ch = await createChannel(libraryId, newChannelName, 'pdf');
    setLoading(false);
    if (ch) {
      setShowAddChannel(false);
      setNewName('');
      router.push(`/libraries/${libraryId}/channels/${ch.id}`);
    }
  };

  const handleCopyInvite = () => {
    if (!library?.invite_code) return;
    navigator.clipboard.writeText(library.invite_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRenameLibrary = async () => {
    const trimmed = libraryName.trim();
    if (!library || !trimmed || trimmed === library.name) {
      setIsRenamingLibrary(false);
      return;
    }
    const success = await updateLibrary(library.id, { name: trimmed });
    if (success) setIsRenamingLibrary(false);
  };

  const pdfChannels = channels.filter((c) => c.type === 'pdf');
  if (isMobile && !inBottomSheet) return null;

  return (
    <div className={`flex flex-col bg-transparent flex-shrink-0 transition-all duration-300 relative 
      ${inBottomSheet ? 'w-full border-none' : (channelSidebarCollapsed ? 'w-0 overflow-hidden opacity-0 border-none' : 'w-52 border-r border-room-border')} h-full`}>
      {/* Floating collapse toggle for channel sidebar */}

      {!inBottomSheet && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-room-border flex-shrink-0">
          {isRenamingLibrary ? (
            <input
              autoFocus
              className="min-w-0 flex-1 bg-room-bg border border-blue-500/50 rounded-lg px-2 py-1 text-sm text-room-text outline-none"
              value={libraryName}
              onChange={(e) => setLibraryName(e.target.value)}
              onBlur={handleRenameLibrary}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRenameLibrary();
                if (e.key === 'Escape') setIsRenamingLibrary(false);
              }}
              maxLength={64}
            />
          ) : (
            <h2 className="font-bold text-room-text text-sm truncate flex-1">
              {library?.name ?? 'Loading…'}
            </h2>
          )}
          {library && (
            <button
              onClick={() => setIsRenamingLibrary(true)}
              className="ml-2 p-1.5 rounded-lg text-room-muted hover:text-room-text hover:bg-room-hover"
              title="Rename library"
            >
              <Pencil size={16} />
            </button>
          )}
          {onClose && (
            <button
              onClick={onClose}
              className="ml-1 p-1.5 rounded-lg text-room-muted hover:text-room-text hover:bg-room-hover"
              title="Close"
            >
              <X size={18} />
            </button>
          )}
        </div>
      )}

      {/* Channel list */}
      <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4">
        {/* PDF Channels */}
        {pdfChannels.length > 0 && (
          <div>
            <div className="flex items-center justify-between px-2 mb-1">
              <span className="text-[11px] font-semibold text-room-muted tracking-wider">ROOMS</span>
              <button
                onClick={() => { setShowAddChannel(true); }}
                className="text-room-muted hover:text-room-text transition-colors"
                title="Add room"
              >
                <Plus size={16} />
              </button>
            </div>
            {pdfChannels.map((ch) => (
              <ChannelRow
                key={ch.id}
                channel={ch}
                active={ch.id === activeChannelId}
                onClick={() => handleChannelClick(ch)}
              />
            ))}
          </div>
        )}


        {channels.length === 0 && (
          <div className="px-2 text-center py-8">
            <p className="text-xs text-room-muted mb-3">No channels yet</p>
            <button
              onClick={() => setShowAddChannel(true)}
              className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
            >
              + Create your first channel
            </button>
          </div>
        )}
      </div>

      {/* Invite code — collapsible */}
      {library?.invite_code && (
        <div className="border-t border-room-border flex-shrink-0">
          <button
            onClick={() => setInviteOpen((o) => !o)}
            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-room-hover transition-colors"
          >
            <span className="text-[10px] text-room-muted tracking-wider">LIBRARY INVITE</span>
            {inviteOpen
              ? <ChevronDown size={13} className="text-room-muted" />
              : <ChevronRight size={13} className="text-room-muted" />
            }
          </button>
          {inviteOpen && (
            <div className="px-3 pb-3">
              <button
                onClick={handleCopyInvite}
                className="w-full flex items-center gap-2 px-3 py-2 bg-room-bg border border-room-border rounded-lg hover:border-blue-500/40 transition-colors group"
              >
                <span className="flex-1 text-sm font-mono text-room-text tracking-widest text-left">{library.invite_code}</span>
                {copied
                  ? <Check size={16} className="text-green-400 flex-shrink-0" />
                  : <Link2 size={16} className="text-room-muted group-hover:text-room-text flex-shrink-0 transition-colors" />
                }
              </button>
            </div>
          )}
        </div>
      )}

      {/* Add channel modal */}
      {showAddChannel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" onClick={() => setShowAddChannel(false)}>
          <div className="bg-room-surface border border-room-border rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-room-text mb-1">Add a Room</h2>
            <p className="text-sm text-room-muted mb-5">Rooms are for books, topics, or anything else.</p>

            <input
              autoFocus
              className="w-full bg-room-bg border border-room-border rounded-xl px-4 py-2.5 text-sm text-room-text placeholder:text-room-muted outline-none focus:border-blue-500/50 mb-4"
              placeholder="e.g. novels, study-notes…"
              value={newChannelName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreateRoom()}
              maxLength={64}
            />
            <div className="flex gap-2">
              <button onClick={() => setShowAddChannel(false)} className="flex-1 py-2.5 rounded-xl border border-room-border text-room-muted text-sm hover:text-room-text transition-colors">
                Cancel
              </button>
              <button onClick={handleCreateRoom} disabled={loading || !newChannelName.trim()} className="flex-1 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-400 text-white text-sm font-medium disabled:opacity-50 transition-colors">
                {loading ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
