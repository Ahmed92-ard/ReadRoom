import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './styles/**/*.css',
  ],
  theme: {
    extend: {
      colors: {
        'room-bg':      'var(--room-bg)',
        'room-surface': 'var(--room-surface)',
        'room-border':  'var(--room-border)',
        'room-hover':   'var(--room-hover)',
        'room-text':    'var(--room-text)',
        'room-muted':   'var(--room-muted)',
      },
    },
  },
  plugins: [],
};

export default config;
