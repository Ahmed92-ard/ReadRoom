-- ReadRoom profile repair + username uniqueness.
-- Run after 001_canonical_schema.sql on existing projects.

-- 1. Backfill missing public.users rows from auth.users.
INSERT INTO public.users (id, email, display_name, avatar_url, created_at, updated_at)
SELECT
  au.id,
  au.email,
  COALESCE(
    NULLIF(trim(au.raw_user_meta_data->>'full_name'), ''),
    NULLIF(trim(au.raw_user_meta_data->>'name'), ''),
    split_part(au.email, '@', 1),
    'Reader'
  ) AS display_name,
  au.raw_user_meta_data->>'avatar_url',
  COALESCE(au.created_at, now()),
  now()
FROM auth.users au
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  display_name = CASE
    WHEN public.users.display_name IS NULL OR public.users.display_name = '' OR public.users.display_name = 'Reader'
    THEN EXCLUDED.display_name
    ELSE public.users.display_name
  END,
  avatar_url = COALESCE(public.users.avatar_url, EXCLUDED.avatar_url),
  updated_at = now();

-- 2. Normalize empty names.
UPDATE public.users
SET display_name = COALESCE(NULLIF(split_part(email, '@', 1), ''), 'Reader'),
    updated_at = now()
WHERE display_name IS NULL OR trim(display_name) = '';

-- 3. De-duplicate existing display names before adding the uniqueness guard.
WITH ranked AS (
  SELECT
    id,
    display_name,
    row_number() OVER (PARTITION BY lower(display_name) ORDER BY created_at, id) AS rn
  FROM public.users
  WHERE display_name <> 'Reader'
)
UPDATE public.users u
SET display_name = left(r.display_name || ' ' || substring(u.id::text, 1, 4), 64),
    updated_at = now()
FROM ranked r
WHERE u.id = r.id AND r.rn > 1;

-- 4. Enforce case-insensitive username uniqueness except for incomplete Reader placeholders.
CREATE UNIQUE INDEX IF NOT EXISTS users_display_name_unique_ci
ON public.users (lower(display_name))
WHERE display_name <> 'Reader';

-- 5. Keep denormalized message authors aligned with repaired canonical profiles.
UPDATE public.messages m
SET sender_name = u.display_name,
    avatar_url = u.avatar_url
FROM public.users u
WHERE m.sender_id = u.id
  AND (
    m.sender_name IS DISTINCT FROM u.display_name
    OR m.avatar_url IS DISTINCT FROM u.avatar_url
  );

-- 6. Prevent future folder deletes from leaving orphaned PDF rows.
ALTER TABLE public.room_pdfs
  DROP CONSTRAINT IF EXISTS room_pdfs_folder_id_fkey;

ALTER TABLE public.room_pdfs
  ADD CONSTRAINT room_pdfs_folder_id_fkey
  FOREIGN KEY (folder_id) REFERENCES public.pdf_folders(id) ON DELETE CASCADE;
