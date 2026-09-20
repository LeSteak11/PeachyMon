import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Tauri sets TAURI_ENV_* in the env of its beforeBuild/beforeDev commands, so we
// can detect a desktop build and serve assets from relative paths (the desktop
// shell loads them off a local protocol, not a GitHub Pages sub-path).
const isTauri = !!process.env.TAURI_ENV_PLATFORM;

// IMPORTANT: for the GitHub Pages build, 'base' must match your repo name.
// e.g. github.com/AntProj/PokeKit  →  base = '/PokeKit/'  (case-sensitive!)
// The desktop (Tauri) build overrides this to './'.
export default defineConfig({
  plugins: [react()],
  base: isTauri ? './' : '/PeachyMon/',
  // The vendored damage engine (vendor/pokemmo-calc) is CommonJS — esbuild
  // pre-bundles it in dev (optimizeDeps), and in the production build Rollup's
  // commonjs transform must reach it. Because it's a `file:` dep that resolves
  // out of node_modules into vendor/, the default include (/node_modules/)
  // misses it, leaving raw `exports.x = …` that throws "exports is not defined"
  // in the browser — so we add the package to commonjsOptions.include.
  optimizeDeps: { include: ['pokemmo-calc'] },
  build: {
    outDir: 'dist',
    chunkSizeWarningLimit: 3000,
    // Tauri's Windows WebView2 is evergreen Chromium — no need to down-level.
    target: isTauri ? 'esnext' : 'modules',
    commonjsOptions: {
      include: [/node_modules/, /pokemmo-calc/],
      transformMixedEsModules: true,
    },
  },
  // Tauri dev expects a fixed port and no clearing of the terminal.
  ...(isTauri && {
    clearScreen: false,
    server: { port: 5173, strictPort: true },
  }),
});
