# Deployment — test environment

How to get WherePreds onto a public URL for testing. Production hardening is
Phase 7; this is deliberately the smallest thing that works.

---

## Why the API is proxied rather than hosted separately

The web client calls a **relative** path — `const BASE = '/api/v1'` in
`apps/web/src/lib/api.ts` — and the session cookie is `sameSite: 'lax'`
(`apps/api/src/lib/session.ts`). Both assume the browser sees the web app and
the API on **one origin**.

⚠️ `vercel.app` is on the Public Suffix List, so `app.vercel.app` and
`api.vercel.app` are treated as _cross-site_, not sibling subdomains. Hosting
the API on its own Vercel domain would put the session cookie in third-party
territory, where Safari and Firefox drop it outright — you would be logged out
on an iPhone and unable to explain why.

So `vercel.json` **rewrites** `/api/*` to the API host. Vercel proxies it
server-side; the browser only ever talks to one origin. The cookie stays
first-party, `SameSite=Lax` is satisfied, and no auth code changes.

This works because `ipHash` in `session.ts` is _recorded but never validated_ on
read. If session validation is ever tightened to compare IPs, a proxy in front
of it would break every session, because the API would see Vercel's egress IP
rather than the user's — and that IP is not stable.

---

## Topology

| Piece         | Where                     | Why                                                                                                                                  |
| ------------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/web`    | Vercel (static)           | It is a Vite SPA; nothing else needed                                                                                                |
| `apps/api`    | Render / Railway / Fly    | Express 5 + Prisma; a normal long-lived Node process                                                                                 |
| `apps/worker` | **Your machine, for now** | BullMQ needs a 24/7 process _and_ Redis. Render bills background workers; for testing, run it locally against the same Neon database |
| Postgres      | Neon                      | Already hosted                                                                                                                       |
| Redis         | Optional for the API      | It is a cache only and degrades to Postgres. **Required** by the worker                                                              |

⚠️ The worker is not decoration. It locks rounds, ingests results and scores
predictions. With nothing running it, the site renders but no round ever closes
and no points are ever awarded. For a test session, run it locally when you
want something to happen:

```bash
pnpm --filter @wp/worker start     # needs a local Redis
pnpm ingest <job>                  # or drive one job at a time via the CLI
```

---

## Steps

### 1. Deploy the API first

You need its URL before Vercel can proxy to it.

**Render → New → Web Service**, pointed at this repo.

| Setting       | Value                                                                                          |
| ------------- | ---------------------------------------------------------------------------------------------- |
| Runtime       | Node                                                                                           |
| Build command | `corepack enable && pnpm install --frozen-lockfile --no-prod && pnpm --filter @wp/db generate` |
| Start command | `pnpm --filter @wp/api start`                                                                  |
| Instance type | Free is fine (it sleeps after ~15 min idle; the first request then takes ~1 min)               |

Two flags in that command are load-bearing, and both fail _silently at build
time_ and loudly at boot:

- **`--no-prod`** — `NODE_ENV=production` is set on the service, and pnpm
  honours it with a production-only install. That strips `tsx`, which is
  exactly what `pnpm --filter @wp/api start` runs the server with
  (`node --import tsx src/index.ts`). Without the flag: green build, then
  `Cannot find module 'tsx'`.
- **`prisma generate`** — the client is generated into `node_modules`, so
  without it the API starts happily and throws on its very first query.

A tidier long-term fix for the first one is to move `tsx` out of
`devDependencies` in `apps/api/package.json`, since it genuinely is a runtime
dependency for this start command. `--no-prod` keeps the local setup
untouched, at the cost of installing eslint and vitest on the server too.

⚠️ Pin the Node version with a **`NODE_VERSION` environment variable**, not
`.node-version`. `engines.node: ">=22"` in the root `package.json` is a
_floor_, not a pin, and Render resolves it to the newest release it has — it
picked **26.8.1**, several majors ahead of the 24.x this is developed against.
`NODE_VERSION` takes precedence over both.

The API binds `$PORT` when the platform sets one, falling back to `API_PORT`
locally, so no port configuration is needed.

Environment variables:

| Var              | Value                                                                              |
| ---------------- | ---------------------------------------------------------------------------------- |
| `DATABASE_URL`   | Neon **pooled** endpoint (`-pooler`)                                               |
| `DIRECT_URL`     | Neon direct endpoint                                                               |
| `SESSION_SECRET` | 32+ random bytes — `node -e "console.log(crypto.randomBytes(32).toString('hex'))"` |
| `NODE_ENV`       | `production` — this is what flips the session cookie to `Secure`                   |
| `API_BASE_URL`   | the Render URL                                                                     |
| `WEB_BASE_URL`   | your Vercel URL (fill in after step 3, then redeploy)                              |
| `LOG_LEVEL`      | `info`                                                                             |

`REDIS_URL` is optional here — leave it unset and the API logs one warning and
reads sessions from Postgres.

### 2. Run the migrations

From your machine, against the direct endpoint. Do **not** put this in the
build: a migration that fails midway through a deploy is a bad place to be.

```bash
pnpm db:deploy
```

⚠️ `prisma migrate dev` hangs on Neon (it cannot create a shadow database).
Always `migrate deploy`.

### 3. Deploy the web app

Put the Render hostname from step 1 into the rewrite. The live deployment uses
Root Directory `apps/web`, so `apps/web/vercel.json` is the file that governs;
the root one is kept in sync so a change of Root Directory does not silently
break the proxy.

⚠️ **There are two `vercel.json` files, and which one applies depends entirely
on the project's Root Directory setting.** Vercel reads the one _inside_ the
Root Directory and ignores the other completely:

| Root Directory    | File used              | How the build is configured                                               |
| ----------------- | ---------------------- | ------------------------------------------------------------------------- |
| repo root (blank) | `vercel.json`          | Explicit: build command, output `apps/web/dist`, install with `--no-prod` |
| `apps/web`        | `apps/web/vercel.json` | Vercel's own Vite preset detects everything; output is `dist`             |

Both are committed so either setting works. **Keep the API host in the rewrite
in sync across both files** — editing only one is the obvious way to lose an
afternoon.

The symptom of a mismatch is
`No Output Directory named "dist" found after the Build completed`: Root
Directory was `apps/web`, so the root `vercel.json` naming `apps/web/dist` was
never read, and Vercel fell back to the Vite default of `dist`.

The `apps/web` layout has one incidental advantage: Vercel's own install step
handles devDependencies correctly, so the `--no-prod` workaround is not needed
there.

No environment variables are needed on Vercel. The web app has no
`import.meta.env` usage at all; everything reaches it through the proxy.

⚠️ The install command carries `--no-prod` for the same reason Render's does.
Vercel sets `NODE_ENV=production` during a build, and pnpm honours that with a
prod-only install — which would strip `vite`, `typescript` and
`@vitejs/plugin-react`, every one of which is a devDependency of `@wp/web` and
required to build it. The failure reads `vite: not found`, which points at the
wrong thing entirely.

### 4. Close the loop

Set `WEB_BASE_URL` on Render to the Vercel URL and redeploy the API, so the
CORS origin matches. (Requests arrive same-origin through the proxy, so this is
belt-and-braces rather than load-bearing.)

### 5. Check it

```
https://<your-app>.vercel.app/api/v1/health
```

Expect `{"status":"ok","checks":{"db":"ok","redis":"not-configured"}}`. If `db`
is anything else, the Neon URL or the migration is the problem — not Vercel.

Then register an account and confirm the session survives a page reload. That
single check exercises the whole proxy-plus-cookie path.

---

## Known limits of this setup

- **Free-tier sleep.** The first request after idle takes ~1 minute on Render's
  free tier. Nothing is wrong; it is booting.
- **No worker means no scoring.** See the table above.
- **No Redis means slower session reads**, one Postgres query per request
  rather than a cache hit. Fine at test scale.
- **The free football-data.org token allows 10 calls/minute.** A full ingest of
  six competitions takes minutes and must not be run in a request handler.
