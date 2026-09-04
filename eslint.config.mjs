import base from './packages/config/eslint.base.mjs';

/**
 * Dependency rule from docs/architecture.md §4:
 *
 *   web     → shared
 *   api     → shared, db, scoring
 *   worker  → shared, db, scoring
 *   scoring → shared            ← and NOTHING else
 *
 * `packages/scoring` importing `packages/db` is the single most likely
 * architectural regression in this project: the engine stops being unit-
 * testable with zero infrastructure the moment it happens, and the golden-file
 * and property-based test strategy (§17.2) goes with it. These are errors, not
 * warnings, and CI fails on them.
 *
 * Implemented with `no-restricted-imports` rather than `import/no-restricted-
 * paths` because workspace imports are package specifiers (`@wp/db`), not
 * relative paths — matching on the specifier is exact, whereas path matching
 * depends on how pnpm happens to symlink node_modules.
 */
const deny = (patterns) => ({
  'no-restricted-imports': ['error', { patterns }],
});

export default [
  ...base,

  {
    name: 'boundary/scoring-is-pure',
    files: ['packages/scoring/**/*.{ts,tsx}'],
    rules: deny([
      {
        group: ['@wp/db', '@wp/db/*', '@prisma/client', '.prisma/*'],
        message:
          'packages/scoring must stay PURE — no database, no I/O. If the engine needs data, pass it in as an argument. See architecture.md §4 and §8.',
      },
      {
        group: ['@wp/api', '@wp/web', '@wp/worker'],
        message: 'packages/scoring may only depend on @wp/shared.',
      },
      {
        group: ['node:fs', 'node:fs/*', 'node:http', 'node:https', 'node:net', 'fs', 'http', 'https'],
        message:
          'packages/scoring must stay free of I/O so it is deterministic and unit-testable with zero infrastructure.',
      },
    ]),
  },

  {
    name: 'boundary/web-server-state-only',
    files: ['apps/web/**/*.{ts,tsx}'],
    rules: deny([
      {
        group: ['@wp/db', '@wp/db/*', '@prisma/client', '.prisma/*'],
        message:
          'The browser must never import the database client. Go through the API. See architecture.md §4.',
      },
      {
        group: ['@wp/scoring', '@wp/scoring/*'],
        message:
          'The web app does not score anything. Scoring previews come from POST /rules/simulate (§12.1).',
      },
    ]),
  },

  {
    name: 'boundary/shared-is-leaf',
    files: ['packages/shared/**/*.{ts,tsx}'],
    rules: deny([
      {
        group: ['@wp/db', '@wp/db/*', '@wp/scoring', '@wp/scoring/*', '@prisma/client'],
        message:
          '@wp/shared is a leaf package — it is imported by everything and must import nothing from the workspace.',
      },
    ]),
  },

  {
    name: 'boundary/never-read-score-fulltime',
    files: ['apps/worker/**/*.{ts,tsx}', 'packages/scoring/**/*.{ts,tsx}'],
    rules: {
      /**
       * football-data.org's `score.fullTime` is regularTime + extraTime +
       * penalties summed. On a shootout it reports a scoreline that never
       * happened (Liverpool 1-5 PSG, actually 0-1). Verified live 2026-08-18.
       * Only the provider mapper may touch it. See architecture.md §11.1 and
       * task P1-04b.
       */
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name='fullTime']",
          message:
            'score.fullTime is regularTime+extraTime+penalties summed — a scoreline that never happened. Use score.regularTime for the 90-minute score. See architecture.md §11.1 (P1-04b). Only apps/worker/src/providers/ may read it.',
        },
      ],
    },
  },
  {
    name: 'boundary/never-read-score-fulltime-exception',
    files: ['apps/worker/src/providers/**/*.{ts,tsx}'],
    rules: { 'no-restricted-syntax': 'off' },
  },

  {
    name: 'scripts-are-plain-node',
    files: ['scripts/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
];
