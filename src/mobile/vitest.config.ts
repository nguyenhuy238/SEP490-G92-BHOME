import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  // DOM-based component checks use the workspace renderer and the same React instance.
  resolve: {
    alias: { react: fileURLToPath(new URL('../../node_modules/react', import.meta.url)) },
  },
  test: { environment: 'node', include: ['../../tests/mobile/ocr/**/*.test.{ts,tsx}'] },
});
