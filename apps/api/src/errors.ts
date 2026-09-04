/**
 * RFC 9457 problem details (architecture.md §12.3).
 *
 * Every error the API emits has a stable `type` URI, so the client can branch
 * on the machine-readable value rather than string-matching a message. The
 * per-item `errors[]` array is what lets the bulk prediction upsert report
 * partial success — one late kickoff must not discard nine valid picks.
 */

export const ERROR_BASE = 'https://wherepreds.app/errors';

export type ProblemItem = {
  code: string;
  detail?: string;
  [key: string]: unknown;
};

export type ProblemDetails = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: ProblemItem[];
};

export class AppError extends Error {
  readonly status: number;
  readonly type: string;
  readonly title: string;
  readonly items: ProblemItem[] | undefined;

  constructor(opts: {
    status: number;
    /** kebab-case slug, appended to ERROR_BASE */
    type: string;
    title: string;
    detail?: string;
    items?: ProblemItem[];
  }) {
    super(opts.detail ?? opts.title);
    this.name = 'AppError';
    this.status = opts.status;
    this.type = `${ERROR_BASE}/${opts.type}`;
    this.title = opts.title;
    this.items = opts.items;
  }

  toProblem(instance?: string): ProblemDetails {
    return {
      type: this.type,
      title: this.title,
      status: this.status,
      ...(this.message && this.message !== this.title ? { detail: this.message } : {}),
      ...(instance ? { instance } : {}),
      ...(this.items?.length ? { errors: this.items } : {}),
    };
  }
}

export const badRequest = (detail: string, items?: ProblemItem[]) =>
  new AppError({ status: 400, type: 'bad-request', title: 'Bad request', detail, items });

export const unauthorized = (detail = 'You must be signed in.') =>
  new AppError({ status: 401, type: 'unauthorized', title: 'Not signed in', detail });

export const forbidden = (detail = 'You do not have permission to do that.') =>
  new AppError({ status: 403, type: 'forbidden', title: 'Forbidden', detail });

export const notFound = (detail = 'Not found.') =>
  new AppError({ status: 404, type: 'not-found', title: 'Not found', detail });

export const conflict = (type: string, title: string, detail: string, items?: ProblemItem[]) =>
  new AppError({ status: 409, type, title, detail, items });

export const unprocessable = (detail: string, items: ProblemItem[]) =>
  new AppError({
    status: 422,
    type: 'validation-failed',
    title: 'Validation failed',
    detail,
    items,
  });

export const tooManyRequests = (detail = 'Too many requests. Slow down.') =>
  new AppError({ status: 429, type: 'rate-limited', title: 'Rate limited', detail });

/**
 * The deadline error gets its own constructor because it is the one users
 * actually hit, and its wording matters: it must say when the deadline was,
 * not merely that one existed.
 */
export const deadlinePassed = (roundName: string, closedAt: Date, items?: ProblemItem[]) =>
  new AppError({
    status: 409,
    type: 'deadline-passed',
    title: 'Deadline passed',
    detail: `Predictions for ${roundName} closed at ${closedAt.toISOString()}.`,
    items,
  });
