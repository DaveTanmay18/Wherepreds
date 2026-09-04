import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    /**
     * These tests talk to a real Neon database over the internet — that is
     * deliberate (§17.2): triggers, partial indexes and cascade behaviour
     * cannot be exercised against a mock.
     *
     * A single round-trip costs 1.5–4s from a developer machine, so Vitest's
     * 5s default fails tests that are working perfectly. The symptom is
     * misleading too: a timed-out setup leaves later tests asserting against
     * empty variables, which surfaces as a confusing 404 rather than a timeout.
     */
    testTimeout: 30_000,
    hookTimeout: 120_000,

    /**
     * Test files share one database, so they must not run at the same time —
     * one file's cleanup would otherwise delete rows another file is midway
     * through using. CI gets a fresh Neon branch per run (P0-24), but the
     * branch is still shared across files within that run.
     */
    fileParallelism: false,
  },
});
