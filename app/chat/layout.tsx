// app/chat/layout.tsx
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Global Chat — ReadRoom',
  description: 'Stay connected with your reading community in the ReadRoom global chat.',
};

export default function ChatLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-[100dvh] overflow-hidden bg-room-bg">
      {children}
    </div>
  );
}
