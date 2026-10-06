import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { legalPages } from './legal-plugin';

// GitHub Pages serves a project site under /<repo>/, so assets must be
// prefixed. BASE_PATH lets the deploy workflow set it without hardcoding the
// repository name here (and keeps `pnpm dev` at the root).
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
  plugins: [react(), legalPages()],
  server: {
    port: 5174,
    fs: {
      // The legal pages import docs/legal/*.md from the repository root.
      allow: [resolve(__dirname, '..', '..')],
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        confidentialite: resolve(__dirname, 'confidentialite/index.html'),
        cgu: resolve(__dirname, 'cgu/index.html'),
        mentions: resolve(__dirname, 'mentions-legales/index.html'),
        suppression: resolve(__dirname, 'suppression-compte/index.html'),
        beta: resolve(__dirname, 'beta/index.html'),
      },
    },
  },
});
