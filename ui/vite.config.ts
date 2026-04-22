import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Modules import from '@framework/ui' — resolve to our component library
      '@framework/ui': path.resolve(__dirname, 'src/framework/ui/index.ts'),
    },
  },
  server: {
    port: 5173,
    fs: {
      allow: [
        // Allow Vite to serve module files from the workspace root
        path.resolve(__dirname, '..'),
      ],
    },
    proxy: {
      '/api':    { target: 'http://localhost:3000', changeOrigin: true },
      '/ws/admin': { target: 'ws://localhost:3000',  ws: true },
    },
  },
})
