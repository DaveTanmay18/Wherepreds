import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';
import { AppError, notFound, type ProblemDetails } from '../errors.js';
import { logger } from '../logger.js';

/** 404 for anything the router did not match. */
export const notFoundHandler: RequestHandler = (req, _res, next) => {
  next(notFound(`No route for ${req.method} ${req.path}.`));
};

/**
 * Terminal error handler. Emits RFC 9457 problem details with the
 * `application/problem+json` content type (§12.3).
 *
 * Express 5 forwards rejected promises from async handlers here automatically,
 * so route code does not need try/catch just to report failures.
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const instance = req.originalUrl;

  let problem: ProblemDetails;

  if (err instanceof AppError) {
    problem = err.toProblem(instance);
  } else if (err instanceof ZodError) {
    problem = {
      type: 'https://wherepreds.app/errors/validation-failed',
      title: 'Validation failed',
      status: 422,
      detail: 'The request body did not match the expected shape.',
      instance,
      errors: err.issues.map((i) => ({
        code: i.code,
        field: i.path.join('.'),
        detail: i.message,
      })),
    };
  } else {
    // Unexpected. Log the real thing, tell the client nothing — an internal
    // error message is an information leak, and it is never actionable.
    problem = {
      type: 'https://wherepreds.app/errors/internal',
      title: 'Something went wrong',
      status: 500,
      instance,
    };
  }

  const log = req.log ?? logger;
  if (problem.status >= 500) {
    log.error({ err, problem }, 'request failed');
  } else {
    log.warn(
      { problem, msg: err instanceof Error ? err.message : String(err) },
      'request rejected',
    );
  }

  res.status(problem.status).type('application/problem+json').json(problem);
};
