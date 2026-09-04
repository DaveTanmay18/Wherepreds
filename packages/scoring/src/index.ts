/**
 * @wp/scoring — the rule DSL, presets and (from Phase 3) the interpreter.
 *
 * ⚠️ This package is PURE: no database, no I/O, no clock. It is importable by
 * both the API (for /rules/simulate previews) and the worker (for real scoring
 * runs), and unit-testable with zero infrastructure. An `import` of @wp/db
 * here is an ESLint error, not a style preference — see eslint.config.mjs.
 */
export * from './dsl.js';
export * from './facts.js';
export * from './evaluate.js';
export * from './presets.js';
