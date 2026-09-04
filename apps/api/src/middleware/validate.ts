import type { RequestHandler } from 'express';
import type { ZodTypeAny, z } from 'zod';
import { unprocessable } from '../errors.js';

/**
 * Request validation (task P0-17). Schemas live in @wp/shared so the frontend
 * builds requests against the same definition the server enforces — validated
 * once, inferred everywhere (§3).
 *
 * Parsed output replaces the raw input, so handlers receive coerced, trimmed,
 * defaulted values rather than whatever arrived on the wire.
 */
export type ValidationSchemas = {
  params?: ZodTypeAny;
  query?: ZodTypeAny;
  body?: ZodTypeAny;
};

export type Validated<S extends ValidationSchemas> = {
  params: S['params'] extends ZodTypeAny ? z.infer<S['params']> : unknown;
  query: S['query'] extends ZodTypeAny ? z.infer<S['query']> : unknown;
  body: S['body'] extends ZodTypeAny ? z.infer<S['body']> : unknown;
};

export function validate(schemas: ValidationSchemas): RequestHandler {
  return (req, _res, next) => {
    const issues: { code: string; field: string; detail: string; in: string }[] = [];

    for (const source of ['params', 'query', 'body'] as const) {
      const schema = schemas[source];
      if (!schema) continue;

      const result = schema.safeParse(req[source]);
      if (result.success) {
        // Express 5 makes req.query a getter, so assign through defineProperty.
        Object.defineProperty(req, source, {
          value: result.data,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      } else {
        for (const i of result.error.issues) {
          issues.push({
            code: i.code,
            field: i.path.join('.') || '(root)',
            detail: i.message,
            in: source,
          });
        }
      }
    }

    if (issues.length) {
      // Report every problem at once. Fixing a form one round-trip per field
      // is miserable, and the client can highlight all offending inputs.
      return next(unprocessable('Request validation failed.', issues));
    }
    next();
  };
}
