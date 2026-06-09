// app/room/[id]/page.tsx — Legacy standalone room route.
// The main app flow uses /libraries/[id]/channels/[id] instead.
// This route is kept for backward compat with old room links.
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
    .select('name')
    .eq('id', params.id)
    .single();
  return {
    title: data?.name ?? 'ReadRoom',
    description: 'Collaborative PDF reading room',
  };
}

export default async function RoomPage({ params }: RoomPageProps) {
  const supabase = createClient();
  const { data: room } = await supabase
    .from('rooms')
    .select('id, name, current_page, zoom, scroll_pct')
    .eq('id', params.id)
    .single();

  if (!room) notFound();

  const cookieStore = await cookies();
  let userId = cookieStore.get('user_id')?.value;
  let userName = cookieStore.get('user_name')?.value;
  if (!userId) userId = uuidv4();
  if (!userName) userName = `Reader ${userId.slice(0, 4).toUpperCase()}`;

  const initialRoom = {
    id: room.id,
    name: room.name,
    pdf: null,
    currentPage: room.current_page ?? 1,
    zoom: room.zoom ?? 1,
    scrollPct: room.scroll_pct ?? 0,
    createdBy: '',
    createdAt: new Date().toISOString(),
  };

  return (
    <RoomShell
      roomId={params.id}
      initialUserId={userId}
      initialUserName={userName}
      initialRoom={initialRoom}
    />
  );
}
