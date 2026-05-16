import '../styles/globals.css';
import { ThemeProvider } from '@/components/ui/ThemeProvider';
import { AuthProvider } from '@/lib/hooks/useAuth';

export const metadata = {
  title: 'ReadRoom',
  description: 'A real-time collaborative PDF reading app',
  manifest: '/manifest.json',
};

const themeInitScript = `
(function () {
  try {
    var stored = localStorage.getItem('theme');
    var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var theme = stored || (prefersDark ? 'dark' : 'light');
    var html = document.documentElement;
    html.classList.remove('dark', 'light');
    html.classList.add(theme);
    html.style.colorScheme = theme;
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-room-bg text-room-text antialiased">
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        <AuthProvider>
          <ThemeProvider>{children}</ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
