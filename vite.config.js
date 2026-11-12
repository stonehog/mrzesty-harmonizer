import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  // Local dev / `npm start` keep a relative base. The GitHub Pages deploy is
  // served at the root of the custom domain https://mrzesty.com, so it uses '/'.
  base: process.env.GITHUB_PAGES === 'true' ? '/' : './',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Keep the WAV one-shots as separate files (not base64-inlined into JS)
    assetsInlineLimit: 0,
  },
  server: {
    port: 5173,
    // Mic needs secure context; Vite localhost is fine
  },
});
