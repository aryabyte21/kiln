import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/aria':        'http://localhost:8765',
      '/tools':       'http://localhost:8765',
      '/health':      'http://localhost:8765',
      '/audio':       'http://localhost:8765',
      '/vibe-events': { target: 'http://localhost:8002', rewrite: (path) => path.replace(/^\/vibe-events/, '') },
    },
  },
})
