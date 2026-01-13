/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: 'class',
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // Primary brand color (Azure Blue - representing Microsoft Azure)
        primary: {
          50: '#e6f0ff',
          100: '#b3d1ff',
          200: '#80b3ff',
          300: '#4d94ff',
          400: '#1a75ff',
          500: '#0056e0',
          600: '#0043ad',
          700: '#00307a',
          800: '#001d47',
          900: '#000a14',
        },
        // Secondary brand color (Enterprise Purple - representing intelligence/AI)
        secondary: {
          50: '#f5f3ff',
          100: '#ede9fe',
          200: '#ddd6fe',
          300: '#c4b5fd',
          400: '#a78bfa',
          500: '#8b5cf6',
          600: '#7c3aed',
          700: '#6d28d9',
          800: '#5b21b6',
          900: '#4c1d95',
        },
        // Accent color (Teal - representing data/graphs)
        accent: {
          50: '#f0fdfa',
          100: '#ccfbf1',
          200: '#99f6e4',
          300: '#5eead4',
          400: '#2dd4bf',
          500: '#14b8a6',
          600: '#0d9488',
          700: '#0f766e',
          800: '#115e59',
          900: '#134e4a',
        },
      },
      fontSize: {
        // Typography scale with line heights for clear hierarchy
        'xs': ['0.75rem', { lineHeight: '1rem' }],      // 12px / 16px
        'sm': ['0.875rem', { lineHeight: '1.25rem' }],  // 14px / 20px
        'base': ['1rem', { lineHeight: '1.5rem' }],     // 16px / 24px
        'lg': ['1.125rem', { lineHeight: '1.75rem' }],  // 18px / 28px
        'xl': ['1.25rem', { lineHeight: '1.75rem' }],   // 20px / 28px
        '2xl': ['1.5rem', { lineHeight: '2rem' }],      // 24px / 32px
        '3xl': ['1.875rem', { lineHeight: '2.25rem' }], // 30px / 36px
        '4xl': ['2.25rem', { lineHeight: '2.5rem' }],   // 36px / 40px
        '5xl': ['3rem', { lineHeight: '1' }],           // 48px / 48px
        '6xl': ['3.75rem', { lineHeight: '1' }],        // 60px / 60px
        '7xl': ['4.5rem', { lineHeight: '1' }],         // 72px / 72px
      },
      fontWeight: {
        // Clear weight hierarchy
        'light': '300',
        'normal': '400',
        'medium': '500',
        'semibold': '600',
        'bold': '700',
        'extrabold': '800',
      },
      letterSpacing: {
        // Letter spacing for different font sizes
        'tighter': '-0.05em',
        'tight': '-0.025em',
        'normal': '0',
        'wide': '0.025em',
        'wider': '0.05em',
        'widest': '0.1em',
      },
      spacing: {
        // Standard 8px grid system for consistent spacing
        '18': '4.5rem',  // 72px
        '22': '5.5rem',  // 88px
        '26': '6.5rem',  // 104px
        '30': '7.5rem',  // 120px
        '34': '8.5rem',  // 136px
        '38': '9.5rem',  // 152px
        '42': '10.5rem', // 168px
        '46': '11.5rem', // 184px
        '50': '12.5rem', // 200px
      },
      gap: {
        // Consistent gap spacing for flexbox/grid layouts
        '18': '4.5rem',
        '22': '5.5rem',
      },
      keyframes: {
        'progress-indeterminate': {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(400%)' },
        },
      },
      animation: {
        'progress-indeterminate': 'progress-indeterminate 1.5s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
