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
      // Google user avatars (profile pictures from Google OAuth)
      { protocol: 'https', hostname: '*.googleusercontent.com' },
      { protocol: 'https', hostname: 'lh3.googleusercontent.com' },
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
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // same-origin-allow-popups: allows Google OAuth redirect popup to work
          // without weakening isolation for the main app window.
          { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
        ],
      },
    ];
  },
};

export default nextConfig;
