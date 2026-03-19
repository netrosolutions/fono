import { defineConfig } from 'tsup'

export default defineConfig([
  // core — no Node/browser deps
  {
    entry: { core: 'core.ts' },
    format: ['esm'],
    dts: true,
    clean: false,
    outDir: 'dist',
    target: 'es2022',
    esbuildOptions(opts) {
      opts.jsx = 'automatic'
      opts.jsxImportSource = 'hono/jsx'
    },
    external: ['hono', 'hono/jsx', 'hono/jsx/dom', 'vite'],
  },
  // server — Hono + Vite plugin
  {
    entry: { server: 'server.ts' },
    format: ['esm'],
    dts: true,
    clean: false,
    outDir: 'dist',
    target: 'es2022',
    esbuildOptions(opts) {
      opts.jsx = 'automatic'
      opts.jsxImportSource = 'hono/jsx'
    },
    external: [
      'hono', 'hono/jsx', 'hono/jsx/dom', 'hono/jsx/dom/server',
      'vite', '@hono/node-server', '@hono/node-server/serve-static',
      /^node:/,
    ],
  },
  // client — browser target
  {
    entry: { client: 'client.ts' },
    format: ['esm'],
    dts: true,
    clean: false,
    outDir: 'dist',
    target: 'es2022',
    platform: 'browser',
    esbuildOptions(opts) {
      opts.jsx = 'automatic'
      opts.jsxImportSource = 'hono/jsx'
    },
    external: ['hono', 'hono/jsx', 'hono/jsx/dom'],
  },
])
