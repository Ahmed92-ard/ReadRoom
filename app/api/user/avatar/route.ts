// app/api/user/avatar/route.ts
import { createClient, createAdminClient } from '@/lib/supabase/server';
import { NextResponse } from 'next/server';

const BUCKET = 'avatars';
const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/** Ensure the avatars bucket exists. Uses admin client so it works regardless of RLS. */
async function ensureBucket(supabase: ReturnType<typeof createAdminClient>) {
  if (!supabase) return;
  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = (buckets ?? []).some((b) => b.name === BUCKET);
  if (!exists) {
    await supabase.storage.createBucket(BUCKET, {
      public: true,
      fileSizeLimit: MAX_BYTES,
      allowedMimeTypes: ALLOWED_TYPES,
    });
  }
}

export async function POST(req: Request) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get('file') as File;

  if (!file || file.size === 0) {
    return NextResponse.json({ error: 'No file provided' }, { status: 400 });
  }

  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      { error: 'Only JPEG, PNG, WebP, and GIF images are allowed' },
      { status: 400 }
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: 'File size must be less than 5 MB' },
      { status: 400 }
    );
  }

  try {
    // Use admin client for storage operations to bypass RLS on the bucket
    const admin = createAdminClient();
    await ensureBucket(admin);

    // Use admin for upload if available, fall back to user client
    const storageClient = admin ?? supabase;

    // Unique path: avatars/{userId}/{timestamp}.{ext} — overwrites previous avatar
    const ext = file.type.split('/')[1] ?? 'png';
    const storagePath = `${user.id}/avatar-${Date.now()}.${ext}`;
    const buffer = await file.arrayBuffer();

    const { error: uploadError } = await storageClient.storage
      .from(BUCKET)
      .upload(storagePath, buffer, {
        contentType: file.type,
        upsert: true,
        cacheControl: '0', // disable CDN caching so new avatar shows immediately
      });

    if (uploadError) {
      console.error('[avatar] upload error:', uploadError);
      if (uploadError.message.toLowerCase().includes('bucket not found')) {
        return NextResponse.json(
          { error: 'Storage bucket "avatars" not found. Please create a public bucket named "avatars" in your Supabase dashboard.' },
          { status: 500 }
        );
      }
      return NextResponse.json({ error: uploadError.message }, { status: 500 });
    }

    // Build public URL with a cache-busting query param so clients don't get stale images
    const { data: urlData } = storageClient.storage.from(BUCKET).getPublicUrl(storagePath);
    const avatarUrl = `${urlData.publicUrl}?t=${Date.now()}`;

    // Update the user's profile record
    const { data: profile, error: updateError } = await supabase
      .from('users')
      .update({ avatar_url: avatarUrl })
      .eq('id', user.id)
      .select()
      .single();

    if (updateError) {
      console.error('[avatar] profile update error:', updateError);
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ profile, avatarUrl });
  } catch (err) {
    console.error('[avatar] unexpected error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
