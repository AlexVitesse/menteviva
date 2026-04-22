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
    // Vite >=5.x bloquea hosts no whitelisted como medida de seguridad.
    // Aqui aceptamos los providers de tunnel comunes para demos remotas.
    // Cada entry con punto al inicio es wildcard de subdominio.
    allowedHosts: [
      'localhost',
      '.ngrok-free.dev',
      '.ngrok-free.app',
      '.ngrok.io',
      '.devtunnels.ms',
      '.trycloudflare.com',
    ],
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
