/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        neonPurple: '#9B5CFF',
        neonBlue: '#4FD3FF',
        neonPink: '#FF4FD8',
        night: '#090915',
      },
      boxShadow: {
        glow: '0 0 30px rgba(155,92,255,0.6), 0 0 60px rgba(79,211,255,0.4)',
        glowPink: '0 0 24px rgba(255,79,216,0.55)',
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
      },
      keyframes: {
        pulseRing: {
          '0%': { transform: 'scale(0.96)', opacity: '0.7' },
          '50%': { transform: 'scale(1.02)', opacity: '1' },
          '100%': { transform: 'scale(0.96)', opacity: '0.7' },
        },
        waveFloat: {
          '0%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-6px)' },
          '100%': { transform: 'translateY(0px)' },
        },
      },
      animation: {
        pulseRing: 'pulseRing 4s ease-in-out infinite',
        waveFloat: 'waveFloat 3s ease-in-out infinite',
      },
    },
  },
  plugins: [],
}
