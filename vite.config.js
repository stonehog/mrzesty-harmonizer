import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  // Local dev / `npm start` keep a relative base so the build works at the
  // site root. GitHub Pages is served from /mrzesty-harmonizer/, so the
  // deploy script sets GITHUB_PAGES=true for that build.
  base: process.env.GITHUB_PAGES === 'true' ? '/mrzesty-harmonizer/' : './',
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
