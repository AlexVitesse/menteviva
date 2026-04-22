import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Proxy /api (HTTP + WebSocket) al backend local. Asi el frontend solo expone
// un puerto y, cuando se accede via tunnel HTTPS (devtunnels/ngrok), todo el
// trafico viaja por la misma URL. Evita problemas de CORS y mixed-content.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        ws: true, // habilita upgrade a WebSocket para /api/conversation/...
      },
      '/health': {
        target: 'http://localhost:8000',
        changeOrigin: true,
      },
    },
  },
})
