// app/auth/callback/route.ts
// This route handles the OAuth code exchange for Supabase Auth.
// IMPORTANT: middleware MUST NOT run supabase.auth.getUser() on this route,
// or the PKCE code verifier will be consumed before we can exchange it here.

import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const { searchParams } = requestUrl;
  const origin = process.env.NEXT_PUBLIC_APP_URL || requestUrl.origin;

  // ── 1. Dump every query param for full visibility ────────────────────────
  const allParams: Record<string, string> = {};
  searchParams.forEach((value, key) => { allParams[key] = value; });
  console.log('[auth/callback] ══ RAW REQUEST ══', {
    url: request.url,
    params: allParams,
    headers: {
      cookie: request.headers.get('cookie') ?? '(none)',
      referer: request.headers.get('referer') ?? '(none)',
    },
  });

  const code = searchParams.get('code');
  const error = searchParams.get('error');
  const errorCode = searchParams.get('error_code');
  const errorDescription = searchParams.get('error_description');
  const next = searchParams.get('next') ?? '/libraries';

  console.log('[auth/callback] GET', {
    code: code ? `${code.slice(0, 8)}…` : null,
    error,
    errorCode,
    errorDescription,
    next,
    computedOrigin: origin,
  });

  // ── 2. Google/provider returned an error before we even get a code ────────
  if (error) {
    console.error('[auth/callback] ══ PROVIDER ERROR (no code exchange attempted) ══', {
      error,
      errorCode,
      errorDescription,
      diagnosis: [
        'This error came directly from the OAuth provider (Google/Supabase), NOT from your app.',
        'Common causes:',
        '  • "Unable to exchange external code" → Google rejected the code, likely because:',
        '    – The auth code was already used (double callback hit)',
        '    – The redirect_uri sent to Google does NOT match the one registered in Google Cloud Console',
        '    – The Supabase project redirect URL does not include http://localhost:3000/auth/callback',
        '  • "server_error" from Supabase → Supabase itself failed to call Google token endpoint',
        'ACTION: Check Supabase dashboard → Auth → URL Configuration → Redirect URLs',
        'ACTION: Check Google Cloud Console → OAuth 2.0 → Authorized redirect URIs',
      ].join('\n'),
    });
    return NextResponse.redirect(
      `${origin}/auth?error=${encodeURIComponent(errorDescription ?? error)}`
    );
  }

  if (!code) {
    console.error('[auth/callback] No code in URL params');
    return NextResponse.redirect(`${origin}/auth?error=no_code`);
  }

  // ── 3. Inspect cookies before attempting PKCE exchange ───────────────────
  const cookieStore = cookies();
  const allCookies = cookieStore.getAll();
  const pkceRelated = allCookies.filter(c =>
    c.name.includes('code_verifier') ||
    c.name.includes('pkce') ||
    c.name.includes('supabase') ||
    c.name.includes('sb-')
  );

  console.log('[auth/callback] ══ COOKIE STATE ══', {
    totalCookies: allCookies.length,
    cookieNames: allCookies.map(c => c.name),
    pkceRelatedCookies: pkceRelated.map(c => ({
      name: c.name,
      valueLength: c.value.length,
      valuePreview: c.value.slice(0, 20) + (c.value.length > 20 ? '…' : ''),
    })),
    hasPkceVerifier: pkceRelated.some(c => c.name.includes('code_verifier') || c.name.includes('code-verifier')),
    diagnosis: pkceRelated.length === 0
      ? '⚠️  NO supabase/pkce cookies found — PKCE verifier may be missing. This will cause exchange to fail.'
      : '✓ Supabase cookies present',
  });

  // ── 4. Build Supabase client ─────────────────────────────────────────────
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            try {
              cookieStore.set(name, value, options);
            } catch (e) {
              console.warn('[auth/callback] cookie set skipped (expected in route handlers):', name);
            }
          });
        },
      },
    }
  );

  console.log('[auth/callback] Calling exchangeCodeForSession with code:', `${code.slice(0, 8)}…`);

  const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);

  // ── 5. Full error dump if exchange fails ─────────────────────────────────
  if (exchangeError) {
    console.error('[auth/callback] ══ exchangeCodeForSession FAILED ══', {
      message: exchangeError.message,
      status: exchangeError.status,
      name: exchangeError.name,
      // Cast to any to capture any extra fields Supabase may attach
      raw: JSON.stringify(exchangeError),
      supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
      diagnosis: [
        '"Unable to exchange external code" usually means:',
        '  1. The code was already consumed (Supabase or middleware hit it first)',
        '  2. The PKCE code_verifier cookie was missing or mismatched',
        '  3. The redirect URI mismatch between Google and Supabase',
        '  4. The auth code expired (they are single-use and short-lived)',
        'Check the cookie state logged above — if no pkce cookies, that is your root cause.',
      ].join('\n'),
    });
    return NextResponse.redirect(
      `${origin}/auth?error=${encodeURIComponent(exchangeError.message)}`
    );
  }

  // ── 6. Success ────────────────────────────────────────────────────────────
  console.log('[auth/callback] ══ SESSION CREATED ══', {
    userId: data.user?.id,
    email: data.user?.email,
    provider: data.user?.app_metadata?.provider,
    expiresAt: data.session?.expires_at,
  });

  return NextResponse.redirect(`${origin}${next}`);
}
