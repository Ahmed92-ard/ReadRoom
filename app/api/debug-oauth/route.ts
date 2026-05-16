// app/api/debug-oauth/route.ts
// ⚠️  DEVELOPMENT ONLY — remove or protect this route before deploying to production.
// Hit GET /api/debug-oauth to see the current OAuth configuration and identify mismatches.

import { NextResponse } from 'next/server';

export async function GET(request: Request) {
  const { origin } = new URL(request.url);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '(not set)';
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '(not set)';
  const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID ?? '(not set)';

  // The exact redirect URI your app sends to Supabase/Google
  const redirectUri = `${origin}/auth/callback`;

  const info = {
    warning: 'DEVELOPMENT ONLY — do not expose in production',
    timestamp: new Date().toISOString(),
    origin,

    // ── What your app is using ─────────────────────────────────────────────
    supabaseUrl,
    anonKeyPresent: anonKey !== '(not set)',
    anonKeyPreview: anonKey !== '(not set)' ? `${anonKey.slice(0, 12)}…` : '(not set)',
    googleClientIdPresent: googleClientId !== '(not set)',
    googleClientIdPreview: googleClientId !== '(not set)' ? `${googleClientId.slice(0, 12)}…` : '(not set)',

    // ── The exact redirect URI being used ──────────────────────────────────
    redirectUri,

    // ── Checklist ──────────────────────────────────────────────────────────
    checklist: {
      step1_supabaseRedirectUrls: {
        description: 'Add this exact URI in Supabase Dashboard → Auth → URL Configuration → Redirect URLs',
        mustMatch: redirectUri,
      },
      step2_googleConsole: {
        description: 'Add this exact URI in Google Cloud Console → APIs & Services → Credentials → OAuth 2.0 Client → Authorized redirect URIs',
        mustMatch: `${supabaseUrl}/auth/v1/callback`,
        note: 'Supabase acts as the middleman — Google redirects to Supabase, then Supabase redirects to your app',
      },
      step3_supabaseProviders: {
        description: 'In Supabase Dashboard → Auth → Providers → Google, confirm Client ID and Secret match your Google Cloud Console credentials',
      },
    },
  };

  console.log('[debug-oauth] Config dump requested:', info);

  return NextResponse.json(info, { status: 200 });
}
