import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '@wp/db';
import { createApp } from '../app.js';

const app = createApp({ webOrigin: 'http://localhost:5173' });

const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const owner = {
  email: `b${stamp}@boost.test`,
  username: `b${stamp}`.slice(0, 20),
  cookie: '',
  id: '',
};
let slug = '';
let seq = 1;
let fixtureIds: string[] = [];

beforeAll(async () => {
  const reg = await request(app)
    .post('/api/v1/auth/register')
    .send({ email: owner.email, username: owner.username, password: 'correct-horse-battery' });
  owner.cookie = (reg.headers['set-cookie'] as unknown as string[])[0]!;
  owner.id = reg.body.user.id;

  const comps = await request(app).get('/api/v1/competitions');
  const seasonId = comps.body.competitions.find(
    (c: { slug: string }) => c.slug === 'premier-league',
  ).currentSeason.id;

  // Classic offers BANKER x2, five uses per season.
  const league = await request(app)
    .post('/api/v1/leagues')
    .set('Cookie', owner.cookie)
    .send({ name: `Boost ${stamp}`, seasonId, presetId: 'classic' });
  slug = league.body.league.slug;

  /**
   * ⚠️ The first round with a deadline still in the FUTURE, not round 1.
   *
   * Hardcoding round 1 made this suite a time bomb: it passed until the
   * season's opening matchday kicked off, then every booster test began
   * failing with `deadline-passed` — a real rule, correctly enforced, against
   * a fixture that had become historical. Boosters are a pre-deadline
   * decision, so the test has to pick a round that is genuinely still open.
   */
  const open = await prisma.leagueRound.findFirst({
    where: { league: { slug }, status: 'UPCOMING', deadlineAt: { gt: new Date() } },
    orderBy: { sequence: 'asc' },
    select: { sequence: true },
  });
  if (!open) throw new Error('No round with a future deadline — the season data is exhausted.');
  seq = open.sequence;

  const round = await request(app)
    .get(`/api/v1/leagues/${slug}/rounds/${seq}`)
    .set('Cookie', owner.cookie);
  fixtureIds = round.body.round.fixtures.map((f: { leagueFixtureId: string }) => f.leagueFixtureId);
}, 180_000);

afterAll(async () => {
  await prisma.predictionLeague.deleteMany({ where: { slug } });
  await prisma.user.deleteMany({ where: { email: owner.email } });
  await prisma.$disconnect();
});

describe('booster budget', () => {
  it('reports what the league offers and what is left', async () => {
    const res = await request(app)
      .get(`/api/v1/leagues/${slug}/boosters`)
      .set('Cookie', owner.cookie);
    expect(res.status).toBe(200);

    const banker = res.body.boosters.find((b: { type: string }) => b.type === 'BANKER');
    expect(banker).toMatchObject({
      value: 2,
      usesPerSeason: 5,
      used: 0,
      remaining: 5,
      scope: 'fixture',
    });
  });
});

describe('using a booster', () => {
  it('nominates a match', async () => {
    const res = await request(app)
      .post(`/api/v1/leagues/${slug}/rounds/${seq}/booster`)
      .set('Cookie', owner.cookie)
      .send({ type: 'BANKER', leagueFixtureId: fixtureIds[0] });

    expect(res.status).toBe(201);
    expect(res.body.value).toBe(2);
    expect(res.body.leagueFixtureId).toBe(fixtureIds[0]);
  });

  it('counts against the season budget', async () => {
    const res = await request(app)
      .get(`/api/v1/leagues/${slug}/boosters`)
      .set('Cookie', owner.cookie);
    const banker = res.body.boosters.find((b: { type: string }) => b.type === 'BANKER');
    expect(banker.used).toBe(1);
    expect(banker.remaining).toBe(4);
  });

  it('MOVES rather than errors when re-nominated in the same round', async () => {
    // Changing your mind before the deadline is normal, not a mistake.
    const res = await request(app)
      .post(`/api/v1/leagues/${slug}/rounds/${seq}/booster`)
      .set('Cookie', owner.cookie)
      .send({ type: 'BANKER', leagueFixtureId: fixtureIds[1] });
    expect(res.status).toBe(201);

    const used = await request(app)
      .get(`/api/v1/leagues/${slug}/rounds/${seq}/boosters`)
      .set('Cookie', owner.cookie);
    expect(used.body.used).toHaveLength(1);
    expect(used.body.used[0].leagueFixtureId).toBe(fixtureIds[1]);
  });

  it('still counts as ONE use after moving', async () => {
    const res = await request(app)
      .get(`/api/v1/leagues/${slug}/boosters`)
      .set('Cookie', owner.cookie);
    const banker = res.body.boosters.find((b: { type: string }) => b.type === 'BANKER');
    expect(banker.used).toBe(1);
  });

  it('refuses a booster the league does not offer', async () => {
    const res = await request(app)
      .post(`/api/v1/leagues/${slug}/rounds/${seq}/booster`)
      .set('Cookie', owner.cookie)
      .send({ type: 'TRIPLE_POINTS', leagueFixtureId: fixtureIds[0] });
    expect(res.status).toBe(409);
    expect(res.body.type).toContain('booster-not-offered');
  });

  it('refuses a fixture-level booster with no fixture', async () => {
    const res = await request(app)
      .post(`/api/v1/leagues/${slug}/rounds/${seq}/booster`)
      .set('Cookie', owner.cookie)
      .send({ type: 'BANKER' });
    expect(res.status).toBe(409);
    expect(res.body.type).toContain('booster-needs-fixture');
  });

  it('refuses a fixture from a different round', async () => {
    const other = await request(app)
      .get(`/api/v1/leagues/${slug}/rounds/2`)
      .set('Cookie', owner.cookie);
    const foreign = other.body.round.fixtures[0].leagueFixtureId;

    const res = await request(app)
      .post(`/api/v1/leagues/${slug}/rounds/${seq}/booster`)
      .set('Cookie', owner.cookie)
      .send({ type: 'BANKER', leagueFixtureId: foreign });
    expect(res.status).toBe(404);
  });
});

