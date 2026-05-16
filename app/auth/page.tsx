// app/auth/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/hooks/useAuth';
import { BookOpen, Users, MessageSquare, Zap } from 'lucide-react';

export default function AuthPage() {
  const { user, loading, signInWithGoogle } = useAuth();
  const router = useRouter();
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (user) router.replace('/libraries');
  }, [user, router]);

  // Check for error in URL (from failed OAuth callback)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const errParam = params.get('error');
    if (errParam) {
      const decoded = decodeURIComponent(errParam);
      console.error('[auth/page] OAuth error from callback:', decoded);
      setError(`Sign-in failed: ${decoded}`);
    }
  }, []);

  const handleSignIn = async () => {
    setSigningIn(true);
    setError(null);
    await signInWithGoogle();
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-room-bg flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-room-bg flex">
      {/* Left panel — branding */}
      <div className="hidden lg:flex lg:flex-1 bg-gradient-to-br from-blue-600/20 via-indigo-600/10 to-purple-600/20 items-center justify-center p-16 border-r border-room-border">
        <div className="max-w-md">
          <div className="flex items-center gap-3 mb-8">
            <div className="w-12 h-12 rounded-2xl bg-blue-500 flex items-center justify-center">
              <BookOpen size={24} className="text-white" />
            </div>
            <h1 className="text-2xl font-bold text-room-text">ReadRoom</h1>
          </div>
          <p className="text-3xl font-bold text-room-text mb-4 leading-tight">
            Read books together, wherever you are.
          </p>
          <p className="text-room-muted text-lg mb-12">
            A collaborative PDF workspace for study groups, book clubs, and curious minds.
          </p>
          <div className="space-y-5">
            {[
              { icon: BookOpen, title: 'Shared PDF Reading', desc: 'Upload PDFs from your device and read in sync with your group' },
              { icon: MessageSquare, title: 'Live Chat', desc: 'Discuss chapters in real-time while reading together' },
              { icon: Users, title: 'Presence Awareness', desc: 'See exactly which page everyone is on' },
              { icon: Zap, title: 'Rooms for Every Book', desc: 'Novels, textbooks, religious texts — organized in rooms' },
            ].map(({ icon: Icon, title, desc }) => (
              <div key={title} className="flex items-start gap-4">
                <div className="w-9 h-9 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                  <Icon size={16} className="text-blue-400" />
                </div>
                <div>
                  <p className="text-room-text font-medium text-sm">{title}</p>
                  <p className="text-room-muted text-xs mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel — sign in */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <div className="flex items-center gap-3 mb-8 lg:hidden">
            <div className="w-10 h-10 rounded-2xl bg-blue-500 flex items-center justify-center">
              <BookOpen size={20} className="text-white" />
            </div>
            <h1 className="text-xl font-bold text-room-text">ReadRoom</h1>
          </div>

          <h2 className="text-2xl font-bold text-room-text mb-2">Welcome back</h2>
          <p className="text-room-muted text-sm mb-8">Sign in to join your reading rooms.</p>

          {error && (
            <div className="mb-6 px-4 py-3 rounded-xl bg-red-900/20 border border-red-500/30 text-sm text-red-300">
              {error}
            </div>
          )}

          <button
            onClick={handleSignIn}
            disabled={signingIn}
            className="w-full flex items-center justify-center gap-3 py-3 px-4 rounded-xl font-medium text-sm bg-white text-gray-900 hover:bg-gray-100 active:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed transition-all min-h-[48px] shadow-lg"
          >
            {signingIn ? (
              <span className="w-5 h-5 border-2 border-gray-300 border-t-gray-800 rounded-full animate-spin" />
            ) : (
              <>
                <svg width="20" height="20" viewBox="0 0 18 18" aria-hidden="true">
                  <path d="M16.51 8H8.98v3h4.3c-.18 1-.74 1.48-1.6 2.04v2.01h2.6a7.8 7.8 0 0 0 2.38-5.88c0-.57-.05-.66-.15-1.18z" fill="#4285F4"/>
                  <path d="M8.98 17c2.16 0 3.97-.72 5.3-1.94l-2.6-2a4.8 4.8 0 0 1-7.18-2.54H1.83v2.07A8 8 0 0 0 8.98 17z" fill="#34A853"/>
                  <path d="M4.5 10.52a4.8 4.8 0 0 1 0-3.04V5.41H1.83a8 8 0 0 0 0 7.18l2.67-2.07z" fill="#FBBC05"/>
                  <path d="M8.98 4.18c1.17 0 2.23.4 3.06 1.2l2.3-2.3A8 8 0 0 0 1.83 5.4L4.5 7.49a4.77 4.77 0 0 1 4.48-3.3z" fill="#EA4335"/>
                </svg>
                Continue with Google
              </>
            )}
          </button>

          <p className="text-center text-xs text-room-muted mt-6">
            By signing in you agree to our{' '}
            <span className="text-blue-400 cursor-pointer hover:underline">Terms of Service</span>
            {' '}and{' '}
            <span className="text-blue-400 cursor-pointer hover:underline">Privacy Policy</span>.
          </p>
        </div>
      </div>
    </div>
  );
}
