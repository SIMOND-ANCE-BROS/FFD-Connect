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
    // Every page test renders Mantine in jsdom and replays user input: pure
    // CPU, up to ~1.5 s per test when the file runs alone. Vitest's default
    // (one worker per logical core but one) plus anything else running on the
    // machine (backend/client suites, other worktree sessions) slowed those
    // tests 5-20x, past the 5 s default budget: tests failed in the full suite
    // and passed alone (#546). Half the cores, as the backend Jest config,
    // cut the timeouts and the wall time of the suite on a 6-core machine;
    // the budget matches the client's (jest.polyfills.js). Measured on #546.
    maxWorkers: '50%',
    testTimeout: 15_000,
    // Node >= 25 ships a native, flag-gated localStorage global that shadows
    // jsdom's (it is undefined without --localstorage-file). Turn it off so
    // tests always see jsdom's Web Storage, on Node 22 (CI) and newer alike.
    execArgv: ['--no-experimental-webstorage'],
  },
});
