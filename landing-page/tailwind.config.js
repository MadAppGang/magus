/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    theme: {
        extend: {
            colors: {
                paper: '#E8E4DD',
                signal: '#E63B2E',
                offwhite: '#F5F3EE',
                ink: '#111111',
                mid: '#888580',
            },
            fontFamily: {
                heading: ['"Space Grotesk"', 'sans-serif'],
                drama: ['"DM Serif Display"', 'serif'],
                mono: ['"Space Mono"', 'monospace'],
            },
            borderRadius: {
                '2xl-plus': '2rem',
                '3xl-plus': '3rem',
                '4xl': '4rem',
            },
            letterSpacing: {
                brutal: '-0.04em',
                tight: '-0.02em',
            }
        },
    },
    plugins: [],
}
