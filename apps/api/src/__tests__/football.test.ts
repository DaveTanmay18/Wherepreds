import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '@wp/db';
import { createApp } from '../app.js';

const app = createApp({ webOrigin: 'http://localhost:5173' });
afterAll(() => prisma.$disconnect());

describe('football endpoints', () => {
  it('lists the six supported competitions, UCL with a null country', async () => {
    const res = await request(app).get('/api/v1/competitions');
    expect(res.status).toBe(200);
    expect(res.body.competitions).toHaveLength(6);

    const ucl = res.body.competitions.find((c: { slug: string }) => c.slug === 'champions-league');
    expect(ucl.country).toBeNull();
    expect(ucl.confederation).toBe('UEFA');
    expect(res.headers['cache-control']).toContain('stale-while-revalidate');
  });

  it('exposes UCL rounds with LEAGUE_PHASE typed correctly', async () => {
    const comps = await request(app).get('/api/v1/competitions');
    const ucl = comps.body.competitions.find(
      (c: { slug: string }) => c.slug === 'champions-league',
    );

    const res = await request(app).get(`/api/v1/seasons/${ucl.currentSeason.id}/rounds`);
    expect(res.status).toBe(200);

    const leaguePhase = res.body.rounds.filter((r: { type: string }) => r.type === 'LEAGUE_PHASE');
    expect(leaguePhase).toHaveLength(8);
    expect(
      leaguePhase.reduce((n: number, r: { fixtureCount: number }) => n + r.fixtureCount, 0),
    ).toBe(144);

    // Every knockout round is exactly ties x 2 legs, except the one-off final.
    //
    // ⚠️ Asserted only where the round EXISTS. A UCL season has no bracket
    // until the draw in December, so a freshly ingested season legitimately
    // contains nothing but the league phase (§10.5). Asserting the bracket
    // unconditionally made this test fail every August and pass every March,
    // which says nothing about the code. Where a round does exist its shape is
    // still checked exactly.
    const byType = Object.fromEntries(
      res.body.rounds.map((r: { type: string; fixtureCount: number }) => [r.type, r.fixtureCount]),
    );
    for (const [type, expected] of [
      ['ROUND_OF_16', 16],
      ['QUARTER_FINAL', 8],
      ['SEMI_FINAL', 4],
      ['FINAL', 1],
    ] as const) {
      if (byType[type] !== undefined) expect(byType[type]).toBe(expected);
    }
  });

  it('serves a league table', async () => {
    const comps = await request(app).get('/api/v1/competitions');
    const pl = comps.body.competitions.find((c: { slug: string }) => c.slug === 'premier-league');
    const res = await request(app).get(`/api/v1/seasons/${pl.currentSeason.id}/standings`);
    expect(res.status).toBe(200);
    expect(res.body.standings).toHaveLength(20);
    expect(res.body.standings[0].position).toBe(1);
    expect(res.body.standings[0].team.name).toBeTruthy();
  });

  it('paginates fixtures with a cursor, never an offset', async () => {
    const first = await request(app).get('/api/v1/fixtures?limit=5');
    expect(first.status).toBe(200);
    expect(first.body.fixtures).toHaveLength(5);
    expect(first.body.nextCursor).toBeTruthy();

    const second = await request(app).get(
      `/api/v1/fixtures?limit=5&cursor=${first.body.nextCursor}`,
    );
    const firstIds = first.body.fixtures.map((f: { id: string }) => f.id);
    const secondIds = second.body.fixtures.map((f: { id: string }) => f.id);
    expect(secondIds.some((id: string) => firstIds.includes(id))).toBe(false);
  });

  it('never exposes a fullTime score field', async () => {
    const res = await request(app).get('/api/v1/fixtures?limit=1');
    const fixture = res.body.fixtures[0];
    // score.home is the 90-minute score from regularTime. `fullTime` — which
    // sums in extra time and penalties — must not appear anywhere (P1-04b).
    expect(JSON.stringify(fixture)).not.toContain('fullTime');
    expect(fixture.score).toHaveProperty('home');
    expect(fixture.score).toHaveProperty('penalties');
  });

  it('404s an unknown competition with problem+json', async () => {
    const res = await request(app).get('/api/v1/competitions/not-a-league');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/problem\+json/);
  });
});
