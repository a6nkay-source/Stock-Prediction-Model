import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

// The API (and any keys it may hold) lives on the Python server; the browser only
// ever talks to /api, which is proxied in development.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // `@/…` resolves to `src/…`, the import convention shadcn components expect.
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:8000' },
  },
})
