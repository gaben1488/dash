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
    rollupOptions: {
      output: {
        // Библиотеки разложены по кускам, которые живут разными жизнями:
        // React и графики меняются раз в полгода, наш код — каждый день. В одном
        // файле любая правка обесценивала бы кэш браузера целиком, и читатель
        // качал бы полтора мегабайта заново ради исправленной подписи.
        manualChunks(id: string) {
          if (!id.includes('node_modules')) return undefined;
          // Recharts тянет за собой семейство d3 и victory-vendor — это самая
          // тяжёлая зависимость дэша, и нужна она только страницам с графиками.
          if (/node_modules[/\\](recharts|victory-vendor|d3-[a-z-]+|internmap|delaunator|robust-predicates|decimal\.js-light|fast-equals|eventemitter3)[/\\]/.test(id)) {
            return 'charts';
          }
          if (/node_modules[/\\](react|react-dom|scheduler|react-is|use-sync-external-store)[/\\]/.test(id)) {
            return 'react-vendor';
          }
          if (/node_modules[/\\](@radix-ui|@floating-ui|lucide-react|cmdk|sonner|aria-hidden|react-remove-scroll|react-remove-scroll-bar|react-style-singleton|get-nonce|use-callback-ref|use-sidecar|detect-node-es|tabbable)[/\\]/.test(id)) {
            return 'ui-vendor';
          }
          return undefined;
        },
      },
    },
  },
});
