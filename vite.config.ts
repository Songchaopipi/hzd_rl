import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { cp, mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'

export default defineConfig({
  base: './',
  plugins: [react(), {
    name: 'hzd-public-assets',
    async writeBundle() {
      for (const dir of ['hzd', 'models/locomotion']) {
        const target = resolve('dist', dir)
        await mkdir(target, { recursive: true })
        await cp(resolve('public', dir), target, { recursive: true })
      }
    },
  }],
  build: { copyPublicDir: false },
  assetsInclude: ['**/*.onnx'],
  optimizeDeps: { exclude: ['@mujoco/mujoco'] },
})
