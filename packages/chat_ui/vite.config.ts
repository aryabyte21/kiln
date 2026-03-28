import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/kiln':        'http://localhost:8765',
      '/tools':       'http://localhost:8766',
      '/health':      'http://localhost:8766',
      '/audio':       'http://localhost:8766',
      '/synthesis':   'http://localhost:8002',
    },
  },
})
