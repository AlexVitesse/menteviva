import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Vite dev transforma los .mjs que vengan como dynamic import, aunque esten
// en public/. ORT Web hace un `import("/vad/ort-wasm-simd-threaded.mjs")` en
// runtime, y eso dispara "This file is in /public... should not be imported
// from source code". Este middleware sirve /vad/* como bytes crudos antes de
// que el transform pipeline lo vea.
function vadAssetsPlugin(): Plugin {
  const vadDir = path.join(__dirname, 'public', 'vad')
  const mime: Record<string, string> = {
    '.wasm': 'application/wasm',
    '.mjs': 'text/javascript',
    '.js': 'text/javascript',
    '.onnx': 'application/octet-stream',
  }
  return {
    name: 'serve-vad-assets-raw',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = req.url?.split('?')[0] ?? ''
        if (!url.startsWith('/vad/')) return next()
        const fileName = path.basename(url)
        const filePath = path.join(vadDir, fileName)
        if (!filePath.startsWith(vadDir)) return next() // path traversal guard
        fs.stat(filePath, (err, stat) => {
          if (err || !stat.isFile()) return next()
          const ext = path.extname(fileName)
          res.setHeader('Content-Type', mime[ext] ?? 'application/octet-stream')
          res.setHeader('Cache-Control', 'no-cache')
          fs.createReadStream(filePath).pipe(res)
        })
      })
    },
  }
}

// Proxy /api (HTTP + WebSocket) al backend local. Asi el frontend solo expone
// un puerto y, cuando se accede via tunnel HTTPS (devtunnels/ngrok), todo el
// trafico viaja por la misma URL. Evita problemas de CORS y mixed-content.
export default defineConfig({
  plugins: [react(), vadAssetsPlugin()],
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
