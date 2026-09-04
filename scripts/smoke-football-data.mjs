#!/usr/bin/env node
/**
 * Smoke test for football-data.org v4.
 *
 * Closes three blocking decisions from docs/tasks.md in one run:
 *
 *   D-01  All six competitions reachable, Deep Data active (goals[] populated),
 *         and the plan's real calls-per-minute ceiling.
 *   D-02  What `stage` value the provider emits for the UCL 36-team league
 *         phase. The documented enum has no LEAGUE_STAGE, so we look.
 *   D-03  Whether score.fullTime includes extra-time goals. This decides
 *         whether NINETY_MINUTES — the default knockout basis — is directly
 *         readable or must be reconstructed from goal minutes.
 *
 * Usage:
 *   FOOTBALL_API_TOKEN=xxx node scripts/smoke-football-data.mjs
 *
 * No dependencies. Node 18+ (built-in fetch).
 *
 * The script self-throttles. On the free tier (10 calls/min) a full run takes
 * roughly two minutes; on Deep Data (30/min) about forty seconds. Override with
 * FOOTBALL_RATE_DELAY_MS if your plan allows faster.
 */

const TOKEN = process.env.FOOTBALL_API_TOKEN;
const BASE = process.env.FOOTBALL_API_BASE ?? 'https://api.football-data.org/v4';
const DELAY_MS = Number(process.env.FOOTBALL_RATE_DELAY_MS ?? 6500);
/** UCL season to inspect for stages and extra time. Starting year. */
const CL_SEASON = Number(process.env.SMOKE_CL_SEASON ?? 2024);

const COMPETITIONS = [
  { code: 'PL', id: 2021, name: 'Premier League' },
  { code: 'PD', id: 2014, name: 'Primera Division' },
  { code: 'SA', id: 2019, name: 'Serie A' },
  { code: 'BL1', id: 2002, name: 'Bundesliga' },
  { code: 'FL1', id: 2015, name: 'Ligue 1' },
  { code: 'CL', id: 2001, name: 'UEFA Champions League' },
];

