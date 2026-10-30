import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { environment: 'node', include: ['../../tests/mobile/ocr/**/*.test.ts'] },
});
