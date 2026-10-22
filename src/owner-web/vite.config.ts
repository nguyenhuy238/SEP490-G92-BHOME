import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { getApiBaseUrl } from '../../packages/client-core/src/config';

export default defineConfig(({ command, mode }) => {
  if (command === 'build') {
    getApiBaseUrl(
      process.env.VITE_API_BASE_URL || loadEnv(mode, process.cwd(), 'VITE_').VITE_API_BASE_URL,
      false,
    );
  }
  return {
    plugins: [react()],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: { port: 5173, strictPort: true },
    test: {
      environment: 'jsdom',
      globals: true,
      include: ['../../tests/owner-web/**/*.test.{ts,tsx}'],
      setupFiles: ['../../tests/frontend/setup.ts'],
      restoreMocks: true,
    },
  };
});
