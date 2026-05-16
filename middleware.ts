// middleware.ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

function hasSupabaseAuthCookie(request: NextRequest) {
  return request.cookies.getAll().some((cookie) =>
    cookie.name.startsWith('sb-') ||
    cookie.name.includes('supabase') ||
    cookie.name.includes('auth-token')
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // ── Static/API/SW routes: always pass through, no auth check ──────────────
  if (
    pathname.startsWith('/_next') ||
    pathname.startsWith('/icons') ||
    pathname.startsWith('/api/') ||
    pathname === '/sw.js' ||
    pathname === '/manifest.json' ||
    pathname === '/favicon.ico' ||
    pathname === '/offline.html'
  ) {
    return NextResponse.next({ request });
  }

  // ── CRITICAL: /auth/callback must NEVER be intercepted ───────────────────
  // The middleware calling supabase.auth.getUser() here would consume the
  // PKCE code verifier stored in cookies, making exchangeCodeForSession() fail
  // with "Unable to exchange external code".
  if (pathname === '/auth/callback') {
    console.log('[middleware] bypassing /auth/callback — allowing code exchange');
    return NextResponse.next({ request });
  }

  // ── Public routes: /auth and / don't need a session check ─────────────────
  if (pathname === '/auth' || pathname === '/') {
    return NextResponse.next({ request });
  }

  // ── Protected routes: verify session ──────────────────────────────────────
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  // Use getUser() (not getSession()) — getUser() validates with Supabase server.
  // If Supabase itself times out, don't bounce a cookie-bearing user to /auth;
  // let the protected page/API complete or show its own recoverable error.
  let user = null;
  let error: { message?: string } | null = null;
  try {
    const result = await supabase.auth.getUser();
    user = result.data.user;
    error = result.error;
  } catch (err) {
    error = err instanceof Error ? err : { message: String(err) };
    console.warn('[middleware] getUser threw on', pathname, error.message);

    if (hasSupabaseAuthCookie(request)) {
      return response;
    }
  }

  if (error) {
    console.warn('[middleware] getUser error on', pathname, error.message);
  }

  // Not authenticated on a protected route → redirect to /auth
  if (!user) {
    console.log('[middleware] unauthenticated access to', pathname, '→ /auth');
    return NextResponse.redirect(new URL('/auth', request.url));
  }

  return response;
}

export const config = {
  // Match everything except Next.js internals and static files
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons|sw\\.js|manifest\\.json).*)'],
};
