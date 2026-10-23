import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Default build: the Electron renderer, with base './' so index.html works from disk (file://).
// `--mode web` (loads .env.web, VITE_BACKEND=firebase): the hosted web app, served from Firebase Hosting.
export default defineConfig(({ mode }) => {
  const web = mode === 'web';
  return {
    plugins: [react()],
    base: web ? '/' : './',
    build: {
      outDir: web ? 'dist-web' : '../desktop/renderer',
      emptyOutDir: true,
    },
    server: {
      port: web ? 5174 : 5173,
      strictPort: true,
    },
  };
});
