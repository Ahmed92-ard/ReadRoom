// components/layout/LibrarySidebar.tsx
'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { Plus, LogOut, Settings, Trash2, Pencil } from 'lucide-react';
import { useWorkspaceStore, type LibraryData } from '@/store/workspaceStore';
import { useAuth } from '@/lib/hooks/useAuth';
import { useUIStore } from '@/store/uiStore';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { useIsMobile } from '@/lib/hooks/useIsMobile';

function LibraryIcon({ library, active, onClick }: { library: LibraryData; active: boolean; onClick: () => void }) {
  const initials = library.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
  const [showContextMenu, setShowContextMenu] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameDraft, setRenameDraft] = useState(library.name);
  const { deleteLibrary, updateLibrary } = useWorkspaceStore();
  const router = useRouter();
  const { user } = useAuth();

  const isOwner = library.owner_id === user?.id;

  const handleDelete = async () => {
    const success = await deleteLibrary(library.id);
    if (success) {
      setShowDeleteConfirm(false);
      setShowContextMenu(false);
      router.push('/libraries');
    }
  };

  const handleRename = async () => {
    const name = renameDraft.trim();
    if (!name || name === library.name) {
      setShowRenameModal(false);
      return;
    }
    const success = await updateLibrary(library.id, { name });
    if (success) setShowRenameModal(false);
  };

  return (
    <div className="relative group flex flex-col items-center" onClick={onClick}>
      {/* Active indicator pill */}
      <div className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 rounded-r-full bg-white transition-all duration-200 ${active ? 'h-8 opacity-100' : 'h-2 opacity-0 group-hover:opacity-100 group-hover:h-5'}`} />
      <button
        title={library.name}
        onContextMenu={(e) => {
          e.preventDefault();
          setShowContextMenu(!showContextMenu);
        }}
        className={`w-10 h-10 rounded-2xl transition-all duration-200 flex items-center justify-center text-xs font-bold shadow-md cursor-pointer
          ${active
            ? 'rounded-2xl bg-blue-500 text-white'
            : 'bg-room-surface text-room-muted hover:rounded-2xl hover:bg-blue-500 hover:text-white'
          }`}
        style={!active ? { backgroundColor: stringToColor(library.id) } : undefined}
      >
        {library.icon_url
          ? <img src={library.icon_url} alt={library.name} className="w-full h-full rounded-[inherit] object-cover" />
          : <span className="text-white">{initials}</span>
        }
      </button>
      
      {/* Context menu */}
      {showContextMenu && isOwner && (
        <div className="absolute left-full ml-4 w-36 bg-room-surface border border-room-border rounded-xl shadow-2xl z-[100] p-1 animate-in fade-in slide-in-from-left-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              setRenameDraft(library.name);
              setShowRenameModal(true);
              setShowContextMenu(false);
            }}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-room-muted hover:text-room-text hover:bg-room-hover rounded-lg transition-colors"
          >
            <Pencil size={14} />
            <span>Rename</span>
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setShowDeleteConfirm(true);
              setShowContextMenu(false);
            }}
            className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-red-400 hover:bg-red-500/10 rounded-lg transition-colors"
          >
            <Trash2 size={14} />
            <span>Delete Library</span>
          </button>
        </div>
      )}

      {/* Rename modal */}
      {showRenameModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={(e) => { e.stopPropagation(); setShowRenameModal(false); }}>
          <div className="bg-room-surface border border-room-border rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-room-text mb-1">Rename Library</h2>
            <p className="text-sm text-room-muted mb-4">Enter a new name for this library.</p>
            <input
              autoFocus
              className="w-full bg-room-bg border border-room-border rounded-xl px-4 py-2.5 text-sm text-room-text placeholder:text-room-muted outline-none focus:border-blue-500/50 mb-4"
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleRename(); if (e.key === 'Escape') setShowRenameModal(false); }}
              maxLength={64}
            />
            <div className="flex gap-2">
              <button onClick={() => setShowRenameModal(false)} className="flex-1 py-2.5 rounded-xl border border-room-border text-room-muted text-sm hover:text-room-text transition-colors">Cancel</button>
              <button onClick={handleRename} disabled={!renameDraft.trim()} className="flex-1 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-400 text-white text-sm font-medium disabled:opacity-50 transition-colors">Rename</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={(e) => {
          e.stopPropagation();
          setShowDeleteConfirm(false);
        }}>
          <div className="bg-room-surface border border-room-border rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-red-400 mb-2">Delete Library</h2>
            <p className="text-sm text-room-muted mb-5">
              Are you sure you want to delete <strong className="text-room-text">{library.name}</strong>? All channels and data will be permanently deleted.
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

      {/* Tooltip */}
      <div className="absolute left-full ml-4 px-3 py-1.5 rounded-lg bg-gray-900 text-white text-xs font-medium whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 shadow-xl border border-white/10">
        {library.name}
        <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1 w-2 h-2 bg-gray-900 rotate-45 border-l border-b border-white/10" />
      </div>
    </div>
  );
}

export function LibrarySidebar({ inBottomSheet = false, onClose }: { inBottomSheet?: boolean; onClose?: () => void }) {
  const router = useRouter();
  const params = useParams();
  const activeLibraryId = params?.libraryId as string | undefined;
  const { libraries, fetchLibraries, createLibrary, joinLibrary, setActiveLibrary, updateLibrary } = useWorkspaceStore();
  const { user, signOut } = useAuth();
  const { librarySidebarCollapsed } = useUIStore();
  const isMobile = useIsMobile();
  
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [newLibraryName, setNewLibraryName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [editingLibraryId, setEditingLibraryId] = useState<string | null>(null);
  const [editingLibraryName, setEditingLibraryName] = useState('');

  useEffect(() => { fetchLibraries(); }, [fetchLibraries]);

  const handleSelectLibrary = (library: LibraryData) => {
    if (library.id === activeLibraryId && onClose) {
      onClose();
    } else {
      setActiveLibrary(library.id);
      router.push(`/libraries/${library.id}`);
    }
  };

  const handleCreate = async () => {
    if (!newLibraryName.trim()) return;
    setLoading(true);
    const library = await createLibrary(newLibraryName);
    setLoading(true);
    if (library) {
      setShowCreate(false);
      setNewLibraryName('');
      handleSelectLibrary(library);
    }
  };

  const handleJoin = async () => {
    if (!inviteCode.trim()) return;
    setLoading(true);
    const library = await joinLibrary(inviteCode);
    setLoading(false);
    if (library) {
      setShowJoin(false);
      setInviteCode('');
      handleSelectLibrary(library);
    }
  };

  const handleRenameLibraryMobile = async () => {
    if (!editingLibraryId) return;
    const trimmed = editingLibraryName.trim();
    if (!trimmed) {
      setEditingLibraryId(null);
      return;
    }
    const success = await updateLibrary(editingLibraryId, { name: trimmed });
    if (success) setEditingLibraryId(null);
  };

  if (isMobile && !inBottomSheet) return null;

  if (inBottomSheet) {
    return (
      <div className="flex flex-col bg-room-bg">
        <div className="flex items-center justify-between px-4 py-3 border-b border-room-border">
          <span className="text-[11px] font-bold text-room-muted tracking-widest">LIBRARIES</span>
          <button onClick={() => setShowCreate(true)} className="text-blue-400 hover:text-blue-300 text-xs font-medium px-2 py-1 rounded-lg hover:bg-blue-400/10 transition-all">+ New</button>
        </div>
        <div className="p-2 flex flex-col gap-1.5">
          {libraries.map((library) => {
            const active = library.id === activeLibraryId;
            const initials = library.name.split(' ').map((w) => w[0]).slice(0, 2).join('').toUpperCase();
            return (
              <div
                key={library.id}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all w-full ${
                  active 
                    ? 'bg-blue-500 border-blue-400 text-white shadow-[0_0_15px_rgba(59,130,246,0.3)]' 
                    : 'bg-room-surface border-transparent text-room-muted hover:bg-room-hover hover:text-room-text'
                }`}
              >
                <button
                  onClick={() => handleSelectLibrary(library)}
                  className="min-w-0 flex flex-1 items-center gap-3 text-left"
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0 ${active ? 'bg-white/20' : 'bg-blue-500/10 text-blue-400'}`}>
                     {library.icon_url ? <img src={library.icon_url} alt="" className="w-full h-full rounded-[inherit] object-cover" /> : initials}
                  </div>
                  {editingLibraryId === library.id ? (
                    <input
                      autoFocus
                      className="min-w-0 flex-1 bg-room-bg border border-blue-500/50 rounded-lg px-2 py-1 text-sm text-room-text outline-none"
                      value={editingLibraryName}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setEditingLibraryName(e.target.value)}
                      onBlur={handleRenameLibraryMobile}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleRenameLibraryMobile();
                        if (e.key === 'Escape') setEditingLibraryId(null);
                      }}
                      maxLength={64}
                    />
                  ) : (
                    <span className="text-sm font-semibold truncate flex-1">{library.name}</span>
                  )}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setEditingLibraryId(library.id);
                    setEditingLibraryName(library.name);
                  }}
                  className="p-1.5 rounded-lg text-room-muted hover:text-room-text hover:bg-room-hover"
                  title="Rename library"
                >
                  <Pencil size={14} />
                </button>
              </div>
            );
          })}
        </div>
        
        {/* User Profile Section for Mobile */}
        <div className="mt-auto border-t border-room-border bg-room-surface/30 p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-bold overflow-hidden border border-white/10 shadow-sm">
                {user?.user_metadata?.avatar_url
                  ? <img src={user.user_metadata.avatar_url} alt="avatar" className="w-full h-full object-cover" />
                  : user?.email?.[0].toUpperCase()
                }
              </div>
              <div className="min-w-0">
                <p className="text-sm font-bold text-room-text truncate">{user?.user_metadata?.full_name || 'Reader'}</p>
                <p className="text-[10px] text-room-muted truncate">{user?.email}</p>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              <button 
                onClick={() => { onClose?.(); router.push('/settings'); }}
                className="p-2.5 rounded-xl bg-room-bg text-room-muted hover:text-room-text transition-colors border border-room-border active:scale-95"
                title="Settings"
              >
                <Settings size={18} />
              </button>
              <button 
                onClick={() => signOut()}
                className="p-2.5 rounded-xl bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white transition-all border border-red-500/20 active:scale-95"
                title="Sign Out"
              >
                <LogOut size={18} />
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className={`flex flex-col items-center bg-room-bg py-3 gap-2 flex-shrink-0 border-r border-room-border h-full transition-all duration-300 ${librarySidebarCollapsed ? 'w-0 overflow-hidden opacity-0 border-none' : 'w-16'}`}>
        {/* Library list */}
        <div className="flex flex-col items-center gap-2 flex-1 w-full px-2">
          {libraries.map((library) => (
            <LibraryIcon
              key={library.id}
              library={library}
              active={library.id === activeLibraryId}
              onClick={() => handleSelectLibrary(library)}
            />
          ))}

          {/* Add library */}
          <button
            onClick={() => setShowCreate(true)}
            title="Create or join a library"
            className="w-10 h-10 rounded-2xl bg-room-surface text-green-400 hover:rounded-xl hover:bg-green-500 hover:text-white transition-all duration-200 flex items-center justify-center flex-shrink-0"
          >
            <Plus size={20} />
          </button>
        </div>

        <div className="w-8 h-px bg-room-border flex-shrink-0" />

        {/* Theme toggle */}
        <ThemeToggle />

        {/* User avatar - NO LONGER LOGS OUT ON CLICK */}
        <div className="relative group flex-shrink-0">
          <button
            onClick={() => setShowUserMenu(!showUserMenu)}
            title={`Library settings (${user?.email})`}
            className="w-10 h-10 rounded-full flex items-center justify-center bg-room-surface hover:ring-2 hover:ring-blue-500/50 transition-all overflow-hidden"
          >
            {user?.user_metadata?.avatar_url
              ? <img src={user.user_metadata.avatar_url} alt="avatar" className="w-full h-full object-cover" />
              : <div className="w-full h-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold">
                  {user?.email?.[0].toUpperCase()}
                </div>
            }
          </button>
          
          {showUserMenu && (
            <div className="absolute bottom-0 left-full ml-4 w-48 bg-room-surface border border-room-border rounded-xl shadow-2xl z-[100] p-2 animate-in fade-in slide-in-from-left-2">
              <div className="px-2 py-1.5 border-b border-room-border mb-1">
                <p className="text-xs font-bold text-room-text truncate">{user?.user_metadata?.full_name || 'Reader'}</p>
                <p className="text-[10px] text-room-muted truncate">{user?.email}</p>
              </div>
              <button 
                onClick={() => { setShowUserMenu(false); router.push('/settings'); }}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-room-muted hover:text-room-text hover:bg-room-hover rounded-lg transition-colors"
              >
                <Settings size={14} />
                <span>Settings</span>
              </button>
              <button 
                onClick={() => { setShowUserMenu(false); signOut(); }}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-xs text-red-400 hover:bg-red-500/10 rounded-lg transition-colors mt-1"
              >
                <LogOut size={14} />
                <span>Sign Out</span>
              </button>
            </div>
          )}
        </div>
      </div>



      {/* Create/Join Modal */}
      {(showCreate || showJoin) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => { setShowCreate(false); setShowJoin(false); }}>
          <div className="bg-room-surface border border-room-border rounded-2xl p-6 w-full max-w-sm shadow-2xl" onClick={(e) => e.stopPropagation()}>
            {showCreate ? (
              <>
                <h2 className="text-lg font-bold text-room-text mb-1">Create a Library</h2>
                <p className="text-sm text-room-muted mb-5">Give your library a name.</p>
                <input
                  autoFocus
                  className="w-full bg-room-bg border border-room-border rounded-xl px-4 py-2.5 text-sm text-room-text placeholder:text-room-muted outline-none focus:border-blue-500/50 mb-4"
                  placeholder="e.g. Book Club, Study Group…"
                  value={newLibraryName}
                  onChange={(e) => setNewLibraryName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                  maxLength={64}
                />
                <div className="flex gap-2">
                  <button onClick={() => { setShowCreate(false); setShowJoin(true); }} className="flex-1 py-2.5 rounded-xl border border-room-border text-room-muted text-sm hover:text-room-text transition-colors">
                    Join instead
                  </button>
                  <button onClick={handleCreate} disabled={loading || !newLibraryName.trim()} className="flex-1 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-400 text-white text-sm font-medium disabled:opacity-50 transition-colors">
                    {loading ? 'Creating…' : 'Create'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2 className="text-lg font-bold text-room-text mb-1">Join a Library</h2>
                <p className="text-sm text-room-muted mb-5">Enter an invite code from a friend.</p>
                <input
                  autoFocus
                  className="w-full bg-room-bg border border-room-border rounded-xl px-4 py-2.5 text-sm text-room-text placeholder:text-room-muted outline-none focus:border-blue-500/50 mb-4 tracking-widest"
                  placeholder="INVITE CODE"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
                  maxLength={12}
                />
                <div className="flex gap-2">
                  <button onClick={() => { setShowJoin(false); setShowCreate(true); }} className="flex-1 py-2.5 rounded-xl border border-room-border text-room-muted text-sm hover:text-room-text transition-colors">
                    Create instead
                  </button>
                  <button onClick={handleJoin} disabled={loading || !inviteCode.trim()} className="flex-1 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-400 text-white text-sm font-medium disabled:opacity-50 transition-colors">
                    {loading ? 'Joining…' : 'Join'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function stringToColor(str: string): string {
  const colors = ['#6366f1','#8b5cf6','#ec4899','#f43f5e','#f97316','#22c55e','#14b8a6','#3b82f6'];
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  return colors[Math.abs(hash) % colors.length];
}
