import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { variantFor } from './shared/variant.js'

// APP_VARIANT=TPL or TCL builds that company's app; unset builds the combined one.
const variant = variantFor(process.env.APP_VARIANT)

const manifest = {
  name: variant.name,
  short_name: variant.short,
  description: `Live status of indented materials for ${variant.plants.map((plant) => plant.label).join(', ')}.`,
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#f5f6f8',
  theme_color: '#0f766e',
  shortcuts: [{ name: 'Purchase desk', short_name: 'Purchase', url: '/buyer', description: 'Update milestones and upload SAP reports' }],
  icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' }],
}

// Names the page and the installable app after the variant being built.
const branding = {
  name: 'branding',
  transformIndexHtml: (html) => html.replace('<title>Material Tracking</title>', `<title>${variant.name}</title>`).replace('content="MatTrack"', `content="${variant.short}"`),
  configureServer(server) {
    server.middlewares.use('/manifest.webmanifest', (_req, res) => {
      res.setHeader('Content-Type', 'application/manifest+json')
      res.end(JSON.stringify(manifest))
    })
  },
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: JSON.stringify(manifest, null, 2) })
  },
}

// Every build gets its own file names. The content hash alone did not always change
// between deploys, and browsers (and the offline cache) keep a file name forever.
const build = (process.env.VERCEL_GIT_COMMIT_SHA || Date.now().toString(36)).slice(0, 8)

export default defineConfig({
  plugins: [react(), branding],
  define: { __APP_VARIANT__: JSON.stringify(variant.id) },
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
