import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Every build gets its own file names. The content hash alone did not always change
// between deploys, and browsers (and the offline cache) keep a file name forever.
const build = (process.env.VERCEL_GIT_COMMIT_SHA || Date.now().toString(36)).slice(0, 8)

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name]-[hash]-${build}.js`,
        chunkFileNames: `assets/[name]-[hash]-${build}.js`,
        assetFileNames: `assets/[name]-[hash]-${build}[extname]`,
      },
    },
  },
  worker: {
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name]-[hash]-${build}.js`,
        chunkFileNames: `assets/[name]-[hash]-${build}.js`,
      },
    },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})
