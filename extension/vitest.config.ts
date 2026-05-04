import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@aturi': path.resolve(__dirname, '../src/utils'),
      '#imports': path.resolve(__dirname, 'lib/__tests__/imports-stub.ts'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['lib/**/*.test.ts', 'lib/**/__tests__/*.test.ts'],
    exclude: ['lib/__tests__/imports-stub.ts'],
  },
});
