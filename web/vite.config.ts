import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Dev server proxies /api (REST + SSE) to the MIA backend; MIA_PORT keeps both sides in sync.
const apiPort = process.env.MIA_PORT ?? '8787';
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true, proxy: { '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false } } },
  preview: { port: 4173, host: true, proxy: { '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: false } } },
});
