import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API server (server/main.ts) listens on 127.0.0.1:5180 and rejects any Host other than
// 127.0.0.1:<port> / localhost:<port>, so the dev proxy rewrites Host via changeOrigin.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://127.0.0.1:5180', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
