/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  build: { sourcemap: false },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    css: false,
    // Node >= 25 ships a native, flag-gated localStorage global that shadows
    // jsdom's (it is undefined without --localstorage-file). Turn it off so
    // tests always see jsdom's Web Storage, on Node 22 (CI) and newer alike.
    execArgv: ['--no-experimental-webstorage'],
  },
});
