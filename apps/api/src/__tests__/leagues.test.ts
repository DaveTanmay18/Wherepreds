import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '@wp/db';
import { createApp } from '../app.js';

const app = createApp({ webOrigin: 'http://localhost:5173' });

const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
const users = {
  owner: {
    email: `own${stamp}@example.test`,
    username: `own${stamp}`.slice(0, 20),
    cookie: '',
    id: '',
  },
  admin: {
    email: `adm${stamp}@example.test`,
    username: `adm${stamp}`.slice(0, 20),
    cookie: '',
    id: '',
  },
  member: {
    email: `mem${stamp}@example.test`,
    username: `mem${stamp}`.slice(0, 20),
    cookie: '',
    id: '',
  },
  outsider: {
    email: `out${stamp}@example.test`,
    username: `out${stamp}`.slice(0, 20),
    cookie: '',
    id: '',
  },
};
const PASSWORD = 'correct-horse-battery';

let slug = '';
let joinCode = '';
let seasonId = '';

async function signUp(u: { email: string; username: string; cookie: string; id: string }) {
  const res = await request(app)
    .post('/api/v1/auth/register')
    .send({ email: u.email, username: u.username, password: PASSWORD });
  expect(res.status).toBe(201);
  u.cookie = (res.headers['set-cookie'] as unknown as string[])[0]!;
  u.id = res.body.user.id;
}

beforeAll(async () => {
  for (const u of Object.values(users)) await signUp(u);

  const comps = await request(app).get('/api/v1/competitions');
  seasonId = comps.body.competitions.find((c: { slug: string }) => c.slug === 'premier-league')
    .currentSeason.id;
}, 90_000);

afterAll(async () => {
  await prisma.predictionLeague.deleteMany({ where: { slug } });
  await prisma.user.deleteMany({
    where: { email: { in: Object.values(users).map((u) => u.email) } },
  });
  await prisma.$disconnect();
});

describe('presets', () => {
  it('offers five presets with plain-English summaries', async () => {
    const res = await request(app).get('/api/v1/rules/presets');
    expect(res.status).toBe(200);
    expect(res.body.presets).toHaveLength(5);
    const classic = res.body.presets.find((p: { id: string }) => p.id === 'classic');
    expect(classic.summary).toBeTruthy();
    expect(classic.highlights.length).toBeGreaterThan(0);
  });
});

describe('league creation', () => {
  it('creates a league from a preset, with rounds materialised', async () => {
    const res = await request(app)
      .post('/api/v1/leagues')
      .set('Cookie', users.owner.cookie)
      .send({
        name: `Test League ${stamp}`,
        seasonId,
        presetId: 'classic',
        visibility: 'UNLISTED',
      });

    expect(res.status).toBe(201);
    slug = res.body.league.slug;
    joinCode = res.body.league.joinCode;

    // 38 Premier League matchdays become 38 playable league rounds.
    expect(res.body.rounds).toBeGreaterThan(0);
    expect(joinCode).toMatch(/^[A-Z2-9]{6}$/);
    // Ambiguous characters are excluded — these get read aloud in a pub.
    expect(joinCode).not.toMatch(/[IO01]/);
  }, 60_000);

  it('creates a league fast enough to feel instant', async () => {
    // Regression guard. Materialising 38 rounds one row at a time took ~58s;
    // batching brought it under two. A minute-long spinner on the very first
    // thing a user does is not a performance nit, it is the product failing.
    const started = Date.now();
    const res = await request(app)
      .post('/api/v1/leagues')
      .set('Cookie', users.owner.cookie)
      .send({ name: `Speed Test ${stamp}`, seasonId, presetId: 'classic' });
    const elapsed = Date.now() - started;

    expect(res.status).toBe(201);
    expect(res.body.rounds).toBeGreaterThan(30);
    expect(elapsed).toBeLessThan(15_000);

    await prisma.predictionLeague.deleteMany({ where: { slug: res.body.league.slug } });
  }, 30_000);

  it('copies the preset config into the league rule set', async () => {
    const res = await request(app).get(`/api/v1/leagues/${slug}`).set('Cookie', users.owner.cookie);
    expect(res.status).toBe(200);
    expect(res.body.league.rules.version).toBe(1);
    expect(res.body.league.rules.isFrozen).toBe(false);

    const exact = res.body.league.rules.config.awards.find(
      (a: { id: string }) => a.id === 'exact_score',
    );
    expect(exact.points).toBe(5);
    expect(exact.group).toBe('result');
  });

  it('rejects a league with no name', async () => {
    const res = await request(app)
      .post('/api/v1/leagues')
      .set('Cookie', users.owner.cookie)
      .send({ name: 'x', seasonId, presetId: 'classic' });
    expect(res.status).toBe(422);
  });
});

