import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' so the built index.html works when Electron loads it from disk (file://).
export default defineConfig({
  plugins: [react()],
  base: './',
  build: {
    outDir: '../desktop/renderer',
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});
