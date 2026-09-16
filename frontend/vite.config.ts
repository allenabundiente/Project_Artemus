import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Backend target is env-overridable (API_PORT of a dev server running on a
// non-default port): `API_PORT=4012 npx vite`
const apiTarget = `http://localhost:${process.env.API_PORT || 4010}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: true },
    },
  },
  build: { target: 'es2020' },
});