describe('joining', () => {
  it('lets a second user join with the code', async () => {
    const res = await request(app)
      .post('/api/v1/leagues/join')
      .set('Cookie', users.member.cookie)
      .send({ joinCode });
    expect(res.status).toBe(201);
    expect(res.body.leagueSlug).toBe(slug);
  });

  it('is idempotent — joining twice does not duplicate membership', async () => {
    const res = await request(app)
      .post('/api/v1/leagues/join')
      .set('Cookie', users.member.cookie)
      .send({ joinCode });
    expect(res.status).toBe(200);
    expect(res.body.alreadyMember).toBe(true);

    const members = await request(app)
      .get(`/api/v1/leagues/${slug}/members`)
      .set('Cookie', users.owner.cookie);
    expect(members.body.members).toHaveLength(2);
  });

  it('refuses a bad code', async () => {
    const res = await request(app)
      .post('/api/v1/leagues/join')
      .set('Cookie', users.outsider.cookie)
      .send({ joinCode: 'ZZZZZZ' });
    expect(res.status).toBe(404);
  });

  it('shows the league in /leagues/mine for both members', async () => {
    for (const u of [users.owner, users.member]) {
      const res = await request(app).get('/api/v1/leagues/mine').set('Cookie', u.cookie);
      expect(res.body.leagues.some((l: { slug: string }) => l.slug === slug)).toBe(true);
    }
  });
});

/**
 * The §15.2 permission matrix. This is the test that proves authorization
 * lives in middleware rather than in conditional rendering — every denial here
 * is a server-side 401/403/404, reachable with nothing but a cookie and curl.
 */
describe('authorization matrix (§15.2)', () => {
  it('admin promotion is OWNER-only, not ADMIN', async () => {
    // Owner promotes member -> admin. Allowed.
    const promote = await request(app)
      .patch(`/api/v1/leagues/${slug}/members/${users.member.id}`)
      .set('Cookie', users.owner.cookie)
      .send({ role: 'ADMIN' });
    expect(promote.status).toBe(204);

    // That new admin may NOT promote anyone else — otherwise one compromised
    // admin account escalates the entire league.
    await request(app)
      .post('/api/v1/leagues/join')
      .set('Cookie', users.admin.cookie)
      .send({ joinCode });

    const escalate = await request(app)
      .patch(`/api/v1/leagues/${slug}/members/${users.admin.id}`)
      .set('Cookie', users.member.cookie)
      .send({ role: 'ADMIN' });
    expect(escalate.status).toBe(403);
  });

  it('MEMBER cannot edit league settings', async () => {
    const res = await request(app)
      .patch(`/api/v1/leagues/${slug}`)
      .set('Cookie', users.admin.cookie)
      .send({ name: 'Hijacked' });
    expect(res.status).toBe(403);
  });

  it('ADMIN can edit league settings', async () => {
    const res = await request(app)
      .patch(`/api/v1/leagues/${slug}`)
      .set('Cookie', users.member.cookie) // promoted to ADMIN above
      .send({ description: 'Updated by an admin' });
    expect(res.status).toBe(200);
  });

  it('ADMIN cannot delete the league — owner only', async () => {
    const res = await request(app)
      .delete(`/api/v1/leagues/${slug}`)
      .set('Cookie', users.member.cookie);
    expect(res.status).toBe(403);
  });

  it('nobody may modify the owner', async () => {
    const res = await request(app)
      .patch(`/api/v1/leagues/${slug}/members/${users.owner.id}`)
      .set('Cookie', users.member.cookie)
      .send({ status: 'REMOVED' });
    expect(res.status).toBe(403);
  });

  it('an outsider cannot read the member list', async () => {
    const res = await request(app)
      .get(`/api/v1/leagues/${slug}/members`)
      .set('Cookie', users.outsider.cookie);
    expect(res.status).toBe(403);
  });

  it('an outsider never sees the join code', async () => {
    const res = await request(app)
      .get(`/api/v1/leagues/${slug}`)
      .set('Cookie', users.outsider.cookie);
    expect(res.status).toBe(200);
    // The code IS the credential — leaking it to a non-member defeats the
    // point of an unlisted league.
    expect(res.body.league.joinCode).toBeNull();
    expect(res.body.league.viewer.isMember).toBe(false);
  });

  it('an anonymous request cannot create a league', async () => {
    const res = await request(app).post('/api/v1/leagues').send({ name: 'Anon', seasonId });
    expect(res.status).toBe(401);
  });

  it('the owner cannot leave without transferring first', async () => {
    const res = await request(app)
      .post(`/api/v1/leagues/${slug}/leave`)
      .set('Cookie', users.owner.cookie);
    expect(res.status).toBe(409);
    expect(res.body.type).toContain('owner-cannot-leave');
  });

  it('a PRIVATE league 404s for outsiders rather than 403', async () => {
    await request(app)
      .patch(`/api/v1/leagues/${slug}`)
      .set('Cookie', users.owner.cookie)
      .send({ visibility: 'PRIVATE' });

    const res = await request(app)
      .get(`/api/v1/leagues/${slug}`)
      .set('Cookie', users.outsider.cookie);
    // 403 would confirm the slug is real. For a private league, the correct
    // answer is that it does not exist.
    expect(res.status).toBe(404);
  });
});
