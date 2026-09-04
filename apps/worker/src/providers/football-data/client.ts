import type { Logger } from '../../logger.js';

/**
 * HTTP transport for football-data.org v4, with a rate limiter driven by the
 * response headers rather than by guesswork (task P1-03).
 *
 * The limit is per MINUTE, not per month. Unlike a monthly quota it fails
 * immediately and during exactly the window that matters most — a Saturday
 * afternoon with ten matches live — so the limiter is not optional.
 */

export class ProviderHttpError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: unknown,
  ) {
    super(`football-data.org ${status} on ${path}: ${JSON.stringify(body)?.slice(0, 200)}`);
    this.name = 'ProviderHttpError';
  }
}

export type ClientOptions = {
  baseUrl: string;
  token: string;
  /** Calls per minute allowed by the purchased plan. */
  rateLimitPerMin: number;
  log: Logger;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class FootballDataClient {
  private readonly minIntervalMs: number;
  private queue: Promise<unknown> = Promise.resolve();
  private lastCallAt = 0;
  /** Most recent value of X-Requests-Available-Minute, for observability. */
  remaining: number | null = null;

  constructor(private readonly opts: ClientOptions) {
    // A simple spacing limiter beats a bucket here: requests are issued by a
    // small number of sequential jobs, and even spacing avoids the burst that
    // would otherwise trip a 429 on the first call of every minute.
    this.minIntervalMs = Math.ceil(60_000 / Math.max(1, opts.rateLimitPerMin));
  }

  /** Serialised so concurrent jobs cannot collectively exceed the ceiling. */
  private schedule<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const wait = this.lastCallAt + this.minIntervalMs - Date.now();
      if (wait > 0) await sleep(wait);
      this.lastCallAt = Date.now();
      return fn();
    });
    // Keep the chain alive even when a call rejects.
    this.queue = run.catch(() => undefined);
    return run;
  }

  async get<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(`${this.opts.baseUrl}${path}`);
    for (const [k, v] of Object.entries(params ?? {})) {
      if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
    }
    return this.schedule(() => this.execute<T>(url, path, 0));
  }

  private async execute<T>(url: URL, path: string, attempt: number): Promise<T> {
    const res = await fetch(url, { headers: { 'X-Auth-Token': this.opts.token } });

    const remaining = res.headers.get('x-requests-available-minute');
    if (remaining !== null) this.remaining = Number(remaining);

    if (res.status === 429) {
      // Honour the provider's own reset window. Backing off on a guess either
      // wastes time or trips the limit again immediately.
      const reset = Number(res.headers.get('x-requestcounter-reset') ?? '60');
      if (attempt >= 3) throw new ProviderHttpError(429, path, await res.text());
      this.opts.log.warn({ path, resetSeconds: reset }, 'rate limited — waiting for reset');
      await sleep((reset + 1) * 1000);
      return this.execute<T>(url, path, attempt + 1);
    }

    if (res.status >= 500 && attempt < 2) {
      await sleep(1000 * (attempt + 1));
      return this.execute<T>(url, path, attempt + 1);
    }

    if (!res.ok) {
      const body = await res.json().catch(() => res.statusText);
      throw new ProviderHttpError(res.status, path, body);
    }

    return (await res.json()) as T;
  }
}
