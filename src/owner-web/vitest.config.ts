import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    env: { VITE_API_MODE: 'api' },
    environment: 'jsdom',
    include: ['src/**/*.test.tsx'],
    setupFiles: ['../../tests/frontend/setup.ts'],
  },
});
