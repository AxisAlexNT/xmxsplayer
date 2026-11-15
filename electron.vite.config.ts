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
    plugins: [vue()],
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
