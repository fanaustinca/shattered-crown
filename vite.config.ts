import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: { target: 'es2022', chunkSizeWarningLimit: 8000, outDir: 'dist', assetsInlineLimit: 0 },
  worker: { format: 'es' },
});
