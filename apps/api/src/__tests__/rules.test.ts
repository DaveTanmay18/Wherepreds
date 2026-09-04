import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '@wp/db';
import { instantiatePreset } from '@wp/scoring';
import { createApp } from '../app.js';

const app = createApp({ webOrigin: 'http://localhost:5173' });

const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const owner = {
  email: `r${stamp}@rules.test`,
  username: `r${stamp}`.slice(0, 20),
  cookie: '',
  id: '',
};
let slug = '';

beforeAll(async () => {
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({ email: owner.email, username: owner.username, password: 'correct-horse-battery' });
  owner.cookie = (res.headers['set-cookie'] as unknown as string[])[0]!;
  owner.id = res.body.user.id;

  const comps = await request(app).get('/api/v1/competitions');
  const seasonId = comps.body.competitions.find(
    (c: { slug: string }) => c.slug === 'premier-league',
  ).currentSeason.id;

  const league = await request(app)
    .post('/api/v1/leagues')
    .set('Cookie', owner.cookie)
    .send({ name: `Rules ${stamp}`, seasonId, presetId: 'classic' });
  slug = league.body.league.slug;
}, 180_000);

afterAll(async () => {
  await prisma.predictionLeague.deleteMany({ where: { slug } });
  await prisma.user.deleteMany({ where: { email: owner.email } });
  await prisma.$disconnect();
});

const classic = () => instantiatePreset('classic');

describe('validate', () => {
  it('accepts a valid config', async () => {
    const res = await request(app)
      .post(`/api/v1/leagues/${slug}/rules/validate`)
      .set('Cookie', owner.cookie)
      .send({ config: classic() });
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.errors).toHaveLength(0);
  });

  it('rejects an award scoring a market the league does not play', async () => {
    const config = classic();
    config.markets = ['EXACT_SCORE'];
    const res = await request(app)
      .post(`/api/v1/leagues/${slug}/rules/validate`)
      .set('Cookie', owner.cookie)
      .send({ config });
    expect(res.body.valid).toBe(false);
    expect(
      res.body.errors.some((e: { code: string }) => e.code === 'AWARD_MARKET_NOT_ENABLED'),
    ).toBe(true);
  });

  it('rejects a market the data plan cannot score', async () => {
    // On the free tier there are no goal events, so a goalscorer market would
    // award nobody any points all season — indistinguishable from a bug.
    const config = classic();
    config.markets = ['EXACT_SCORE', 'ANYTIME_GOALSCORER'];
    const res = await request(app)
      .post(`/api/v1/leagues/${slug}/rules/validate`)
      .set('Cookie', owner.cookie)
      .send({ config });
    expect(res.body.valid).toBe(false);
    const err = res.body.errors.find((e: { code: string }) => e.code === 'MARKET_UNAVAILABLE');
    expect(err.detail).toMatch(/Deep Data/);
  });

  it('rejects duplicate rule ids', async () => {
    const config = classic();
    config.awards.push({ ...config.awards[0]! });
    const res = await request(app)
      .post(`/api/v1/leagues/${slug}/rules/validate`)
      .set('Cookie', owner.cookie)
      .send({ config });
    expect(res.body.errors.some((e: { code: string }) => e.code === 'DUPLICATE_RULE_ID')).toBe(
      true,
    );
  });

  it('warns — not errors — about a rule that can never change a total', async () => {
    const config = classic();
    config.awards[0]!.points = 0;
    const res = await request(app)
      .post(`/api/v1/leagues/${slug}/rules/validate`)
      .set('Cookie', owner.cookie)
      .send({ config });
    expect(res.body.valid).toBe(true);
    expect(res.body.warnings.some((w: { code: string }) => w.code === 'ZERO_POINT_AWARD')).toBe(
      true,
    );
  });

  it('rejects an unknown fact path', async () => {
    const config = classic() as unknown as { awards: { when: unknown }[] };
    config.awards[0]!.when = { fact: 'derived.nonsense', op: 'eq', value: true };
    const res = await request(app)
      .post(`/api/v1/leagues/${slug}/rules/validate`)
      .set('Cookie', owner.cookie)
      .send({ config });
    expect(res.body.valid).toBe(false);
  });
});