const results = [];
let minuteCeiling = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const c = {
  reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m',
  green: '\x1b[32m', red: '\x1b[31m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};

function record(id, label, ok, detail) {
  results.push({ id, label, ok, detail });
  const mark = ok === true ? `${c.green}PASS${c.reset}`
    : ok === false ? `${c.red}FAIL${c.reset}`
    : `${c.yellow}WARN${c.reset}`;
  console.log(`  [${mark}] ${label}${detail ? `\n         ${c.dim}${detail}${c.reset}` : ''}`);
}

let firstCall = true;
async function get(path) {
  if (!firstCall) await sleep(DELAY_MS);
  firstCall = false;

  const res = await fetch(`${BASE}${path}`, { headers: { 'X-Auth-Token': TOKEN } });
  const remaining = res.headers.get('x-requests-available-minute');
  if (remaining !== null) minuteCeiling = Math.max(minuteCeiling ?? 0, Number(remaining));

  if (res.status === 429) {
    const reset = res.headers.get('x-requestcounter-reset') ?? '60';
    console.log(`  ${c.yellow}rate limited, waiting ${reset}s…${c.reset}`);
    await sleep((Number(reset) + 1) * 1000);
    firstCall = true;
    return get(path);
  }

  let body = null;
  try { body = await res.json(); } catch { /* non-JSON error page */ }
  return { status: res.status, ok: res.ok, body, remaining };
}

// ─────────────────────────────────────────────────────────────────────────────

async function checkCompetitions() {
  console.log(`\n${c.bold}D-01 · Competition access${c.reset}`);
  let allOk = true;

  for (const comp of COMPETITIONS) {
    const { status, ok, body } = await get(`/competitions/${comp.code}`);
    if (ok) {
      const season = body?.currentSeason?.startDate?.slice(0, 4) ?? '?';
      record(`D-01/${comp.code}`, `${comp.code.padEnd(3)} ${comp.name}`, true,
        `id ${body?.id} · current season ${season} · matchday ${body?.currentSeason?.currentMatchday ?? '—'}`);
      if (body?.id !== comp.id) {
        record(`D-01/${comp.code}/id`, `${comp.code} id mismatch`, null,
          `docs say ${comp.id}, API says ${body?.id} — update the lookup in architecture.md §11.5`);
      }
    } else {
      allOk = false;
      record(`D-01/${comp.code}`, `${comp.code.padEnd(3)} ${comp.name}`, false,
        `HTTP ${status} — ${body?.message ?? 'not available on this plan'}`);
    }
  }
  return allOk;
}

async function checkDeepData() {
  console.log(`\n${c.bold}D-01 · Deep Data (goals[], bookings[], lineups)${c.reset}`);

  const list = await get('/competitions/PL/matches?status=FINISHED');
  if (!list.ok) {
    record('D-01/deep', 'Fetch a finished PL match', false,
      `HTTP ${list.status} — ${list.body?.message ?? 'unavailable'}`);
    return false;
  }

  // Walk back from the most recent — the last match may be 0-0.
  const scored = (list.body?.matches ?? [])
    .filter((m) => (m.score?.fullTime?.home ?? 0) + (m.score?.fullTime?.away ?? 0) > 0)
    .slice(-1)[0];

  if (!scored) {
    record('D-01/deep', 'Find a finished match with goals', null,
      'No finished PL match with a goal yet this season — try SMOKE_CL_SEASON or run mid-season.');
    return null;
  }

  const detail = await get(`/matches/${scored.id}`);
  if (!detail.ok) {
    record('D-01/deep', 'Fetch match detail', false, `HTTP ${detail.status}`);
    return false;
  }

  const m = detail.body;
  const goals = m?.goals ?? [];
  const hasScorers = goals.length > 0 && goals.every((g) => g.scorer?.id);
  const label = `${m.homeTeam?.shortName ?? m.homeTeam?.name} ${m.score?.fullTime?.home}-${m.score?.fullTime?.away} ${m.awayTeam?.shortName ?? m.awayTeam?.name}`;

  record('D-01/goals', 'goals[] populated with named scorers', hasScorers,
    hasScorers
      ? `${label} · ${goals.length} goal(s) · e.g. ${goals[0].scorer?.name}${goals[0].assist ? ` (assist ${goals[0].assist.name})` : ''} ${goals[0].minute}'`
      : `${label} · goals[] is empty — Deep Data is NOT active on this plan. Goalscorer markets cannot be scored.`);

  const hasAssists = goals.some((g) => g.assist?.id);
  record('D-01/assists', 'assist named on at least one goal', hasAssists ? true : null,
    hasAssists ? 'ANYTIME_GOALSCORER and derived assists are viable.'
      : 'No assist on this sample — not conclusive, recheck on another match.');

  record('D-01/bookings', 'bookings[] present', Array.isArray(m?.bookings) && m.bookings.length > 0 ? true : null,
    Array.isArray(m?.bookings) && m.bookings.length > 0
      ? `${m.bookings.length} card(s) — RED_CARD_SHOWN is viable.`
      : 'No cards in this match — not conclusive.');

  const lineup = m?.homeTeam?.lineup ?? [];
  record('D-01/lineups', 'lineup present', lineup.length > 0,
    lineup.length > 0
      ? `${lineup.length} players — minutesPlayed is derivable (P1-13a).`
      : 'No lineup — minutes played cannot be derived. Check the plan.');

  const stats = m?.homeTeam?.statistics;
  record('D-01/statistics', 'team statistics block (expected ABSENT in v1)',
    stats ? null : true,
    stats
      ? `Statistics ARE present (${Object.keys(stats).join(', ')}). The add-on appears active — set FOOTBALL_CAP_STATISTICS=true and the corners market becomes available.`
      : 'Absent, as expected. Corners market stays gated off (§11.5).');

  return hasScorers;
}

async function checkUclStages() {
  console.log(`\n${c.bold}D-02 · UCL league-phase stage value${c.reset}`);

  const res = await get(`/competitions/CL/matches?season=${CL_SEASON}`);
  if (!res.ok) {
    record('D-02', `Fetch CL ${CL_SEASON} matches`, false,
      `HTTP ${res.status} — ${res.body?.message ?? 'season may be outside your plan\'s history window'}`);
    return null;
  }

  const matches = res.body?.matches ?? [];
  const stages = new Map();
  for (const m of matches) {
    const s = m.stage ?? 'NULL';
    stages.set(s, (stages.get(s) ?? 0) + 1);
  }

  const documented = new Set([
    'FINAL', 'THIRD_PLACE', 'SEMI_FINALS', 'QUARTER_FINALS', 'LAST_16', 'LAST_32',
    'LAST_64', 'GROUP_STAGE', 'PLAYOFFS', 'PLAYOFF_ROUND_1', 'PLAYOFF_ROUND_2',
    'PRELIMINARY_ROUND', 'QUALIFICATION', 'QUALIFICATION_ROUND_1',
    'QUALIFICATION_ROUND_2', 'QUALIFICATION_ROUND_3', 'REGULAR_SEASON',
    'ROUND_1', 'ROUND_2', 'ROUND_3', 'ROUND_4',
    'CLAUSURA', 'APERTURA', 'CHAMPIONSHIP_ROUND', 'RELEGATION_ROUND',
  ]);

  console.log(`  ${c.dim}${matches.length} matches in CL ${CL_SEASON}. Stage values found:${c.reset}`);
  for (const [stage, count] of [...stages].sort((a, b) => b[1] - a[1])) {
    const known = documented.has(stage) ? '' : `  ${c.yellow}← NOT in the documented enum${c.reset}`;
    console.log(`    ${c.cyan}${stage.padEnd(22)}${c.reset} ${String(count).padStart(3)} matches${known}`);
  }

  // The league phase is whichever stage holds the most matches (36 teams × 8 = 144).
  const [biggest] = [...stages].sort((a, b) => b[1] - a[1]);
  record('D-02', 'League-phase stage identified', true,
    `Map RoundType.LEAGUE_PHASE ← "${biggest[0]}" (${biggest[1]} matches). ` +
    `Record this in architecture.md §20 item 2 and build the P1-04a mapping against it.`);

  const undocumented = [...stages.keys()].filter((s) => !documented.has(s));
  if (undocumented.length) {
    record('D-02/new', 'Undocumented stage values present', null,
      `${undocumented.join(', ')} — P1-04a must fail loudly on unknown stages, so add these explicitly.`);
  }

  return { matches, stages };
}

async function checkExtraTime(clMatches) {
  console.log(`\n${c.bold}D-03 · Does score.fullTime include extra-time goals?${c.reset}`);

  if (!clMatches) {
    record('D-03', 'Extra-time semantics', null, 'Skipped — CL matches unavailable.');
    return;
  }

  const et = clMatches.find(
    (m) => m.score?.duration && m.score.duration !== 'REGULAR' && m.status === 'FINISHED',
  );

  if (!et) {
    record('D-03', 'Find a match that went past 90 minutes', null,
      `No non-REGULAR duration in CL ${CL_SEASON}. Retry with SMOKE_CL_SEASON=2023 (or an earlier season your plan exposes).`);
    return;
  }

  const detail = await get(`/matches/${et.id}`);
  if (!detail.ok) {
    record('D-03', 'Fetch extra-time match detail', false, `HTTP ${detail.status}`);
    return;
  }

  const m = detail.body;
  const s = m.score ?? {};

  console.log(`  ${c.dim}${m.homeTeam?.shortName} v ${m.awayTeam?.shortName} · duration=${s.duration}${c.reset}`);
  console.log(`  ${c.dim}score object: ${JSON.stringify(s)}${c.reset}`);

  // The v4 docs list only { winner, duration, fullTime, halfTime }. In reality
  // the object also carries regularTime, extraTime and penalties — which is
  // what makes knockout scoring tractable. Check for them explicitly.
  const hasBreakdown = s.regularTime != null;
  record('D-03/fields', 'score.regularTime present (undocumented but real)', hasBreakdown,
    hasBreakdown
      ? `regularTime=${s.regularTime.home}-${s.regularTime.away} · extraTime=${s.extraTime?.home ?? '—'}-${s.extraTime?.away ?? '—'} · penalties=${s.penalties?.home ?? '—'}-${s.penalties?.away ?? '—'}`
      : 'ABSENT — the 90-minute score would have to be reconstructed from goals[] minutes, making Deep Data mandatory for knockout scoring.');

  if (!hasBreakdown) return;

  const sum = (...parts) => parts.reduce(
    (acc, p) => ({ home: acc.home + (p?.home ?? 0), away: acc.away + (p?.away ?? 0) }),
    { home: 0, away: 0 },
  );
  const total = sum(s.regularTime, s.extraTime, s.penalties);
  const ftIsSum = total.home === s.fullTime?.home && total.away === s.fullTime?.away;

  record('D-03', 'What score.fullTime actually means', true,
    ftIsSum
      ? `⚠️ fullTime = regularTime + extraTime + penalties (${s.regularTime.home}-${s.regularTime.away} + ` +
        `${s.extraTime?.home ?? 0}-${s.extraTime?.away ?? 0} + ${s.penalties?.home ?? 0}-${s.penalties?.away ?? 0} = ` +
        `${s.fullTime.home}-${s.fullTime.away}). For a shootout that is a scoreline which NEVER HAPPENED. ` +
        `Never read fullTime on a knockout match — use regularTime for NINETY_MINUTES, ` +
        `regularTime+extraTime for AFTER_EXTRA_TIME, penalties for the outcome under INCLUDING_PENALTIES.`
      : `fullTime (${s.fullTime?.home}-${s.fullTime?.away}) is NOT the sum of the parts — inspect manually before writing P4b-02.`);
}

// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(`${c.bold}football-data.org v4 smoke test${c.reset}`);
  console.log(`${c.dim}${BASE} · ${DELAY_MS}ms between calls${c.reset}`);

  if (!TOKEN) {
    console.error(`\n${c.red}FOOTBALL_API_TOKEN is not set.${c.reset}`);
    console.error('Get one at https://www.football-data.org/client/register, then:');
    console.error('  FOOTBALL_API_TOKEN=xxx node scripts/smoke-football-data.mjs\n');
    process.exit(2);
  }

  await checkCompetitions();
  await checkDeepData();
  const cl = await checkUclStages();
  await checkExtraTime(cl?.matches);

  console.log(`\n${c.bold}Summary${c.reset}`);
  const failed = results.filter((r) => r.ok === false);
  const warned = results.filter((r) => r.ok === null);
  console.log(`  ${results.filter((r) => r.ok === true).length} passed, ${failed.length} failed, ${warned.length} inconclusive`);

  if (minuteCeiling !== null) {
    console.log(`  Rate ceiling observed: ${c.cyan}~${minuteCeiling + 1}/min${c.reset} — set FOOTBALL_RATE_LIMIT_PER_MIN to your plan's figure.`);
  }

  if (failed.length) {
    console.log(`\n${c.red}D-01 is not satisfied.${c.reset} Failures:`);
    for (const f of failed) console.log(`  · ${f.label} — ${f.detail}`);
    process.exit(1);
  }

  console.log(`\n${c.green}D-01 satisfied.${c.reset} Record the D-02 and D-03 answers above in architecture.md §20, then start P0-01.`);
}

main().catch((err) => {
  console.error(`\n${c.red}Unexpected error:${c.reset}`, err);
  process.exit(1);
});
