// app/page.tsx — Landing page, redirects based on auth state
'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { BookOpen, Loader2 } from 'lucide-react';

export default function HomePage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (user) {
        router.replace('/servers');
      } else {
        router.replace('/auth');
      }
    }
  }, [user, loading, router]);

  return (
    <div className="min-h-screen bg-room-bg flex items-center justify-center flex-col gap-4">
      <div className="w-14 h-14 rounded-2xl bg-blue-500 flex items-center justify-center animate-pulse">
        <BookOpen size={28} className="text-white" />
      </div>
      <Loader2 size={22} className="animate-spin text-room-muted" />
    </div>
  );
}