describe('revoking', () => {
  it('returns the use to the budget', async () => {
    const del = await request(app)
      .delete(`/api/v1/leagues/${slug}/rounds/${seq}/booster/BANKER`)
      .set('Cookie', owner.cookie);
    expect(del.status).toBe(204);

    const res = await request(app)
      .get(`/api/v1/leagues/${slug}/boosters`)
      .set('Cookie', owner.cookie);
    const banker = res.body.boosters.find((b: { type: string }) => b.type === 'BANKER');
    // Retracting before the deadline must genuinely give the booster back.
    expect(banker.used).toBe(0);
    expect(banker.remaining).toBe(5);
  });

  it('detaches it from the prediction', async () => {
    const used = await request(app)
      .get(`/api/v1/leagues/${slug}/rounds/${seq}/boosters`)
      .set('Cookie', owner.cookie);
    expect(used.body.used).toHaveLength(0);
  });

  it('404s when nothing is placed', async () => {
    const res = await request(app)
      .delete(`/api/v1/leagues/${slug}/rounds/${seq}/booster/BANKER`)
      .set('Cookie', owner.cookie);
    expect(res.status).toBe(404);
  });
});

describe('the value is snapshotted, not looked up later (§6)', () => {
  it('keeps a spent booster at its original value after a rules change', async () => {
    await request(app)
      .post(`/api/v1/leagues/${slug}/rounds/${seq}/booster`)
      .set('Cookie', owner.cookie)
      .send({ type: 'BANKER', leagueFixtureId: fixtureIds[0] });

    const before = await prisma.boosterUsage.findFirstOrThrow({
      where: { userId: owner.id, revokedAt: null },
    });
    expect(Number(before.resolvedValue)).toBe(2);

    // The league now makes bankers worth 3.
    const rules = await request(app)
      .get(`/api/v1/leagues/${slug}/rules`)
      .set('Cookie', owner.cookie);
    const config = rules.body.rules.config;
    config.boosters.find((b: { type: string }) => b.type === 'BANKER').value = 3;
    await request(app)
      .post(`/api/v1/leagues/${slug}/rules`)
      .set('Cookie', owner.cookie)
      .send({ config });

    const after = await prisma.boosterUsage.findUniqueOrThrow({ where: { id: before.id } });
    // A 2x banker stays a 2x banker. Otherwise a rules change would silently
    // re-price boosters people had already committed.
    expect(Number(after.resolvedValue)).toBe(2);
  });
});

describe('activity feed (§15.3)', () => {
  it('shows rule changes in plain English, to every member', async () => {
    const res = await request(app)
      .get(`/api/v1/leagues/${slug}/activity`)
      .set('Cookie', owner.cookie);
    expect(res.status).toBe(200);

    const summaries = res.body.activity.map((a: { summary: string }) => a.summary);
    expect(summaries).toContain('created the league');
    expect(summaries.some((s: string) => s.includes('scoring rules'))).toBe(true);
    // Not a JSON diff — the feed is for members, not developers.
    expect(JSON.stringify(res.body)).not.toContain('schemaVersion');
  });
});