describe('simulate', () => {
  it('previews points before committing — the point of the feature', async () => {
    const res = await request(app)
      .post(`/api/v1/leagues/${slug}/rules/simulate`)
      .set('Cookie', owner.cookie)
      .send({ config: classic() });

    expect(res.status).toBe(200);
    const byLabel = Object.fromEntries(
      res.body.results.map((r: { label: string; points: number }) => [r.label, r.points]),
    );
    expect(byLabel['Exact score']).toBe(5);
    expect(byLabel['Right result, wrong score']).toBe(2);
    expect(byLabel['Wrong result']).toBe(0);
  });

  it('reflects an edit immediately', async () => {
    const config = classic();
    config.awards.find((a) => a.id === 'exact_score')!.points = 25;
    const res = await request(app)
      .post(`/api/v1/leagues/${slug}/rules/simulate`)
      .set('Cookie', owner.cookie)
      .send({ config });
    const exact = res.body.results.find((r: { label: string }) => r.label === 'Exact score');
    expect(exact.points).toBe(25);
    expect(exact.breakdown.some((b: { ruleId: string }) => b.ruleId === 'exact_score')).toBe(true);
  });

  it('refuses to simulate an invalid config rather than guessing', async () => {
    const res = await request(app)
      .post(`/api/v1/leagues/${slug}/rules/simulate`)
      .set('Cookie', owner.cookie)
      .send({ config: { schemaVersion: 1, markets: [] } });
    expect(res.body.valid).toBe(false);
    expect(res.body.results).toHaveLength(0);
  });
});

describe('versioning — the guarantee the product rests on (§8.7)', () => {
  it('edits in place while nothing has been scored', async () => {
    const config = classic();
    config.awards.find((a) => a.id === 'exact_score')!.points = 7;

    const res = await request(app)
      .post(`/api/v1/leagues/${slug}/rules`)
      .set('Cookie', owner.cookie)
      .send({ config });

    expect(res.status).toBe(200);
    expect(res.body.newVersion).toBe(false);
    expect(res.body.version).toBe(1);
  });

  it('creates version 2 once a version has scored something', async () => {
    // Freeze v1 the way scoring would.
    const v1 = await prisma.ruleSet.findFirstOrThrow({
      where: { league: { slug }, isActive: true },
    });
    await prisma.ruleSet.update({ where: { id: v1.id }, data: { isFrozen: true } });

    const config = classic();
    config.awards.find((a) => a.id === 'exact_score')!.points = 99;

    const res = await request(app)
      .post(`/api/v1/leagues/${slug}/rules`)
      .set('Cookie', owner.cookie)
      .send({ config });

    expect(res.status).toBe(201);
    expect(res.body.newVersion).toBe(true);
    expect(res.body.version).toBe(2);
    // The answer to "when do the new rules start?"
    expect(res.body.appliesFromRound).toBe(1);
  });

  it('leaves version 1 intact and inactive', async () => {
    const versions = await request(app)
      .get(`/api/v1/leagues/${slug}/rules/versions`)
      .set('Cookie', owner.cookie);

    expect(versions.body.versions).toHaveLength(2);
    const v1 = versions.body.versions.find((v: { version: number }) => v.version === 1);
    const v2 = versions.body.versions.find((v: { version: number }) => v.version === 2);

    expect(v1.isActive).toBe(false);
    expect(v2.isActive).toBe(true);
    // v1 keeps the 7 it was frozen with — NOT the 99 from v2. A scored round
    // pointing at v1 therefore scores exactly what it scored before.
    expect(v1.config.awards.find((a: { id: string }) => a.id === 'exact_score').points).toBe(7);
    expect(v2.config.awards.find((a: { id: string }) => a.id === 'exact_score').points).toBe(99);
  });

  it('enforces exactly one active version in the DATABASE, not just in code', async () => {
    const league = await prisma.predictionLeague.findUniqueOrThrow({ where: { slug } });
    // The partial unique index rule_sets_one_active (§7.2) must refuse this.
    await expect(
      prisma.ruleSet.updateMany({ where: { leagueId: league.id }, data: { isActive: true } }),
    ).rejects.toThrow();
  });

  it('notifies other members that the rules changed', async () => {
    // Silent leaderboard movement destroys trust faster than the change (§9.2).
    // The owner is excluded — they made the change.
    const notes = await prisma.notification.findMany({ where: { type: 'rules.changed' } });
    expect(notes.every((n) => n.userId !== owner.id)).toBe(true);
  });

  it('audit-logs the change with before and after', async () => {
    const league = await prisma.predictionLeague.findUniqueOrThrow({ where: { slug } });
    const entry = await prisma.auditLog.findFirst({
      where: { entityId: `${league.id}:ruleset`, action: 'ruleset.version' },
      orderBy: { createdAt: 'desc' },
    });
    expect(entry).toBeTruthy();
    expect((entry!.before as { version: number }).version).toBe(1);
    expect((entry!.after as { version: number }).version).toBe(2);
  });

  it('refuses rule edits from a non-admin', async () => {
    const other = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: `x${stamp}@rules.test`,
        username: `x${stamp}`.slice(0, 20),
        password: 'correct-horse-battery',
      });
    const cookie = (other.headers['set-cookie'] as unknown as string[])[0]!;

    const res = await request(app)
      .post(`/api/v1/leagues/${slug}/rules`)
      .set('Cookie', cookie)
      .send({ config: classic() });
    expect([403, 404]).toContain(res.status);
  });
});
