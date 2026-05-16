// app/room/[id]/page.tsx
import { notFound } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { RoomShell } from '@/components/room/RoomShell';
import { cookies } from 'next/headers';
import { v4 as uuidv4 } from 'uuid';

interface RoomPageProps {
  params: { id: string };
}

export async function generateMetadata({ params }: RoomPageProps) {
  const supabase = createClient();
  const { data } = await supabase
    .from('rooms')
    .select('name, pdf_name')
    .eq('id', params.id)
    .single();
  return {
    title: data?.name ?? 'ReadRoom',
    description: data?.pdf_name
      ? `Reading "${data.pdf_name}" together`
      : 'Collaborative PDF reading room',
  };
}

export default async function RoomPage({ params }: RoomPageProps) {
  const supabase = createClient();
  const { data: room } = await supabase
    .from('rooms')
    .select('id, name, pdf_drive_id, pdf_name, pdf_url, current_page, zoom, scroll_pct')
    .eq('id', params.id)
    .single();

  if (!room) notFound();

  const cookieStore = cookies();
  let userId = cookieStore.get('user_id')?.value;
  let userName = cookieStore.get('user_name')?.value;
  if (!userId) userId = uuidv4();
  if (!userName) userName = `Reader ${userId.slice(0, 4).toUpperCase()}`;

  if (!cookieStore.get('user_id')) {
    cookieStore.set({
      name: 'user_id',
      value: userId,
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
  }

  if (!cookieStore.get('user_name')) {
    cookieStore.set({
      name: 'user_name',
      value: userName,
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    });
  }

  const initialRoom = {
    id:   room.id,
    name: room.name,
    pdf:  room.pdf_drive_id ? {
      fileId:   room.pdf_drive_id,
      filename: room.pdf_name ?? 'document.pdf',
      thumbnail: room.pdf_url ?? null,
      owner:    '',
      url:      `https://drive.google.com/uc?export=download&id=${room.pdf_drive_id}`,
    } : null,
    currentPage: room.current_page ?? 1,
    zoom:        room.zoom ?? 1,
    scrollPct:   room.scroll_pct ?? 0,
  };

  return (
    <>
      <script
        dangerouslySetInnerHTML={{
          __html: `
            if (!document.cookie.includes('user_id=')) {
              document.cookie = 'user_id=${userId}; path=/; max-age=31536000; SameSite=Lax';
              document.cookie = 'user_name=${userName}; path=/; max-age=31536000; SameSite=Lax';
            }
          `,
        }}
      />
      <RoomShell
        roomId={params.id}
        initialUserId={userId}
        initialUserName={userName}
        initialRoom={initialRoom}
      />
    </>
  );
}
