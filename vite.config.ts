import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Local full-stack development: `npm run dev:worker` listens on 8787.
      '/api': {
        target: 'http://127.0.0.1:8787',
        // Preserve the browser origin so the Worker's same-origin CSRF check
        // sees http://localhost:5173 instead of the proxy target.
        changeOrigin: false,
      },
    },
  },
})
