import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * In development the frontend proxies /api, /socket.io and /uploads to the API
 * server, so the browser only ever talks to one origin. Set VITE_API_ORIGIN if
 * your API runs somewhere other than http://localhost:4000.
 *
 * In production (Vercel) set VITE_API_URL / VITE_SOCKET_URL to the deployed API
 * origin; those values are baked in at build time.
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiOrigin = env.VITE_API_ORIGIN || 'http://localhost:4000';

  return {
    plugins: [react()],
    server: {
      host: '0.0.0.0',
      port: Number(env.PORT || 5173),
      strictPort: false,
      // Needed so the sandbox preview host and any tunnel can reach the dev server.
      allowedHosts: true,
      proxy: {
        '/api': { target: apiOrigin, changeOrigin: true },
        '/uploads': { target: apiOrigin, changeOrigin: true },
        '/socket.io': { target: apiOrigin, ws: true, changeOrigin: true }
      }
    },
    preview: {
      host: '0.0.0.0',
      allowedHosts: true
    },
    build: {
      outDir: 'dist',
      sourcemap: false
    }
  };
});
