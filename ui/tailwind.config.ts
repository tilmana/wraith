import type { Config } from 'tailwindcss'

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        surface:  '#0f0f17',
        panel:    '#16161f',
        border:   '#252535',
        accent:   '#7c3aed',
        'accent-dim': '#4c1d95',
        muted:    '#4b5563',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
    },
  },
  plugins: [],
} satisfies Config
