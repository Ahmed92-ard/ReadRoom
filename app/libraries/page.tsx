// app/libraries/page.tsx
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { useAuth } from '@/lib/hooks/useAuth';
import { BookOpen, ArrowRight, Loader2 } from 'lucide-react';
import { LibrarySidebar } from '@/components/layout/LibrarySidebar';

export default function LibrariesPage() {
  const router = useRouter();
  const { libraries, loadingLibraries, fetchLibraries } = useWorkspaceStore();
  const { user } = useAuth();

  useEffect(() => { fetchLibraries(); }, [fetchLibraries]);

  // Auto-navigate to first library if available
  useEffect(() => {
    if (!loadingLibraries && libraries.length > 0) {
      router.replace(`/libraries/${libraries[0].id}`);
    }
  }, [loadingLibraries, libraries, router]);

  return (
    <div className="flex h-screen bg-room-bg overflow-hidden">
      <LibrarySidebar />
      <div className="flex-1 flex items-center justify-center">
        {loadingLibraries ? (
          <Loader2 size={32} className="animate-spin text-room-muted" />
        ) : libraries.length === 0 ? (
          <div className="text-center max-w-sm px-6">
            <div className="w-16 h-16 rounded-2xl bg-blue-500/20 flex items-center justify-center mx-auto mb-5">
              <BookOpen size={28} className="text-blue-400" />
            </div>
            <h2 className="text-xl font-bold text-room-text mb-2">
              Welcome, {user?.user_metadata?.full_name?.split(' ')[0] ?? 'Reader'}!
            </h2>
            <p className="text-room-muted text-sm mb-6">
              You're not in any reading libraries yet. Create one to get started, or ask a friend for an invite code.
            </p>
            <div className="flex flex-col gap-3">
              <button
                onClick={() => document.querySelector<HTMLButtonElement>('[title="Create or join a library"]')?.click()}
                className="flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-blue-500 hover:bg-blue-400 text-white text-sm font-medium transition-colors"
              >
                <ArrowRight size={16} />
                Create your first library
              </button>
            </div>
          </div>
        ) : (
          <Loader2 size={32} className="animate-spin text-room-muted" />
        )}
      </div>
    </div>
  );
}
