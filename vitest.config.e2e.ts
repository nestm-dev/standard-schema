import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    clearMocks: true,
    restoreMocks: true,
    hookTimeout: 10_000,
    testTimeout: 10_000,
  },
});
