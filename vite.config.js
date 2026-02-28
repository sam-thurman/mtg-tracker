import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api/spellbook': {
        target: 'https://backend.commanderspellbook.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/spellbook/, '/variants/'),
      },
      '/api/ck-pricelist': {
        target: 'https://api.cardkingdom.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/ck-pricelist/, '/api/pricelist'),
      },
    },
  },
})
