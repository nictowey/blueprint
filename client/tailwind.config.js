/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        'dark-bg':     '#08080c',
        'dark-surface': '#0e0e14',
        'dark-card':   '#111118',
        'dark-card-hover': '#16161f',
        'dark-border': '#1c1c2e',
        'dark-border-hover': '#2a2a40',
        accent:        '#c9a84c',
        'accent-light': '#e2c87a',
        'accent-dim':  '#8a7235',
        'accent-muted': 'rgba(201, 168, 76, 0.08)',
        'warm-white':  '#e8e6e1',
        'warm-gray':   '#9a9890',
        'warm-muted':  '#5a5850',
      },
      fontFamily: {
        display: ['"Instrument Serif"', 'Georgia', 'serif'],
        sans: ['Outfit', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
      },
      animation: {
        'fade-in': 'fadeIn 0.5s ease-out',
        'fade-in-up': 'fadeInUp 0.6s ease-out',
        'fade-in-up-delay': 'fadeInUp 0.6s ease-out 0.1s both',
        'fade-in-up-delay-2': 'fadeInUp 0.6s ease-out 0.2s both',
        'fade-in-up-delay-3': 'fadeInUp 0.6s ease-out 0.3s both',
        'shimmer': 'shimmer 2s ease-in-out infinite',
        'pulse-gold': 'pulseGold 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        fadeInUp: {
          from: { opacity: '0', transform: 'translateY(12px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%, 100%': { opacity: '0.5' },
          '50%': { opacity: '1' },
        },
        pulseGold: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(201, 168, 76, 0)' },
          '50%': { boxShadow: '0 0 20px 2px rgba(201, 168, 76, 0.08)' },
        },
      },
    },
  },
  plugins: [],
};
