import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { prisma } from '@wp/db';
import { createApp } from '../app.js';

const app = createApp({ webOrigin: 'http://localhost:5173' });

const unique = `t${Date.now()}${Math.floor(Math.random() * 1000)}`;
const EMAIL = `${unique}@example.test`;
const USERNAME = unique.slice(0, 20);
const PASSWORD = 'correct-horse-battery';

afterAll(async () => {
  // Scoped to THIS file's user. Vitest runs files in parallel, so a broad
  // delete here would rip the rug out from under leagues.test.ts mid-run.
  await prisma.user.deleteMany({ where: { email: EMAIL } });
  await prisma.$disconnect();
});

describe('health', () => {
  it('reports database connectivity', async () => {
    const res = await request(app).get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.checks.db).toBe('ok');
  });
});

describe('error format (RFC 9457)', () => {
  it('returns problem+json for an unknown route', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(res.body.type).toContain('/errors/not-found');
    expect(res.body.instance).toBe('/api/v1/nope');
  });

  it('reports EVERY validation problem at once, not just the first', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'nope', username: '!!', password: 'short' });

    expect(res.status).toBe(422);
    expect(res.body.title).toBe('Validation failed');
    const fields = res.body.errors.map((e: { field: string }) => e.field);
    expect(fields).toContain('email');
    expect(fields).toContain('username');
    expect(fields).toContain('password');
  });
});

describe('registration and sessions', () => {
  let cookie = '';

  it('registers a user and issues an httpOnly session cookie', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: EMAIL, username: USERNAME, password: PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body.user.username).toBe(USERNAME);
    expect(res.body.user).not.toHaveProperty('passwordHash');

    const setCookie = (res.headers['set-cookie'] as string[] | undefined)?.[0];
    expect(setCookie).toBeDefined();
    expect(setCookie).toMatch(/wp_session=/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    cookie = setCookie!;
  });

  it('resolves the session on a subsequent request', async () => {
    const res = await request(app).get('/api/v1/auth/session').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(EMAIL);
  });

  it('rejects an anonymous request to a protected route', async () => {
    const res = await request(app).get('/api/v1/auth/session');
    expect(res.status).toBe(401);
    expect(res.body.type).toContain('/errors/unauthorized');
  });

  it('refuses a duplicate email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: EMAIL, username: `${USERNAME}x`, password: PASSWORD });

    expect(res.status).toBe(409);
    expect(res.body.errors[0].field).toBe('email');
  });

  it('logs in with the right password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: EMAIL, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(EMAIL);
  });

  it('refuses a wrong password without revealing which field was wrong', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: EMAIL, password: 'definitely-not-it' });
    expect(res.status).toBe(401);
    expect(res.body.detail).toBe('Email or password is incorrect.');
  });

  it('gives the same answer for an unknown email', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@example.test', password: PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.detail).toBe('Email or password is incorrect.');
  });

  it('destroys the session on logout, server-side', async () => {
    const logout = await request(app).post('/api/v1/auth/logout').set('Cookie', cookie);
    expect(logout.status).toBe(204);

    // The point of opaque server-side sessions: presenting the OLD cookie must
    // now fail. A JWT would still verify here (§15.1).
    const after = await request(app).get('/api/v1/auth/session').set('Cookie', cookie);
    expect(after.status).toBe(401);
  });
});
