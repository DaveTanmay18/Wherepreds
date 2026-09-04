/** Mirror of the API's RFC 9457 shape (architecture.md §12.3). */
export type ProblemItem = { code: string; detail?: string; [k: string]: unknown };

export type ProblemDetails = {
  type: string;
  title: string;
  status: number;
  detail?: string;
  instance?: string;
  errors?: ProblemItem[];
};
