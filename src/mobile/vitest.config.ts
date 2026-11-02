import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  // DOM-based component checks use the workspace renderer and the same React instance.
  resolve: {
    alias: { react: fileURLToPath(new URL('../../node_modules/react', import.meta.url)) },
  },
  test: {
    environment: 'node',
    setupFiles: ['src/__tests__/setup.ts'],
    include: ['../../tests/mobile/ocr/**/*.test.{ts,tsx}', 'src/__tests__/**/*.test.{ts,tsx}'],
  },
});
