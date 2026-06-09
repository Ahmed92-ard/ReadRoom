'use client';

import { BookOpen, MessageSquare } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';

export function AppNavigation() {
  const pathname = usePathname();
  const router = useRouter();
  const isChat = pathname === '/chat';
  const isLibrary = pathname?.startsWith('/libraries');

  const items = [
    { label: 'Library', icon: BookOpen, active: isLibrary, href: '/libraries' },
    { label: 'Chat', icon: MessageSquare, active: isChat, href: '/chat' },
  ];

  return (
    <>
      <nav className="hidden h-full w-16 flex-shrink-0 flex-col items-center gap-2 border-r border-room-border bg-room-surface px-2 py-3 md:flex">
        {items.map(({ label, icon: Icon, active, href }) => (
          <button
            key={label}
            type="button"
            onClick={() => router.push(href)}
            title={label}
            aria-label={label}
            aria-current={active ? 'page' : undefined}
            className={`flex h-10 w-10 items-center justify-center rounded-xl transition-colors ${
              active
                ? 'bg-blue-500 text-white'
                : 'text-room-muted hover:bg-room-hover hover:text-room-text'
            }`}
          >
            <Icon size={20} />
          </button>
        ))}
      </nav>

      <nav className="fixed inset-x-0 bottom-0 z-[90] flex h-16 items-center justify-around border-t border-room-border bg-room-surface px-4 pb-[env(safe-area-inset-bottom)] md:hidden">
        {items.map(({ label, icon: Icon, active, href }) => (
          <button
            key={label}
            type="button"
            onClick={() => router.push(href)}
            aria-label={label}
            aria-current={active ? 'page' : undefined}
            className={`flex min-w-24 flex-col items-center justify-center gap-1 rounded-xl px-4 py-2 text-[11px] font-semibold transition-colors ${
              active
                ? 'bg-blue-500 text-white'
                : 'text-room-muted hover:bg-room-hover hover:text-room-text'
            }`}
          >
            <Icon size={18} />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </>
  );
}
