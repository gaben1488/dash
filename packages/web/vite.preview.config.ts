import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

/**
 * Isolated visual-acceptance build. It bundles the production entry point
 * and actual page components but swaps ONLY the API transport and CSS tokens.
 * The normal vite.config.ts and production dist are never used here.
 */
export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: { alias: {
    '@': resolve(__dirname, './src'),
    '@aemr/shared': resolve(__dirname, '../shared/src/index.ts'),
    '@aemr/core': resolve(__dirname, '../core/src/index.ts'),
  } },
  build: {
    outDir: 'dist-preview',
    emptyOutDir: true,
    assetsInlineLimit: 20_000_000,
    cssCodeSplit: false,
    rollupOptions: {
      input: resolve(__dirname, 'preview.html'),
      output: {
        inlineDynamicImports: true,
        manualChunks: undefined,
      },
    },
  },
});
