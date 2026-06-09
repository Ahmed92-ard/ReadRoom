// app/chat/page.tsx
'use client';

import { LibrarySidebar } from '@/components/layout/LibrarySidebar';
import { GlobalChat } from '@/components/chat/GlobalChat';
import { useAuth } from '@/lib/hooks/useAuth';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';

export default function ChatPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/auth');
    }
  }, [user, loading, router]);

  if (loading || !user) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-room-bg">
        <Loader2 size={32} className="animate-spin text-room-muted" />
      </div>
    );
  }

  return (
    <div className="flex h-full bg-room-bg overflow-hidden">
      <LibrarySidebar />
      <div className="flex-1 flex flex-col min-w-0 bg-room-bg">
        <GlobalChat />
      </div>
    </div>
  );
}
