// app/page.tsx — Landing page, redirects based on auth state
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { resetReadRoomRuntimeState } from '@/lib/runtime/recovery';
import { AlertCircle, BookOpen, Loader2, RotateCcw } from 'lucide-react';

export default function HomePage() {
  const { user, loading, initError } = useAuth();
  const router = useRouter();
  const [showRecovery, setShowRecovery] = useState(false);

  useEffect(() => {
    if (!loading) {
      if (user) {
        router.replace('/libraries');
      } else {
        router.replace('/auth');
      }
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (!loading) return;
    const id = window.setTimeout(() => setShowRecovery(true), 12_000);
    return () => window.clearTimeout(id);
  }, [loading]);

  const recover = () => {
    resetReadRoomRuntimeState();
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-room-bg flex items-center justify-center flex-col gap-4">
      <div className="w-14 h-14 rounded-2xl bg-blue-500 flex items-center justify-center animate-pulse">
        <BookOpen size={28} className="text-white" />
      </div>
      <Loader2 size={22} className="animate-spin text-room-muted" />
      {(showRecovery || initError) && (
        <div className="mt-4 max-w-sm rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-center">
          <div className="flex items-center justify-center gap-2 text-sm font-medium text-red-200">
            <AlertCircle size={16} />
            Startup is taking longer than expected
          </div>
          <p className="mt-2 text-xs text-room-muted">
            {initError || 'A stale installed app cache or session may be blocking startup.'}
          </p>
          <button
            onClick={recover}
            className="mt-3 inline-flex min-h-[40px] items-center justify-center gap-2 rounded-lg bg-red-500 px-4 text-sm font-medium text-white hover:bg-red-400"
          >
            <RotateCcw size={15} />
            Reset local app cache
          </button>
        </div>
      )}
    </div>
  );
}
