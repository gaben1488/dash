import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

// B-12: allowedHosts:true accepts any Host header unconditionally (Vite's own
// types warn this is a DNS-rebinding risk). Gate the permissive mode behind an
// explicit env var; default to Vite's built-in localhost-only allow-list.
export function resolveAllowedHosts(rawValue: string | undefined): true | undefined {
  return rawValue === 'true' ? true : undefined;
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
      '@aemr/shared': resolve(__dirname, '../shared/src/index.ts'),
      '@aemr/core': resolve(__dirname, '../core/src/index.ts'),
    },
  },
  server: {
    port: 5173,
    host: true,
    // allow any host only when AEMR_VITE_ALLOW_PUBLIC_HOSTS=true (включая трюнели
    // cloudflare/ngrok/serveo/localtunnel/pinggy для live-демо); иначе Vite default.
    allowedHosts: resolveAllowedHosts(process.env.AEMR_VITE_ALLOW_PUBLIC_HOSTS),
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
