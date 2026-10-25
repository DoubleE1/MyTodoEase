import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Shown in Settings > About. Kept in step with the desktop and root package.json by the release checklist.
const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };

// Default build: the Electron renderer, with base './' so index.html works from disk (file://).
// `--mode web` (loads .env.web, VITE_BACKEND=firebase): the hosted web app, served from Firebase Hosting.
export default defineConfig(({ mode }) => {
  const web = mode === 'web';
  return {
    plugins: [react()],
    base: web ? '/' : './',
    define: { __APP_VERSION__: JSON.stringify(version) },
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
