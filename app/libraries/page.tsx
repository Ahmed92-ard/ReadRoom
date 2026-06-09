// app/libraries/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { useAuth } from '@/lib/hooks/useAuth';
import { BookOpen, Plus, Link, Loader2, AlertCircle } from 'lucide-react';
import { LibrarySidebar } from '@/components/layout/LibrarySidebar';
import { AppNavigation } from '@/components/layout/AppNavigation';
import { LibraryChatLauncher } from '@/components/chat/GlobalChatOverlay';

export default function LibrariesPage() {
  const router = useRouter();
  const { libraries, loadingLibraries, fetchLibraries, createLibrary, joinLibrary } = useWorkspaceStore();
  const { user } = useAuth();

  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [newName, setNewName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [creating, setCreating] = useState(false);
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { fetchLibraries(); }, [fetchLibraries]);

  // Auto-navigate to first library once loaded
  useEffect(() => {
    if (!loadingLibraries && libraries.length > 0) {
      router.replace(`/libraries/${libraries[0].id}`);
    }
  }, [loadingLibraries, libraries, router]);

  const handleCreate = async () => {
    const trimmed = newName.trim();
    if (!trimmed) return;
    setCreating(true);
    setError(null);
    try {
      const library = await createLibrary(trimmed);
      if (library) {
        setShowCreate(false);
        setNewName('');
        router.push(`/libraries/${library.id}`);
      } else {
        setError(useWorkspaceStore.getState().error || 'Failed to create library. Please try again.');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setCreating(false);
    }
  };

  const handleJoin = async () => {
    const code = inviteCode.trim().toUpperCase();
    if (!code) return;
    setJoining(true);
    setError(null);
    try {
      const library = await joinLibrary(code);
      if (library) {
        setShowJoin(false);
        setInviteCode('');
        router.push(`/libraries/${library.id}`);
      } else {
        setError(useWorkspaceStore.getState().error || 'Invalid invite code. Please check and try again.');
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setJoining(false);
    }
  };

  return (
    <div className="flex h-screen bg-room-bg overflow-hidden">
      <AppNavigation />
      <LibrarySidebar />

      <div className="flex-1 flex items-center justify-center p-6 pb-20 md:pb-6">
        {loadingLibraries ? (
          <Loader2 size={32} className="animate-spin text-room-muted" />
        ) : libraries.length === 0 ? (
          <div className="text-center max-w-sm w-full">
            <div className="w-16 h-16 rounded-2xl bg-blue-500/20 flex items-center justify-center mx-auto mb-5">
              <BookOpen size={28} className="text-blue-400" />
            </div>
            <h2 className="text-xl font-bold text-room-text mb-2">
              Welcome{user?.user_metadata?.full_name ? `, ${user.user_metadata.full_name.split(' ')[0]}` : ''}!
            </h2>
            <p className="text-room-muted text-sm mb-6">
              You're not in any reading libraries yet. Create one to get started, or join with an invite code.
            </p>

            {error && (
              <div className="flex items-start gap-2 mb-4 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300 text-left">
                <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <div className="flex flex-col gap-3">
              <button
                onClick={() => { setError(null); setShowCreate(true); }}
                className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-blue-500 hover:bg-blue-400 text-white text-sm font-medium transition-colors min-h-[48px]"
              >
                <Plus size={16} />
                Create your first library
              </button>
              <button
                onClick={() => { setError(null); setShowJoin(true); }}
                className="flex items-center justify-center gap-2 w-full py-3 rounded-xl border border-room-border text-room-muted hover:text-room-text hover:bg-room-hover text-sm font-medium transition-colors min-h-[48px]"
              >
                <Link size={16} />
                Join with invite code
              </button>
            </div>
          </div>
        ) : (
          <Loader2 size={32} className="animate-spin text-room-muted" />
        )}
      </div>

      {/* Create modal */}
      {showCreate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setShowCreate(false)}
        >
          <div
            className="bg-room-surface border border-room-border rounded-2xl p-6 w-full max-w-sm shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-room-text mb-1">Create a Library</h2>
            <p className="text-sm text-room-muted mb-5">Give your library a name.</p>
            <input
              autoFocus
              className="w-full bg-room-bg border border-room-border rounded-xl px-4 py-2.5 text-sm text-room-text placeholder:text-room-muted outline-none focus:border-blue-500/50 mb-4"
              placeholder="e.g. Book Club, Study Group…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              maxLength={64}
            />
            {error && (
              <div className="flex items-start gap-2 mb-4 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300">
                <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={() => setShowCreate(false)} className="flex-1 py-2.5 rounded-xl border border-room-border text-room-muted text-sm hover:text-room-text transition-colors">
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !newName.trim()}
                className="flex-1 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-400 text-white text-sm font-medium disabled:opacity-50 transition-colors"
              >
                {creating ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Join modal */}
      {showJoin && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setShowJoin(false)}
        >
          <div
            className="bg-room-surface border border-room-border rounded-2xl p-6 w-full max-w-sm shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-lg font-bold text-room-text mb-1">Join a Library</h2>
            <p className="text-sm text-room-muted mb-5">Enter an invite code from a friend.</p>
            <input
              autoFocus
              className="w-full bg-room-bg border border-room-border rounded-xl px-4 py-2.5 text-sm text-room-text placeholder:text-room-muted outline-none focus:border-blue-500/50 mb-4 tracking-widest uppercase"
              placeholder="INVITE CODE"
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
              maxLength={12}
            />
            {error && (
              <div className="flex items-start gap-2 mb-4 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-300">
                <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={() => setShowJoin(false)} className="flex-1 py-2.5 rounded-xl border border-room-border text-room-muted text-sm hover:text-room-text transition-colors">
                Cancel
              </button>
              <button
                onClick={handleJoin}
                disabled={joining || !inviteCode.trim()}
                className="flex-1 py-2.5 rounded-xl bg-blue-500 hover:bg-blue-400 text-white text-sm font-medium disabled:opacity-50 transition-colors"
              >
                {joining ? 'Joining…' : 'Join'}
              </button>
            </div>
          </div>
        </div>
      )}
      <LibraryChatLauncher hidden={showCreate || showJoin} />
    </div>
  );
}
