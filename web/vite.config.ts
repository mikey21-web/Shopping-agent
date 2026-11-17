import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const API_TARGET = process.env.VITE_API_TARGET ?? 'http://localhost:4000';

/**
 * Termux / Proot compatibility.
 *
 * Native Node addons (`.node` files) cannot be dlopen'ed inside the Android
 * linker namespace, which breaks the platform-specific Rollup binary that
 * Vite depends on. Rollup publishes an official WebAssembly build with the
 * same API, so we alias it in. esbuild (a standalone binary, not an addon)
 * works fine and needs no change.
 */
const rollupWasmAlias = {
  'rollup/parseAst': '@rollup/wasm-node/parseAst',
  rollup: '@rollup/wasm-node',
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: rollupWasmAlias,
  },
  optimizeDeps: {
    // Pre-bundling uses esbuild; the alias must not apply to the optimizer.
    exclude: ['@rollup/wasm-node'],
  },
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
