const appUrl = process.env.NEXT_PUBLIC_APP_URL;
let appHostname;
try {
  appHostname = appUrl ? new URL(appUrl).hostname : undefined;
} catch {
  appHostname = undefined;
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  allowedDevOrigins: [
    'localhost',
    '*.localhost',
    '*.ngrok-free.dev',
    ...(appHostname ? [appHostname] : []),
  ],
  experimental: {
    serverComponentsExternalPackages: ['pdfjs-dist'],
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: '*.googleusercontent.com' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
      { protocol: 'https', hostname: 'drive.google.com' },
    ],
  },
  transpilePackages: ['@supabase/ssr', '@supabase/supabase-js'],
  webpack(config) {
    config.resolve.alias = { ...config.resolve.alias, canvas: false };
    return config;
  },
  async redirects() {
    return [
      {
        source: '/servers/:path*',
        destination: '/libraries/:path*',
        permanent: true,
      },
      {
        source: '/api/servers/:path*',
        destination: '/api/libraries/:path*',
        permanent: true,
      },
    ];
  },
  async headers() {
    return [
      {
        source: '/sw.js',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=0, must-revalidate' },
          { key: 'Service-Worker-Allowed', value: '/' },
        ],
      },
      {
        // Global headers for all routes
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // 'unsafe-none' is required for Google Identity Services (GIS) popup auth.
          // GIS polls popup.closed to detect when the user completes authorization.
          // 'same-origin-allow-popups' blocks that window.closed read on cross-origin popups.
          // Primary auth flow uses Supabase session provider_token (no popup needed),
          // but the GIS fallback requires this header to be 'unsafe-none'.
          { key: 'Cross-Origin-Opener-Policy', value: 'unsafe-none' },
        ],
      },
    ];
  },
};

export default nextConfig;
