/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        bgBase: '#111215',
        bgSidebar: '#19191d',
        bgSurface: '#242529',
        bgSurfaceHover: '#2e2f34',

        borderSubtle: 'rgba(255, 255, 255, 0.06)',
        borderFocus: 'rgba(255, 255, 255, 0.1)',

        textMain: '#ececed',
        textMuted: '#949499',
        textFaint: '#5f5f66',

        accent: '#d07d61',
        accentHover: '#e38e72',
        accentSurface: 'rgba(208, 125, 97, 0.15)',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'Avenir', 'Helvetica', 'Arial', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 15px -3px rgba(208, 125, 97, 0.2)',
        float: '0 12px 40px -8px rgba(0, 0, 0, 0.6)',
        'inner-light': 'inset 0 1px 0 rgba(255, 255, 255, 0.05)',
      },
    },
  },
  plugins: [],
}
