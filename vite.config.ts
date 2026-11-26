import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The API server (server/main.ts) listens on 127.0.0.1:<PORT, default 5180> and rejects any Host
// other than 127.0.0.1:<port> / localhost:<port>, so the dev proxy rewrites Host via changeOrigin.
// scripts/dev.mjs starts the API on the same PORT, so the proxy follows it.
const apiPort = process.env.PORT || '5180';

/** True when Origin is the Vite page itself on loopback: `http://<Host>`, Host being localhost or 127.0.0.1. */
export function isDevPageOrigin(origin: string | undefined, host: string | undefined): boolean {
  if (!origin || !host || !/^(localhost|127\.0\.0\.1):\d+$/.test(host)) return false;
  return origin === `http://${host}`;
}

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${apiPort}`,
        changeOrigin: true,
        // changeOrigin rewrites Host only. The browser sends Origin: http://localhost:5173 on a
        // PUT, which PUT /api/settings would refuse, so present the dev page's own origin as the
        // API's. Any other Origin (another site) passes through unchanged and is still refused.
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            if (isDevPageOrigin(req.headers.origin, req.headers.host)) {
              proxyReq.setHeader('origin', `http://127.0.0.1:${apiPort}`);
            }
          });
        },
      },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true },
});
