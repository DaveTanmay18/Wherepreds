import { LeagueRoundStatus, PredictionStatus, prisma } from '@wp/db';
import type { Logger } from '../logger.js';

/**
 * Notifications (tasks P5-09, P5-10, P5-11).
 *
 * The rule throughout: notify people about things they can still ACT on, or
 * that changed under them. Anything else is noise, and a prediction app that
 * cries wolf gets muted before the season that matters.
 */

/** Reminder points before a deadline, in minutes. */
const REMINDERS = [
  { minutes: 24 * 60, key: '24h', label: 'tomorrow' },
  { minutes: 3 * 60, key: '3h', label: 'in 3 hours' },
  { minutes: 30, key: '30m', label: 'in 30 minutes' },
];

/**
 * notify.deadline (task P5-10) — every 15 minutes.
 *
 * ⚠️ Only members who have NOT submitted are notified. Reminding someone to do
 * a thing they already did is the fastest way to get notifications switched
 * off entirely.
 */
export async function notifyDeadlines(log: Logger): Promise<{ sent: number }> {
  const [{ now }] = await prisma.$queryRaw<[{ now: Date }]>`SELECT now() AS now`;
  let sent = 0;

  for (const reminder of REMINDERS) {
    // A 20-minute window against a 15-minute schedule, so a slightly late run
    // still catches the round rather than skipping the reminder entirely.
    const from = new Date(now.getTime() + reminder.minutes * 60_000);
    const to = new Date(from.getTime() + 20 * 60_000);

    const rounds = await prisma.leagueRound.findMany({
      where: {
        status: LeagueRoundStatus.UPCOMING,
        isProvisional: false,
        deadlineAt: { gte: from, lt: to },
      },
      include: {
        round: { select: { name: true } },
        league: { select: { slug: true, name: true } },
        fixtures: { select: { id: true } },
      },
    });

    for (const lr of rounds) {
      if (lr.fixtures.length === 0) continue;

      const members = await prisma.leagueMembership.findMany({
        where: { leagueId: lr.leagueId, status: 'ACTIVE' },
        select: { userId: true },
      });

      const submitted = await prisma.prediction.findMany({
        where: {
          leagueFixtureId: { in: lr.fixtures.map((f) => f.id) },
          status: { in: [PredictionStatus.SUBMITTED, PredictionStatus.LOCKED] },
        },
        select: { userId: true, leagueFixtureId: true },
      });

      // "Done" means every fixture in the round, not just one — a half-filled
      // round is exactly who the reminder is for.
      const countByUser = new Map<string, number>();
      for (const p of submitted) {
        countByUser.set(p.userId, (countByUser.get(p.userId) ?? 0) + 1);
      }
      const pending = members.filter((m) => (countByUser.get(m.userId) ?? 0) < lr.fixtures.length);
      if (pending.length === 0) continue;

      const type = `deadline.${reminder.key}`;

      // Idempotent: a re-run inside the same window must not notify twice.
      const already = await prisma.notification.findMany({
        where: {
          type,
          userId: { in: pending.map((m) => m.userId) },
          data: { path: ['leagueRoundId'], equals: lr.id },
        },
        select: { userId: true },
      });
      const notifiedIds = new Set(already.map((n) => n.userId));
      const toNotify = pending.filter((m) => !notifiedIds.has(m.userId));
      if (toNotify.length === 0) continue;

      await prisma.notification.createMany({
        data: toNotify.map((m) => ({
          userId: m.userId,
          type,
          title: `${lr.round.name} closes ${reminder.label}`,
          body: `You have not finished your predictions for ${lr.league.name}.`,
          linkPath: `/leagues/${lr.league.slug}/predict/${lr.sequence}`,
          data: { leagueRoundId: lr.id },
        })),
      });

      sent += toNotify.length;
      log.info(
        { leagueRound: lr.id, reminder: reminder.key, notified: toNotify.length },
        'deadline reminder sent',
      );
    }
  }

  return { sent };
}

/**
 * Round-scored notification (task P5-11).
 *
 * Sent once per round per member, with their own points — the thing people
 * actually want to know, rather than "something happened".
 */
export async function notifyRoundScored(
  leagueRoundId: string,
  log: Logger,
): Promise<{ sent: number }> {
  const lr = await prisma.leagueRound.findUniqueOrThrow({
    where: { id: leagueRoundId },
    include: {
      round: { select: { name: true } },
      league: { select: { slug: true, name: true } },
    },
  });

  const entries = await prisma.standingEntry.findMany({
    where: { leagueRoundId },
    orderBy: { position: 'asc' },
  });
  if (entries.length === 0) return { sent: 0 };

  const type = 'round.scored';
  const already = await prisma.notification.findMany({
    where: { type, data: { path: ['leagueRoundId'], equals: leagueRoundId } },
    select: { userId: true },
  });
  const notified = new Set(already.map((n) => n.userId));

  const fresh = entries.filter((e) => !notified.has(e.userId));
  if (fresh.length === 0) return { sent: 0 };

  await prisma.notification.createMany({
    data: fresh.map((e) => ({
      userId: e.userId,
      type,
      title: `${lr.round.name} scored — ${Number(e.roundPoints)} points`,
      body: `You are ${ordinal(e.position)} in ${lr.league.name}.`,
      linkPath: `/leagues/${lr.league.slug}/rounds/${lr.sequence}`,
      data: { leagueRoundId },
    })),
  });

  log.info({ leagueRoundId, notified: fresh.length }, 'round-scored notifications sent');
  return { sent: fresh.length };
}

/**
 * Rescore notification (§9.2).
 *
 * ⚠️ Silent leaderboard movement destroys trust faster than the original error
 * does. If a corrected result changed someone's points, they are told.
 */
export async function notifyRescored(
  leagueRoundId: string,
  before: Map<string, number>,
  log: Logger,
): Promise<{ sent: number }> {
  const lr = await prisma.leagueRound.findUniqueOrThrow({
    where: { id: leagueRoundId },
    include: {
      round: { select: { name: true } },
      league: { select: { slug: true, name: true } },
    },
  });

  const entries = await prisma.standingEntry.findMany({ where: { leagueRoundId } });
  const changed = entries.filter((e) => {
    const prior = before.get(e.userId);
    return prior !== undefined && prior !== Number(e.roundPoints);
  });
  if (changed.length === 0) return { sent: 0 };

  await prisma.notification.createMany({
    data: changed.map((e) => {
      const prior = before.get(e.userId)!;
      const now = Number(e.roundPoints);
      return {
        userId: e.userId,
        type: 'round.rescored',
        title: `${lr.round.name} was rescored`,
        body: `A result was corrected. Your points changed from ${prior} to ${now}.`,
        linkPath: `/leagues/${lr.league.slug}/rounds/${lr.sequence}`,
        data: { leagueRoundId, from: prior, to: now },
      };
    }),
  });

  log.warn({ leagueRoundId, notified: changed.length }, 'rescore notifications sent');
  return { sent: changed.length };
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}
