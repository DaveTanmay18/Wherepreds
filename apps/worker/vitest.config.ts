import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Real Neon round-trips cost 1.5-4s each; the 5s default fails working
    // code and reports it misleadingly (see apps/api/vitest.config.ts).
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
