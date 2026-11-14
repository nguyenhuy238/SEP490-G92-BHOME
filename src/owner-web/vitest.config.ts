import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // Bound concurrent jsdom/MUI suites to the capacity of the CI runner.
    maxWorkers: 2,
    // Multi-step MUI forms perform many accessibility-tree scans in jsdom.
    // Allow slower runners without weakening any assertion or polling timeout.
    testTimeout: 15000,
    env: { VITE_API_MODE: 'api' },
    environment: 'jsdom',
    include: ['src/**/*.test.tsx'],
    setupFiles: ['../../tests/frontend/setup.ts'],
  },
});
