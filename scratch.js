require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  console.log('Ensuring library membership for all users...');

  // Get all users
  const { data: users, error: userFetchError } = await supabase.from('users').select('id');
  if (userFetchError || !users) {
    console.error('Error fetching users:', userFetchError);
    return;
  }

  for (const u of users) {
    const { data: member, error: memberErr } = await supabase.from('library_members').upsert({
      library_id: 'global-library',
      user_id: u.id,
      role: 'member'
    }).select();

    if (memberErr) {
      console.error(`Error adding user ${u.id} to library:`, memberErr);
    } else {
      console.log(`Added user ${u.id} to global-library:`, member);
    }
  }

  console.log('Membership setup complete.');
}

run();
