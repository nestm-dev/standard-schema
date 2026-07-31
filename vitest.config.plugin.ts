import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    root: './',
    include: ['test/compiler/**/*.spec.ts'],
    clearMocks: true,
    restoreMocks: true,
    hookTimeout: 20_000,
    testTimeout: 20_000,
  },
});
