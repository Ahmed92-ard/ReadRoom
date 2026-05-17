import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  const { data, error } = await supabase
    .from('room_pdfs')
    .select('id, room_id, filename, storage_path, rooms!inner(library_id)')
    .limit(1);
  console.log({ data, error });
}
test();
