import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
    hookTimeout: 30000,
    testTimeout: 15000
  }
});
