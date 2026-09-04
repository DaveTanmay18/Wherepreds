# WherePreds — Implementation Tasks

Derived from [architecture.md](architecture.md). Every task cites the section it comes from, so when a task and the architecture disagree, the architecture wins — fix the task.

| | |
|---|---|
| **Status** | P0 23/24 · P1 24/32 · **P2 18/18** · **P3 30/30** · **P4 16/16** · P1b 11/14 · **P4b 11/11 complete** |
| **Phases** | 0 → 7, following §19 |
| **Last updated** | 2026-08-18 |

---

## How to use this file

- **IDs are permanent.** `P3-14` stays `P3-14` even if it moves. Commit messages and branches reference them: `git checkout -b P3-14-scoring-worker`.
- **Tick as you go.** `- [ ]` → `- [x]`. A task is done when its *Done when* line is true, not when the code compiles.
- **Deps are hard.** If a task lists `Deps: P0-05`, do not start it until that box is ticked. Where no deps are listed, the task only needs its phase's predecessors.
- **⚠️ marks a task with a known trap.** Read the note before starting.
- **🔒 marks a blocked task** — it needs a decision from §20 first. See [Decisions needed](#decisions-needed-before-coding).

**Two dependencies run backwards across phases**, and they are deliberate rather than mistakes:

- `P5-13` (live fixture channel) needs `P6-03` (WebSocket gateway), and `P5-12` (Web Push) needs `P6-01` (PWA manifest) because iOS only permits push from an installed PWA.

So either pull `P6-01` and `P6-03` forward into Phase 5, or accept that the match centre ships without live updates and push arrives in Phase 6. Pulling them forward is the better call — they are small, and the match centre is most of the point of Phase 5.

### Progress

| Phase | Tasks | Done | Exit criterion (§19) |
|---|---:|---:|---|
| [0 — Foundations](#phase-0--foundations) | 24 | **23** | Register, log in, see an empty dashboard |
| [1 — Football data](#phase-1--football-data) | 32 | **24** | EPL table, fixtures, squads, derived player stats render from our own DB |
| [1b — Champions League](#phase-1b--champions-league) | 14 | **11** | UCL league-phase table + knockout bracket render, incl. a two-legged tie |
| [2 — Leagues](#phase-2--leagues) | 18 | **18** ✅ | Two users create and join a league using a preset |
| [3 — Predict \& score](#phase-3--predict--score) | 30 | **30** ✅ | A full gameweek predicted, locked, scored, ranked correctly |
| [4 — Custom rules](#phase-4--custom-rules) | 16 | **16** ✅ | An admin builds a bespoke rule set and previews it before committing |
| [4b — Knockout markets](#phase-4b--knockout-markets) | 11 | **11** ✅ | A tie decided on penalties scores correctly under all three score bases |
| [5 — Boosters & social](#phase-5--boosters--social) | 17 | 0 | A season played end to end; members watch a live match on the picks tab |
| [6 — Polish](#phase-6--polish) | 18 | 0 | Lighthouse ≥ 95 across the board on mobile |
| [7 — Scale](#phase-7--scale) | 13 | 0 | 1,000 concurrent predictors in the 30 min before a Saturday 15:00 deadline |
| **Total** | **193** | **132** | |

Plus 7 decisions (3 resolved) and 5 ongoing rules.

---

## Decisions needed before coding

These block real work. Each maps to §20.

> **Status (2026-08-18):** a free-tier key was smoke-tested against the live API. **D-01a, D-02 and D-03 are answered** and written into the architecture. Only the purchase remains, and it is the sole thing blocking Phase 1.

- [x] **D-01a · Verify competition coverage and codes.** *(done)*
  All six resolve live: `PL` 2021, `PD` 2014, `SA` 2019, `BL1` 2002, `FL1` 2015, `CL` 2001 — all on the Free 12-competition tier, so every paid tier includes them. Coverage is not what we are paying for; live scores and Deep Data are.

- [x] **D-01b · Choose a starting plan.** *(done)* → **Free tier for now.**
  Delayed scores accepted. Phases 0–3 need nothing more: exact score, 1X2, BTTS, totals, margin, half-time, clean sheet and `TO_QUALIFY` are all scoreable on free-tier data.

- [ ] **D-01c · Upgrade to Deep Data (€29/mo) before real users.** Blocks four markets, not the build.
  Verified live: free-tier `goals[]` is **empty even on a match that had a goal**, and the ceiling is 10 calls/min. Until upgraded, `FIRST_GOALSCORER`, `ANYTIME_GOALSCORER` and `RED_CARD_SHOWN` join corners as gated off (`P4-01a` handles this automatically), and `P1-13a` has nothing to derive from.
  Upgrading is a token swap plus `FOOTBALL_CAP_DEEP_DATA=true` — no schema or code change.
  *Done when:* `scripts/smoke-football-data.mjs` passes its `D-01/goals` check.

- [x] **D-02 · UCL league-phase `stage` value.** *(done)* → **`LEAGUE_STAGE`**
  144 matches in the 2024/25 UCL, and **absent from the published enum**. Full mapping now in §6 `RoundType`: `PLAYOFFS`→`KNOCKOUT_PLAYOFF` (16), `LAST_16` (16), `QUARTER_FINALS` (8), `SEMI_FINALS` (4), `FINAL` (1) — every knockout count is exactly `ties × 2 legs`, which independently confirms the `Tie` model.

- [x] **D-03 · Extra-time score semantics.** *(done)* → **resolved favourably, with a trap found**
  `score` carries `regularTime`, `extraTime` and `penalties` as separate sub-objects (undocumented). All three knockout bases read straight off stored columns — no reconstruction, and **no dependency on Deep Data**.
  ⚠️ But `score.fullTime` is those three **summed**: Liverpool v PSG reports `1-5`, a scoreline that never happened. See `P1-04b`.

- [ ] **D-04 · Confirm UCL league-phase table ordering.** Blocks `P1b-09`.
  Recommendation in §20: trust the provider's `position`, compute everything else ourselves, alert on disagreement.

- [ ] **D-05 · Confirm the v1 competition list.** Top 5 + UCL is assumed throughout. If Europa League is wanted at launch, say so now — it is cheap during Phase 1b and expensive after. Note it would need a plan with more than 12 competitions.

- [ ] **D-06 · Confirm hosting targets.** §18 assumes Vercel (web) + Fly.io/Render (api, worker) + Neon + Upstash. Any change here alters `P0-06` and `P0-24`.

**Accepted losses** (§11.5) — no action needed, recorded so nobody rediscovers them mid-build:

- **No match statistics in v1** (add-on deliberately skipped). `TOTAL_CORNERS_OVER_UNDER` is gated off; `TeamMatchStat` holds card counts only. Reversible for €15/mo plus a config flag — `P1-13c` ships the ingest path inert so that stays true.
- **No xG anywhere**, and **no per-player match statistics** beyond goals, assists, cards and minutes, all of which we derive ourselves from match events. Not purchasable; would need a different provider.

Everything else survives: every market except corners is scoreable, and league tables, club records, form and per-player goals/assists are all computed from data we do have.

Non-blocking, revisit at the phase noted: half-season leagues (Phase 2), multi-competition leagues (post-v1), head-to-head format (post-v1), push notification strategy (Phase 5), `ExternalRef.payload` retention (Phase 7).

---

## Phase 0 — Foundations

> **Exit:** a user can register, log in, and see an empty dashboard.

### Repo and tooling

- [x] **P0-01 · Initialise the pnpm monorepo**
  Root `package.json`, `pnpm-workspace.yaml` covering `apps/*` and `packages/*`, Node 22 and pnpm pinned via `packageManager`.
  *Done when:* `pnpm -r exec tsc --version` succeeds from the root.

- [x] **P0-02 · `packages/config` — shared tsconfig, ESLint, Prettier**
  Base `tsconfig.json` with `strict: true`, `noUncheckedIndexedAccess`, ESLint flat config, Prettier.
  *Deps:* P0-01

- [x] **P0-03 · Enforce the dependency rule in ESLint** ⚠️
  `import/no-restricted-paths` per §4: `web → shared`; `api → shared, db, scoring`; `worker → shared, db, scoring`; `scoring → shared` **only**.
  ⚠️ `packages/scoring` importing `packages/db` is the single most likely architectural regression in this project — the engine stops being unit-testable the moment it happens. Make the lint rule an error, not a warning.
  *Deps:* P0-02 · *Done when:* a deliberate `import { prisma } from '@wp/db'` inside `packages/scoring` fails CI.

- [x] **P0-04 · `packages/shared` skeleton**
  Zod DTOs + inferred types, exported per domain (`auth`, `football`, `league`, `prediction`). Empty barrels are fine.
  *Deps:* P0-02

- [x] **P0-05 · Commit `.env.example` and wire env validation**
  All keys from Appendix B, validated at boot with Zod in each app. Fail fast on a missing key rather than at first use.
  *Deps:* P0-04

### Database

- [x] **P0-06 · Create the Neon project and branches**
  `main` (production), `staging`, `dev`. Record pooled `DATABASE_URL` and direct `DIRECT_URL` per §7.4.
  *Deps:* D-04

- [x] **P0-07 · `packages/db` — Prisma init**
  `schema.prisma` with the generator and datasource block from §6, including `directUrl`. Export a singleton client from `src/index.ts` with dev hot-reload guarding.
  *Deps:* P0-06

- [x] **P0-08 · Schema: all enums**
  Every enum in §6, including `RoundType`, `TieDecider`, `KnockoutScoreBasis`, and `MarketType.TO_QUALIFY`. Do these first — the models won't compile without them.
  *Deps:* P0-07

- [x] **P0-09 · Schema: football context**
  `Country`, `Competition`, `Season`, `Round`, `Tie`, `Venue`, `Team`, `TeamSeason`, `Player`, `PlayerRegistration`, `Fixture`, `FixtureEvent`, `TeamMatchStat`, `PlayerMatchStat`, `PlayerSeasonStat`, `TeamSeasonStat`, `StandingRow`, `ExternalRef`, `IngestJob`.
  ⚠️ `Competition.countryId` is **nullable** (§5.2) — the UCL has no country.
  *Deps:* P0-08

- [x] **P0-10 · Schema: identity context**
  `User`, `AuthIdentity`, `Session`.
  *Deps:* P0-08

- [x] **P0-11 · Schema: prediction context**
  `PredictionLeague`, `RuleSet`, `LeagueMembership`, `LeagueInvite`, `LeagueRound`, `LeagueFixture`, `Prediction`, `PredictionSelection`, `BoosterUsage`.
  *Deps:* P0-09, P0-10

- [x] **P0-12 · Schema: scoring context and cross-cutting**
  `ScoringRun`, `PredictionScore`, `StandingEntry`, `Notification`, `AuditLog`.
  *Deps:* P0-11

- [x] **P0-13 · First migration + raw SQL block** ⚠️
  Run `prisma migrate dev`, then hand-edit the migration to append every statement in §7.2: `pg_trgm` + trigram indexes, the four partial unique indexes, the `guard_locked_prediction` trigger, and the two `CHECK` constraints on `ties` and `fixtures`.
  ⚠️ The locked-prediction trigger is the last line of defence on prediction integrity (§10.2). Do not defer it to "later" — later is after someone has already edited a locked pick.
  *Deps:* P0-12 · *Done when:* `prisma migrate reset` reproduces the full schema including the trigger, verified by an update against a locked row raising `check_violation`.

- [x] **P0-14 · Seed script — skeleton**
  `packages/db/prisma/seed.ts` creating countries, the six competitions (5 domestic + UCL), and one season each. Real data arrives in `P1-24`.
  *Deps:* P0-13

### API and worker scaffolds

- [x] **P0-15 · `apps/api` — Express 5 scaffold**
  App factory, `/api/v1` router mount, graceful shutdown, `GET /health` (DB + Redis ping).
  *Deps:* P0-05, P0-07

- [x] **P0-16 · API middleware stack**
  Request ID, `pino` structured logging with the ID attached, CORS, body limits, and the RFC 9457 error handler from §12.3 — including the per-item `errors[]` array.
  *Deps:* P0-15

- [x] **P0-17 · Zod request/response validation middleware**
  `validate({ params, query, body })`, sourcing schemas from `packages/shared`. Validation failures produce a 422 problem-details response.
  *Deps:* P0-16, P0-04

- [x] **P0-18 · `apps/worker` — BullMQ scaffold**
  Redis connection, the five queues from §16.1 with their concurrency and retry settings, a processor registry, and graceful shutdown that drains in-flight jobs.
  *Deps:* P0-05

- [x] **P0-19 · `apps/web` — Vite + React 19 scaffold**
  React Router v7 routes shell, TanStack Query provider, Tailwind v4, an API client that sends credentials and parses problem-details errors.
  *Deps:* P0-05

### Auth (§15)

- [x] **P0-20 · Session infrastructure**
  256-bit opaque tokens in `httpOnly; Secure; SameSite=Lax` cookies, 30-day expiry with sliding renewal after 24 h, Redis-first lookup falling back to Postgres.
  *Deps:* P0-16, P0-18 · *Done when:* deleting a `Session` row invalidates the next request immediately.

- [x] **P0-21 · Register / login / logout**
  Argon2id (m=19456, t=2, p=1). Email + username uniqueness. `GET /auth/session`.
  *Deps:* P0-20

- [ ] **P0-22 · OAuth — Google and Apple** 🔒 **needs credentials**
  Authorisation-code flow writing `AuthIdentity`. Link to an existing user when the verified email matches.
  ⚠️ Deliberately NOT written yet. No Google/Apple client credentials exist, so the flow could not be exercised — and unverified auth code is the last thing that should sit in a repo looking finished. The `AuthIdentity` model, the session layer and the env slots are all in place, so this is a contained addition once credentials exist.
  *Deps:* P0-21, credentials from the Google Cloud console and Apple Developer portal

- [x] **P0-23 · Web: auth screens + protected routes**
  Login, register, password reset request, and a route guard that redirects to `/login` preserving the intended destination.
  *Deps:* P0-19, P0-21

- [x] **P0-24 · CI pipeline**
  Typecheck, lint, unit tests, and `prisma migrate deploy` against an ephemeral **Neon branch** per PR (§18), torn down on merge.
  *Deps:* P0-13, P0-06

---

## Phase 1 — Football data

> **Exit:** live EPL table, fixtures, squads, and player stats render from our own database.
> **🔒 Entire phase blocked on D-01b** (a purchased token). Coverage is already verified — see D-01a.

### Provider layer (§11.1)

- [x] **P1-01 · Define the `FootballProvider` interface and `ProviderCapabilities`**
  Exactly as §11.1, in `apps/worker/src/providers/types.ts`, with `Raw*` types mirroring football-data.org v4 shapes.
  *Done when:* `capabilities` is a static descriptor the API can read without touching the network.

- [x] **P1-02 · football-data.org v4 adapter**
  Base `https://api.football-data.org/v4`, `X-Auth-Token` header. Implements every method. Typed responses, no mapping logic — raw shapes out. `scripts/smoke-football-data.mjs` is a working reference for the transport and header handling.
  *Deps:* P1-01, D-01b

- [x] **P1-03 · Rate limiter driven by response headers** ⚠️
  Token bucket sized from `FOOTBALL_RATE_LIMIT_PER_MIN`, shared across worker replicas via Redis. Read `X-Requests-Available-Minute` from every response and `X-RequestCounter-Reset` from a 429.
  ⚠️ The plan allows 30 calls/**minute**, not per month (§11.2). Blind retries on 429 will lock the whole ingest pipeline out for the remainder of the window — respect the reset header rather than backing off on a guess.
  *Deps:* P1-02

- [x] **P1-04a · Status and stage mapping, with strict enum validation** ⚠️
  Map the provider's nine statuses to `FixtureStatus` and `stage` to `RoundType`, both per §11.1 / §6. Infer `EXTRA_TIME` and `PENALTY_SHOOTOUT` from `score.duration`.
  ⚠️ **Every provider enum is validated against an explicit allow-list and throws on an unknown value.** Live verification found the published docs wrong on four counts — `winner` is `HOME_TEAM`/`AWAY_TEAM` not `HOME`/`AWAY`, `duration` includes `PENALTY_SHOOTOUT`, and `LEAGUE_STAGE` isn't in the documented enum at all. A permissive `default:` branch would have mapped the entire UCL league phase to `REGULAR_SEASON` and corrupted round ordering with no error anywhere.
  *Deps:* P1-02

- [x] **P1-04b · Never read `score.fullTime`** ⚠️ **highest-severity data trap in the project**
  Populate `Fixture.homeGoals`/`awayGoals` from **`score.regularTime`**; `homeGoalsEt`/`awayGoalsEt` from `score.extraTime`; `homePenalties`/`awayPenalties` from `score.penalties`. Do not store `fullTime` at all.
  ⚠️ `fullTime` = `regularTime + extraTime + penalties`. Liverpool v PSG (2024/25 R16) reports `1-5`; the match was `0-1`. Atlético v Real reports `3-4`; it was `1-0`. Reading `fullTime` would score exact-score predictions against scorelines that **never happened**, on the highest-profile matches of the season, and nothing would throw.
  *Deps:* P1-04a · *Done when:* an ingestion test asserts those two real matches store `0-1` and `1-0`, and a lint rule or code review forbids `fullTime` outside the mapper.

- [x] **P1-04 · `ExternalRef` resolver** ⚠️
  `resolveInternalId(provider, entity, externalId)` and `link(...)`, with upsert semantics.
  ⚠️ This is the only place a provider ID may appear. A provider ID leaking into any other table breaks the one-directory blast radius §11.1 promises.
  *Deps:* P0-13

- [x] **P1-05 · Mapper layer: raw → internal**
  One mapper per entity, resolving all identities through `P1-04`. No provider field names escape `apps/worker/src/providers/`.
  *Deps:* P1-04, P1-02

- [x] **P1-06 · `IngestJob` run recording**
  A wrapper that opens an `IngestJob` row, records `recordsRead`/`recordsWritten`, and closes it as `SUCCEEDED`/`FAILED`/`PARTIAL`.
  *Deps:* P0-13

### Ingestion jobs (§11.2)

- [x] **P1-07 · `ingest.competitions`** — weekly. Seeds/updates the six supported competitions from their codes (`PL, PD, SA, BL1, FL1, CL`).
  *Deps:* P1-05, P1-06

- [x] **P1-08 · `ingest.season-structure`** — daily 03:00 UTC. Teams, `TeamSeason`, rounds derived from `matchday`/`stage`, full match list per competition.
  *Deps:* P1-07, P1-04a

- [ ] **P1-09 · `ingest.squads`** — `getTeam` per club, staggered across the day to stay inside the rate budget. Writes `PlayerRegistration` with `joinedAt`/`leftAt` so mid-season transfers keep their history.
  *Deps:* P1-08

- [x] **P1-10 · `ingest.fixtures-upcoming`** — hourly, **one batched call** across all six competitions for the next 14 days. Catches kickoff changes and re-emits an event so `UPCOMING` deadlines can be recomputed (§10.1).
  *Deps:* P1-08

- [x] **P1-11 · `ingest.live` — demand-driven batched poller** ⚠️
  Every 60 s, only when a fixture is actually live. **One** call: `listMatches({ competitions: ALL_SIX, status: ['IN_PLAY','PAUSED'] })`. Updates score, minute, injury time, and events.
  ⚠️ Two separate mistakes to avoid (§11.2). Polling **per fixture** turns a ten-match Saturday into 10 calls/minute against a 30/minute ceiling; and an **unguarded** minute-cron burns the budget around the clock for nothing. One batched call behind a liveness guard is the whole design.
  *Deps:* P1-08 · *Done when:* ten simultaneous live matches cost exactly one call per minute.

- [x] **P1-12 · Result confirmation guard** ⚠️
  A fixture reaches `FINISHED` only after **two consecutive** terminal polls. Increment `resultVersion` and stamp `resultConfirmedAt` on the transition.
  ⚠️ Every downstream scoring decision keys off this. A premature full-time here becomes a wrong leaderboard everywhere.
  *Deps:* P1-11 · *Done when:* a single spurious terminal poll followed by an `IN_PLAY` poll leaves the fixture unfinished.

- [ ] **P1-13 · `ingest.match-detail`** — on `FINISHED`, then +15 min and +6 h. `getMatch` per fixture: lineups, formation, `goals[]`, `bookings[]`, `substitutions[]`, `penalties[]`, and the `statistics` block. Stats settle late; all three passes are needed.
  *Deps:* P1-12

- [ ] **P1-13a · Derive `PlayerMatchStat` from match events** ⚠️
  There are no per-player statistics from this provider (§11.5). Derive `started` and `minutesPlayed` from `lineup`/`bench` + `substitutions[]`; `goals`, `assists`, `penaltiesScored` from `goals[]`; cards from `bookings[]`.
  ⚠️ Leave every non-derivable column null — shots, passes, tackles, duels, ratings, xG. Do not fabricate a value or a zero for them; a null says "unknown", a zero says "he had no shots", and only one of those is true.
  *Deps:* P1-13

- [ ] **P1-13b · Derive team card counts into `TeamMatchStat`** — yellows and reds per side, summed from `bookings[]`. This is all the table holds in v1 (§11.5); the statistics block is not purchased.
  *Deps:* P1-13

- [ ] **P1-13c · Write the `statistics` block ingest path, inert** ⚠️
  Map corners, shots, shots on target, possession, fouls and offsides from `homeTeam`/`awayTeam.statistics`, behind `capabilities.teamStatistics`. Ships disabled.
  ⚠️ Small task, done now on purpose. Writing it while the mapper is fresh makes the €15 add-on a config flag later; retrofitting it in six months means relearning the whole mapping layer. Do **not** build UI on these columns — they are null in v1.
  *Deps:* P1-13b

- [x] **P1-14 · `ingest.standings`** — after each round completes, one call per competition. Writes a `StandingRow` snapshot per team and flips the previous `isLatest` set.
  *Deps:* P1-13

- [ ] **P1-15 · `aggregate.season-stats`** ⚠️
  Rebuilds `PlayerSeasonStat` and `TeamSeasonStat` including `formLast5`.
  ⚠️ Compute player goals and assists **from our own ingested `goals[]` rows**, not from `/scorers` — the scorers endpoint returns only the top N, so using it as the source leaves every other player on zero (§11.5). Use `/scorers` (`P1-15a`) as a cross-check instead.
  *Deps:* P1-13a

- [ ] **P1-15a · `ingest.scorers` as a cross-check** — one call per competition per round. Log a discrepancy against our derived totals as a data-quality alert; also used to backfill seasons we did not ingest match-by-match.
  *Deps:* P1-15

- [x] **P1-16 · Verify every ingest write is an upsert** (§11.3)
  *Done when:* replaying any ingest job twice over the same window produces zero row-count change.

### Football API (§12.1)

- [x] **P1-17 · Competition, season, round, standings endpoints**
  *Deps:* P0-17, P1-08

- [x] **P1-18 · Team endpoints** — profile with season stats and form, plus squad by season.
  *Deps:* P1-15

- [x] **P1-19 · Player endpoints** — profile, career, season stats. Return only the stats we actually hold (goals, assists, appearances, minutes, cards); omit unavailable fields from the response rather than sending nulls the client has to special-case.
  *Deps:* P1-15

- [x] **P1-20 · `GET /players/search`** — trigram search over `display_name`, filterable by season and team. Backs the goalscorer picker, so it must feel instant while typing. Squad ingestion gives us **every** player's identity, so search coverage is complete even though stat coverage is not.
  *Deps:* P1-19, P0-13

- [x] **P1-21 · Fixture endpoints** — detail with events and team stats, plus lineups.
  *Deps:* P1-13

- [x] **P1-22 · HTTP caching middleware**
  `public, max-age=60, stale-while-revalidate=300` + ETag on football routes; `private, no-store` on everything user-scoped (§12.3).
  *Deps:* P1-17

- [x] **P1-23 · Cursor pagination helper** — used by every list endpoint. No offset pagination anywhere.
  *Deps:* P0-17

- [ ] **P1-24 · Seed one full historical season of real data**
  A complete season of a top-5 league, fixtures through derived player stats. This is the corpus the golden-file scoring tests (`P3-29`) depend on, so it must be real, not generated.
  ⚠️ Check how many past seasons the purchased plan exposes before relying on a specific one — historical depth varies by tier.
  *Deps:* P1-13a, P0-14

### Football UI

- [x] **P1-25 · Competition page** — league table, fixtures by round, top scorers. Mobile-first per §14.3.
  *Deps:* P1-17, P0-19

- [x] **P1-26 · Team and player pages** ⚠️
  Six headline stats, everything else behind "More stats" (§14.1).
  ⚠️ Build only on what we actually hold in v1 (§11.5): record, form, goals for/against, clean sheets, and per-player goals, assists, appearances, minutes and cards. No xG, no possession, no shots, no ratings — designing around those produces a page of blanks. The low-clutter brief means six populated stats beats twelve half-empty ones anyway.
  *Deps:* P1-18, P1-19

---

## Phase 1b — Champions League

> **Exit:** the UCL league-phase table and a full knockout bracket render correctly, including a two-legged tie with its aggregate.

- [x] **P1b-01 · Round type handling across the codebase** ⚠️
  Populate `Round.type` from the provider's `stage`; add a `formatRoundLabel(round)` helper in `packages/shared`.
  ⚠️ Audit every existing use of `Round.number` (§5.2 point 2). Sorting, "next gameweek", and round labels all silently assumed matchday semantics before this task.
  *Deps:* P1-04a, D-02

- [x] **P1b-02 · Competition without a country — UI fallbacks**
  Every surface rendering a flag beside a competition needs a null path. Use the UCL logo.
  *Deps:* P1-25

- [x] **P1b-03 · Ingest UCL league phase** — 36 teams, 8 matchdays, single table.
  *Deps:* P1-08, P1b-01

- [x] **P1b-04 · Ingest knockout rounds and create `Tie` rows** ⚠️
  Pair legs by `(stage, {teamA, teamB})`; team A is home in leg 1. Set `tieId` + `legNumber`.
  ⚠️ football-data.org has **no tie or aggregate concept at all** (§11.4) — it returns two independent matches with a `stage` and nothing linking them. Constructing the tie is entirely on us, and it is the foundation `TO_QUALIFY` scoring stands on.
  *Deps:* P1b-03

- [ ] **P1b-05 · `ingest.ucl-draw`**
  Hourly on any `Round.drawAt` date. On first sight of fixtures for a round with `isScheduleFinal = false`, create fixtures and ties, flip the flag, then emit `round.drawn`.
  *Deps:* P1b-04

- [x] **P1b-06 · `resolve.ties` job** ⚠️
  After leg 2 finishes: sum the legs, apply `score.duration` and the `penalties[]` array, set `winnerTeamId`, `decidedBy`, `settledAt`, and bump `resultVersion`.
  ⚠️ There is no provider field to fall back on — the derivation *is* the source of truth (§11.4). Do not settle until **both** legs are `FINISHED` and any shootout result is present.
  *Deps:* P1b-04, P1-12 · *Done when:* a tie level on aggregate and decided on penalties resolves to the correct club.

- [x] **P1b-07 · Skip `ingest.standings` for knockout rounds** — there is no table to snapshot.
  *Deps:* P1-14, P1b-01

- [x] **P1b-08 · `groupName` support on `StandingRow`** — needed only to load pre-2024/25 historical seasons.
  *Deps:* P1b-03

- [ ] **P1b-09 · League-phase table ordering** 🔒
  Implement per D-02. If we trust the provider's `position`, still compute our own and alert on disagreement.
  *Deps:* D-02, P1b-03

- [x] **P1b-10 · Bracket endpoints** — `GET /rounds/:id/ties`, `GET /seasons/:id/bracket`, `GET /ties/:id`.
  *Deps:* P1b-06

- [x] **P1b-11 · Bracket UI** ⚠️
  `/football/:competition/bracket`. Both legs, aggregate, winner, and how it was decided.
  ⚠️ A bracket is the hardest thing in this app to render on a 360 px screen. Design the mobile view first — a horizontally scrolling column-per-round, not a scaled-down desktop tree.
  *Deps:* P1b-10

- [x] **P1b-12 · Aggregate display on fixture rows and the match centre** — leg 2 onward only.
  *Deps:* P1b-11

- [ ] **P1b-13 · UCL season in the seed script** — one league phase plus one complete knockout run, ending in a final.
  *Deps:* P1b-06, P1-24

- [x] **P1b-14 · Tie resolution test suite**
  Covering: aggregate win, extra time, penalties, a leg abandoned, and a corrected leg-2 score bumping `resultVersion`.
  *Deps:* P1b-06

---

## Phase 2 — Leagues

> **Exit:** two users can create and join a league using a preset.

- [x] **P2-01 · League CRUD service and endpoints**
  Create (season + preset), read, patch, soft delete. Slug generation with collision handling.
  *Deps:* P0-17, P1-17

- [x] **P2-02 · Join codes and visibility**
  6-char `joinCode`, `PUBLIC` / `UNLISTED` / `PRIVATE` semantics on both list and join paths.
  *Deps:* P2-01

- [x] **P2-03 · Membership model and lifecycle** — join, leave, remove, ban; `MemberStatus` transitions.
  *Deps:* P2-01

- [x] **P2-04 · `requireLeagueRole()` middleware** ⚠️
  Resolves `req.membership` once per request and enforces the §15.2 matrix.
  ⚠️ Every admin action goes through this. Conditional rendering on the client is not authorization — the E2E authz test in `P2-18` exists to prove it.
  *Deps:* P2-03

- [x] **P2-05 · Invite tokens** — `POST /leagues/:slug/invites`, expiry, `maxUses`, shareable link.
  *Deps:* P2-03

- [x] **P2-06 · `GET /leagues/mine` and `GET /leagues/public`**
  *Deps:* P2-02, P1-23

- [x] **P2-07 · Ownership transfer and league deletion** — owner-only, soft delete, audit-logged.
  *Deps:* P2-04

- [x] **P2-08 · `packages/scoring` — package skeleton**
  Pure package, zero dependencies on `db`. Vitest configured.
  *Deps:* P0-03

- [x] **P2-09 · Rule presets** (§8.6)
  Classic, Exact Score Heavy, Underdog, Survival, Goalscorer — as full configs in `presets.ts`.
  ⚠️ Presets are **copied** into `RuleSet.config` at creation, never referenced. Editing a preset must not alter existing leagues.
  *Deps:* P2-08

- [x] **P2-10 · `GET /rules/presets`** and preset selection during league creation.
  *Deps:* P2-09, P2-01

- [x] **P2-11 · `RuleSet` v1 creation on league creation** — version 1, `isActive`, `isFrozen: false`.
  *Deps:* P2-10

- [x] **P2-12 · `leagues.materialise-rounds` job**
  Creates a `LeagueRound` per `Round` in the season, with sequence, resolved deadline, and the active rule set.
  *Deps:* P2-11, P1-08

- [x] **P2-13 · Provisional rounds for undrawn knockouts** (§10.5)
  Create the round with `isProvisional: true`, an estimated deadline from `Round.startsAt`, and zero fixtures.
  *Deps:* P2-12, P1b-05

- [ ] **P2-14 · `leagues.materialise-round` on `round.drawn`**
  Creates `LeagueFixture` rows, recomputes the real deadline, clears `isProvisional`, notifies members.
  *Deps:* P2-13

- [x] **P2-15 · Web: league creation wizard**
  Season → preset → name and visibility → invite. Four short steps, one decision per screen (§14.1).
  *Deps:* P2-10, P0-23

- [x] **P2-16 · Web: league overview page** — standings placeholder plus the next deadline.
  *Deps:* P2-01

- [x] **P2-17 · Web: members page and invite sharing** — native share sheet on mobile, copy-link fallback.
  *Deps:* P2-05

- [x] **P2-18 · AuthZ test matrix** — Supertest coverage of every row in §15.2, both allowed and denied.
  *Deps:* P2-04

---

## Phase 3 — Predict & score

> **Exit:** a full gameweek is predicted, locked, scored, and ranked correctly.
> Build this on **one hardcoded preset** (§19). Phase 4 generalises it — do not build the rule editor first.

### Rounds and fixtures

- [x] **P3-01 · League fixture selection** — admin picks a subset of the gameweek; `position` and `weight` per fixture.
  *Deps:* P2-12

- [x] **P3-02 · Deadline resolution service** (§10.1)
  All four strategies, with a **negative** `deadlineOffsetMin` supported — "predict up to 10 minutes after kickoff" is a real house rule, not an edge case.
  *Deps:* P3-01

- [x] **P3-03 · Deadline recomputation on kickoff change** — only while the round is `UPCOMING`.
  *Deps:* P3-02, P1-10

- [x] **P3-04 · `GET /leagues/:slug/rounds/:sequence`** — fixtures, my predictions, deadline, status. One request per screen.
  *Deps:* P3-02

### Predictions

- [x] **P3-05 · Prediction + selection write service** ⚠️
  Membership check → fixture-belongs-to-round check → **deadline re-check against `now()` from Postgres** → upsert.
  ⚠️ Read the clock from the database, never from the Node process (§10.2). Clock skew between API replicas is otherwise an exploitable window.
  *Deps:* P3-04

- [x] **P3-06 · `PUT .../predictions` bulk upsert** (§12.2)
  One transaction, `Idempotency-Key` honoured, **partial success reported per fixture** so one late kickoff doesn't discard nine valid picks.
  *Deps:* P3-05

- [x] **P3-07 · `POST .../submit`** — `DRAFT` → `SUBMITTED` for the whole round.
  *Deps:* P3-06

- [x] **P3-08 · `rounds.lock` job** ⚠️
  Every 30 s. `FOR UPDATE SKIP LOCKED` so replicas don't double-process. Stamps `lockedAt`, inserts `MISSED` placeholders for non-predictors, publishes `round.locked`.
  ⚠️ The query must exclude `is_provisional = true` (§10.5) — locking a round with no fixtures would generate placeholder predictions for matches that don't exist.
  *Deps:* P3-07, P2-13

- [x] **P3-09 · Postponement handling** — before deadline: drop from round and notify. After: honour `voidPostponedFixtures`.
  *Deps:* P3-08

### Scoring engine — `packages/scoring` (§8)

- [x] **P3-10 · `dsl.ts` — the Zod rule schema**
  `Condition`, `ConditionGroup` (`all` / `any` / `not`, depth-capped), `Award`, `Multiplier`, `RuleSetConfigSchema`. Caps: 50 awards, 10 multipliers, 8 conditions per group.
  *Deps:* P2-08

- [x] **P3-11 · `facts.ts` — fact builder**
  Every field in §8.2: `predicted`, `actual`, `derived`, `context`. Knockout fields can stub to null until `P4b-02`.
  *Deps:* P3-10

- [x] **P3-12 · `evaluate.ts` — the interpreter** ⚠️
  Award evaluation with group exclusivity, multiplier combination (`multiply` vs `max`), fixture weight and booster factor, floor, rounding.
  ⚠️ Group semantics are the subtle part: `group: null` awards **stack**; awards sharing a group name are **exclusive**, highest wins. Getting this backwards makes every preset score wrong in a way that looks plausible.
  *Deps:* P3-11

- [x] **P3-13 · `consensusShare` computation**
  Fraction of the league's members making the same outcome call — the fact behind "only one who called it". Computed once per fixture per scoring run, not per prediction.
  *Deps:* P3-11

- [x] **P3-14 · Scoring worker + `inputHash` idempotency** ⚠️
  `sha256(leagueRoundId ‖ ruleSet.version ‖ sorted(fixtureId:resultVersion))`. Unique on `(leagueRoundId, inputHash)`; re-delivery is a no-op.
  ⚠️ This is what makes the whole pipeline safe to retry, and provider webhooks are not reliably once-only. Get the hash inputs exactly right or idempotency silently fails open.
  *Deps:* P3-12, P1-12

- [x] **P3-15 · Write `PredictionScore` with breakdown**
  `basePoints`, `multiplier`, `points`, `isExactScore`, `isOutcomeCorrect`, and the `breakdown` array naming every rule that fired.
  *Deps:* P3-14

- [x] **P3-16 · Rescore on result correction** (§9.2)
  Supersede the prior run, upsert scores, recompute standings **from that round forward**, notify affected members.
  ⚠️ Silent leaderboard movement destroys trust faster than the original error. The notification is not optional.
  *Deps:* P3-15

- [x] **P3-17 · Provisional → final round settlement** — `PROVISIONAL` on all fixtures finished, `FINAL` 24 h later or on admin confirmation.
  *Deps:* P3-15

### Standings

- [x] **P3-18 · Standings worker**
  Rebuilds `StandingEntry` for the round and every round after it. Serialised per league via a Redis lock.
  *Deps:* P3-15

- [x] **P3-19 · Tiebreaker resolution** — all seven `tiebreakers` values in config order, including head-to-head.
  *Deps:* P3-18

- [x] **P3-20 · Late-join policy** — `lateJoinPolicy` and `effectiveFromRound` applied when computing totals.
  *Deps:* P3-18

- [x] **P3-21 · Standings endpoints** — current, by round, and per-user history for sparklines.
  *Deps:* P3-18

### Prediction UI (§13.3)

- [x] **P3-22 · `ScoreStepper` component** — 56 px targets, one-handed, keyboard-free.
  *Deps:* P0-19

- [x] **P3-23 · Prediction screen layout** — sticky header with countdown, fixture list, sticky submit CTA showing "8 of 10".
  *Deps:* P3-22, P3-04

- [x] **P3-24 · Quick-score chips** — 1-0, 2-1, 1-1, 0-0 as one-tap presets.
  *Deps:* P3-23

- [x] **P3-25 · Autosave and draft persistence** — 800 ms debounce to `localStorage` plus a background draft PUT. Closing the tab must never lose picks.
  *Deps:* P3-23, P3-06

- [x] **P3-26 · Countdown and lock state** ⚠️
  Per-fixture or per-round countdown; flips to locked on the WebSocket `round.locked` event.
  ⚠️ Driven by the server event, not the client clock (§13.3). A device with a slow clock must not get a usable input after the deadline.
  *Deps:* P3-08, P3-23

- [x] **P3-27 · Round results page** — final scores, my pick, points, and every member's picks post-deadline.
  *Deps:* P3-21

- [x] **P3-28 · `BreakdownSheet`** — bottom sheet listing each rule that fired, its label, and its points. This is the answer to "why did I get 7 points?".
  *Deps:* P3-27, P3-15

### Scoring tests (§17.2)

- [x] **P3-29 · Golden-file preset tests** — each preset scored against ~200 real historical results from `P1-24`, snapshot-compared. Catches scoring drift better than any assertion.
  *Deps:* P3-12, P1-24

- [x] **P3-30 · Property-based engine tests** (`fast-check`)
  Determinism; group exclusivity; `round(basePoints × multiplier) === points`; termination. 100 % interpreter coverage.
  *Deps:* P3-12

---

## Phase 4 — Custom rules

> **Exit:** an admin builds a bespoke rule set and sees the preview before committing.

- [x] **P4-01 · `POST /rules/validate`** — dry-run returning structured errors **and warnings**, per rule id.
  *Deps:* P3-10

- [x] **P4-01a · Market gating on provider capabilities** ⚠️
  Reject a rule set enabling a market the current provider plan cannot score, naming the reason and the plan feature required (§11.5).
  ⚠️ In v1 this gates exactly one market — `TOTAL_CORNERS_OVER_UNDER` — which makes it easy to skip. Don't. The difference is between "corners need the statistics add-on" and a market that silently awards nobody any points all season, and the second is indistinguishable from a scoring bug to the person looking at it.
  *Deps:* P4-01, P1-01

- [x] **P4-02 · `POST /rules/simulate`** ⚠️
  Given a draft config and sample fixtures, return previewed points with full breakdowns.
  ⚠️ Without this, authoring custom rules is guesswork (§12.1). It is the feature that makes the whole custom-rules premise usable — treat it as core, not as a nicety.
  *Deps:* P4-01, P3-12

- [x] **P4-03 · Rule set versioning service** ⚠️
  New version on edit when frozen; `isActive` flips; new version attaches to `UPCOMING` rounds **only**.
  ⚠️ Scored rounds keep pointing at the version they were scored under (§8.7). A rules change must never be able to alter a past leaderboard — this is the guarantee the product rests on.
  *Deps:* P2-11

- [x] **P4-04 · Freeze on first score** — set `RuleSet.isFrozen` when the first `PredictionScore` references it; block in-place edits thereafter.
  *Deps:* P4-03, P3-15

- [x] **P4-05 · `GET /rules` and `/rules/versions`** — active version plus full version history with diffs.
  *Deps:* P4-03

- [x] **P4-06 · Notify members on a rules change** — "rules changed from Matchday 14", linking to the diff.
  *Deps:* P4-03

- [x] **P4-07 · Audit-log every rule change** — before/after config in `AuditLog`.
  *Deps:* P4-03

- [x] **P4-08 · Web: preset gallery** — `RulePresetCard` with plain-English summaries. Preset first, "Customise" second (§14.1).
  *Deps:* P2-10

- [x] **P4-09 · Web: market toggles** — pick which of the ≤6 markets this league plays.
  *Deps:* P4-08

- [x] **P4-10 · Web: award editor** — add, remove, reorder awards; points input; group assignment with a plain-English explanation of stacking vs exclusive.
  *Deps:* P4-09

- [x] **P4-11 · Web: condition builder** ⚠️
  Fact picker, operator, value — no raw JSON in the primary UI.
  ⚠️ This is the highest clutter risk in the app (§14.1). Constrain the fact list to what the selected markets actually expose; do not surface all of `ScoringFacts` at once.
  *Deps:* P4-10

- [x] **P4-12 · Web: multiplier editor** — factor, condition, and `multiply` vs `max` combination.
  *Deps:* P4-11

- [x] **P4-13 · Web: deadline and booster settings** — strategy, offset (including negative), edits allowed, picks reveal, missed-prediction points, boosters and uses per season.
  *Deps:* P4-10

- [x] **P4-14 · Web: live simulation panel** — calls `/simulate` as the admin edits: "a 2-1 prediction on a 3-1 result pays 3 points".
  *Deps:* P4-02, P4-12

- [x] **P4-15 · Web: tiebreaker ordering** — drag to reorder the seven tiebreakers.
  *Deps:* P4-13

---

## Phase 4b — Knockout markets

> **Exit:** a UCL league scores a two-legged tie decided on penalties, correctly, under all three score bases.

- [x] **P4b-01 · `TO_QUALIFY` market end to end** — `teamId` slot on `PredictionSelection`, shared DTO, validation.
  *Deps:* P3-10, P1b-06

- [x] **P4b-02 · `knockoutScoreBasis` resolution in the fact builder** ⚠️
  Resolve `actual.homeGoals` / `outcome` per basis **before any rule runs**, so rules never branch on it. D-03 resolved this favourably — all three bases read off stored columns (§8.8 table), no reconstruction needed, and it works on any plan.
  ⚠️ Under `INCLUDING_PENALTIES` the shootout decides the *outcome* market while the exact score stays the 90-minute score. Verify that distinction explicitly — it is the one place the three bases genuinely diverge.
  *Deps:* P3-11, P1-04b

- [x] **P4b-03 · Knockout context facts** — `stage`, `isKnockout`, `legNumber`, `aggregateBefore`, `wentToExtraTime`, `wentToPenalties`, `qualifierTeamId`, `derived.qualifierCorrect`.
  *Deps:* P4b-02

- [x] **P4b-04 · Score `TO_QUALIFY` from the `Tie`, not the fixture** — reads `Tie.winnerTeamId`, so extra time and penalties are handled by construction.
  *Deps:* P4b-03, P1b-06

- [x] **P4b-05 · Gate scoring on `Tie.settledAt`** ⚠️
  A round whose tie is unresolved stays `LOCKED`, not `PROVISIONAL` (§9.3).
  ⚠️ Scoring a qualifier market against a half-resolved tie is exactly the error that forces a rescore.
  *Deps:* P4b-04, P3-17

- [x] **P4b-06 · Attach `TO_QUALIFY` to the deciding leg only** — leg 2, or a one-off final.
  *Deps:* P4b-01, P3-01

- [x] **P4b-07 · Positional-fact warning in `/rules/validate`** ⚠️
  Warn (not error) when a rule set on a UCL season depends on `context.homePosition`, `awayPosition`, or `upsetGap`.
  ⚠️ Those facts are null in knockout rounds — the rule silently stops firing. Better to find out while authoring than after a scoreless quarter-final (§8.8).
  *Deps:* P4-01, P4b-03

- [x] **P4b-08 · Web: qualifier picker** — two crests, pick one, on the deciding leg only.
  *Deps:* P4b-06, P3-23

- [x] **P4b-09 · Web: knockout score-basis setting** — three options with plain-English consequences in the rule editor.
  *Deps:* P4-13, P4b-02

- [x] **P4b-10 · `voidPostponedFixtures` setting and behaviour**
  *Deps:* P3-09, P4-13

- [x] **P4b-11 · Knockout scoring test suite**
  A penalty-decided tie under all three bases; an away-goals-era historical tie; an unsettled tie holding a round `LOCKED`; a corrected leg-2 result rescoring `TO_QUALIFY`.
  *Deps:* P4b-05, P1b-14

---

## Phase 5 — Boosters & social

> **Exit:** a league plays a season end to end, and members watch a live match together on the picks tab.

- [x] **P5-01 · Booster service** — `resolvedValue` snapshotted at use time so a later rule change can't retroactively alter a spent booster.
  *Deps:* P4-13

- [x] **P5-02 · `POST .../booster` and revocation before deadline**
  *Deps:* P5-01

- [x] **P5-03 · Booster factors in the interpreter** — double/triple points, banker, insurance floor, wildcard round, no-negatives.
  *Deps:* P5-01, P3-12

- [x] **P5-04 · Season-long booster budget enforcement** — `usesPerSeason` per type.
  *Deps:* P5-02

- [x] **P5-05 · Web: booster UI on the prediction screen** — nominate a fixture, with remaining uses visible.
  *Deps:* P5-02, P3-23

- [x] **P5-06 · Picks reveal gating** ⚠️
  Honour `revealPicksBeforeDeadline`.
  ⚠️ Hidden picks must be **filtered out server-side** (§15.3). Sending them and hiding with CSS is not privacy — it's a devtools tab away from being cheating.
  *Deps:* P3-27

- [x] **P5-07 · Prediction notes** — 280 chars, shown alongside a pick after the deadline.
  *Deps:* P5-06

- [x] **P5-08 · League activity feed** — rendered from `AuditLog`; admin actions visible to all members.
  *Deps:* P4-07

- [x] **P5-09 · Notification service** — write `Notification` rows, mark read, unread badge.
  *Deps:* P0-18

- [x] **P5-10 · `notify.deadline` job** — T-24 h, T-3 h, T-30 min, only to members who haven't submitted.
  *Deps:* P5-09, P3-08

- [x] **P5-11 · Round-scored and rules-changed notifications**
  *Deps:* P5-09, P3-15

- [ ] **P5-12 · Web Push + email fallback** — iOS requires the PWA be installed to the home screen; email covers the rest.
  *Deps:* P5-09, P6-01

- [ ] **P5-13 · WebSocket channel: `fixture:{id}:live`** — status, minute, score, events.
  *Deps:* P6-03, P1-11

- [x] **P5-14 · Match centre screen** (§13.4) — live badge, score, timeline, aggregate for knockout legs, tabs for stats/lineups/picks.
  *Deps:* P5-13, P1-21

- [x] **P5-15 · "Points at full time" chip** ⚠️
  ⚠️ Wording is deliberate (§9.4). "Pending" implies a number is being withheld; stating the rule answers the question once. Do not substitute a projected-points readout — a projection that later contradicts the settled score is indistinguishable from a bug.
  *Deps:* P5-14

- [x] **P5-16 · "On track" indicator** — a factual statement that the current scoreline matches the prediction; disappears the moment the score changes. Makes no claim about points.
  *Deps:* P5-15

- [x] **P5-17 · Picks tab on the match centre** — the whole league's predictions for this fixture, post-deadline. During a live match this is the most-watched screen in the product.
  *Deps:* P5-14, P5-06

---

## Phase 6 — Polish

> **Exit:** Lighthouse ≥ 95 across the board on mobile.

- [ ] **P6-01 · PWA: manifest, icons, installability**
  *Deps:* P0-19

- [ ] **P6-02 · Service worker** — offline shell; stale-while-revalidate for static football data.
  *Deps:* P6-01

- [ ] **P6-03 · WebSocket gateway** — `ws` server with Redis pub/sub fan-out; channel subscribe/unsubscribe; stateless API tier.
  *Deps:* P0-18

- [ ] **P6-04 · Client socket with reconnect and 30 s polling fallback** — real-time is an enhancement, never required for correctness (§16.3).
  *Deps:* P6-03

- [ ] **P6-05 · `league:{id}:standings` and `round:{id}:scores` channels** — updates land via `queryClient.setQueryData`, not a refetch storm.
  *Deps:* P6-04, P3-18

- [ ] **P6-06 · Offline prediction queue** — picks made offline flush on reconnect, with a visible "3 picks not yet saved" banner.
  *Deps:* P6-02, P3-25

- [ ] **P6-07 · Design tokens** — the full §14.2 set, light and dark, with the dark block guarded as `:root:not([data-theme="light"])`.
  *Deps:* P0-19

- [ ] **P6-08 · Theme toggle** — light / dark / system, persisted.
  *Deps:* P6-07

- [ ] **P6-09 · Component library** — the §14.4 set as reusable primitives on Radix.
  *Deps:* P6-07

- [ ] **P6-10 · Bottom tab bar and responsive layouts** — mobile single column, tablet two columns, desktop capped at 1120 px with left nav.
  *Deps:* P6-09

- [ ] **P6-11 · Contrast audit** — WCAG AA (4.5:1 body, 3:1 large and UI) in both themes.
  *Deps:* P6-07

- [ ] **P6-12 · Colour is never the only signal** ⚠️
  ⚠️ Correct/incorrect predictions need an icon and a label as well as green/red (§14.1). Roughly 8 % of men have some colour vision deficiency, and this app's audience skews heavily male.
  *Deps:* P6-09

- [ ] **P6-13 · Keyboard navigation and focus rings** — throughout, including the score steppers.
  *Deps:* P6-09

- [ ] **P6-14 · Screen-reader support** — `aria-live="polite"` on score updates and countdown milestones; every icon-only button labelled.
  *Deps:* P6-13

- [ ] **P6-15 · `prefers-reduced-motion`** — transitions drop to opacity-only.
  *Deps:* P6-09

- [ ] **P6-16 · Performance budget** (§13.5) — ≤ 170 KB gzipped initial JS, route-level code splitting, list virtualisation above ~50 rows, WebP crests with explicit dimensions.
  *Deps:* P6-10

- [ ] **P6-17 · E2E suite** — register → create league → invite → predict → lock → score → standings, plus a knockout tie flow.
  *Deps:* P4b-11, P3-27

- [ ] **P6-18 · Visual regression** — key screens, both themes, three viewports.
  *Deps:* P6-10

---

## Phase 7 — Scale

> **Exit:** 1,000 concurrent predictors in the 30 minutes before a Saturday 15:00 deadline.

- [ ] **P7-01 · Read replica client** — a second Prisma client on `READ_REPLICA_URL` for season stats and other long analytical reads.
  *Deps:* P1-15

- [ ] **P7-02 · Redis caching layer** — football endpoints and session lookups, with explicit invalidation on ingest.
  *Deps:* P1-22

- [ ] **P7-03 · Rate limiting** — 60/min general, 10/min auth, 120/min prediction writes; Redis token bucket keyed by user, IP-hash fallback.
  *Deps:* P0-16

- [ ] **P7-04 · Nightly consistency job** ⚠️
  Assert all eight invariants in §17.3. Any violation pages.
  ⚠️ These are the only automated check that scoring hasn't silently drifted. Wire the alert to a real destination, not a log line nobody reads.
  *Deps:* P4b-05, P3-18

- [ ] **P7-05 · OpenTelemetry tracing** — API → queue → worker → DB, with the request ID propagated end to end.
  *Deps:* P0-16, P0-18

- [ ] **P7-06 · Metrics and dashboards** — submissions/min, deadline-miss rate, scoring-run duration and failures, provider latency and errors, **rescore count** (a leading indicator of data-quality problems).
  *Deps:* P7-05

- [ ] **P7-07 · Alerting** — any `ScoringRun` failure; ingest failing two cycles running; any round still `UPCOMING` more than 5 min past its deadline.
  *Deps:* P7-06

- [ ] **P7-08 · Load test the deadline rush** — 1,000 concurrent bulk upserts in a 30-minute window.
  *Deps:* P7-03, P3-06

- [ ] **P7-09 · Query plan review** — `EXPLAIN ANALYZE` every hot query in §7.1 against production-scale data.
  *Deps:* P7-08

- [ ] **P7-10 · Evaluate partitioning** — `predictions` and `prediction_scores` by season, only if `P7-09` justifies it. §7.3 explicitly defers this until real volume demands it.
  *Deps:* P7-09

- [ ] **P7-11 · `ExternalRef.payload` retention** — null out after 30 days (§20 item 7).
  *Deps:* P1-04

- [ ] **P7-12 · Account deletion and data protection** — soft delete, anonymise to "Former member", **preserve prediction rows** so historical league tables stay intact. Rotate the IP-hash salt.
  *Deps:* P0-21

- [ ] **P7-13 · Backups and restore drill** — Neon PITR plus a daily logical backup, with a documented restore actually performed once.
  *Deps:* P0-06

---

## Cross-cutting, ongoing

- [ ] **X-01 · Keep `architecture.md` current.** When implementation contradicts the design, update the doc in the same PR. A stale architecture doc is worse than none.
- [ ] **X-02 · Record ADRs for reversals.** Anything that changes a §20 decision gets a short ADR in `docs/adr/`.
- [ ] **X-03 · Rule ids are permanent** (Appendix A). Once a rule id ships it appears in stored `breakdown` JSON forever. Renaming one orphans every past explanation — treat the id list as an append-only registry.
- [ ] **X-04 · Every migration is backward-compatible** with the previous app version (expand → migrate → contract), so a rollback never strands the database.
- [ ] **X-05 · No provider ID outside `ExternalRef`.** Worth a periodic grep; it is the assumption that makes switching providers a one-directory change.

---

## Critical path

The shortest route to a working product, for sequencing when parallel work isn't possible:

```
P0-01 → P0-13 (schema + trigger)
      → P0-21 (auth)
      → P1-02 → P1-08 → P1-12 (results you can trust)
      → P2-01 → P2-12 (leagues with rounds)
      → P3-05 → P3-08 (predictions that lock)
      → P3-12 → P3-14 → P3-18 (points and a table)
      → P3-23 (a screen to enter picks on)
```

Everything else — UCL, custom rules, boosters, real-time — hangs off that spine. If a phase slips, protect this path.

**Highest-risk tasks**, in order: `P1-04b` (never read `fullTime`), `P3-14` (idempotency hash), `P3-12` (group semantics), `P1-12` (result confirmation), `P4-03` (version immutability), `P3-05` (server-side deadline), `P1-04a` (enum validation). Each one fails quietly and produces a wrong leaderboard rather than an error, which is why §17.3's invariants exist.

`P1-04b` tops the list because it is the only one already *proven* to be wrong by default — the live API hands you a plausible-looking scoreline that never happened, and the naive reading is the incorrect one.

**Highest-risk external dependency:** the provider's rate limit is per *minute* (`P1-03`, `P1-11`). Unlike a monthly quota, exceeding it fails immediately and visibly during exactly the window that matters most — a Saturday afternoon with ten matches live.
