import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API server (server/main.ts) listens on 127.0.0.1:<PORT, default 5180> and rejects any Host
// other than 127.0.0.1:<port> / localhost:<port>, so the dev proxy rewrites Host via changeOrigin.
// scripts/dev.mjs starts the API on the same PORT, so the proxy follows it.
const apiPort = process.env.PORT || '5180';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
