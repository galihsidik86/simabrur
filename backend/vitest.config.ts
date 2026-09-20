import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
    // Item 6 (flaky test): resetTestDb (rollback+migrate+seed) di tiap beforeAll
    // mendekati 30s saat CPU padat — terbukti gagal sekali di run konduktor. 90s
    // memberi margin tanpa menyembunyikan hang sungguhan (masih jauh di bawah tak-terbatas).
    hookTimeout: 90000,
    testTimeout: 15000
  }
});
