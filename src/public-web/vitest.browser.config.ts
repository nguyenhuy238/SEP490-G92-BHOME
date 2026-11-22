import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.browser.test.ts'],
    maxWorkers: 1,
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
