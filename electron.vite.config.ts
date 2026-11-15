import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {},
  preload: {
    build: {
      rollupOptions: {
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
        input: {
          ui: resolve('src/preload/ui.ts'),
          engine: resolve('src/preload/engine.ts'),
        },
      },
    },
  },
  renderer: {
    root: '.',
    publicDir: resolve('src/engine/public'),
    plugins: [vue()],
    worker: { format: 'es' },
    html: { cspNonce: '__XM_CSP_NONCE__' },
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: true,
      hmr: { protocol: 'ws', host: '127.0.0.1', port: 5173 },
    },
    build: {
      rollupOptions: {
        input: {
          ui: resolve('src/ui/index.html'),
          engine: resolve('src/engine/index.html'),
        },
      },
    },
  },
})
