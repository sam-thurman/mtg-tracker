import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/spellbook': {
        target: 'https://backend.commanderspellbook.com/variants',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/spellbook/, ''),
      },
    },
  },
})
