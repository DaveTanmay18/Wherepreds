import { prisma } from '../src/index.js';

/**
 * Grant or revoke platform administrator rights.
 *
 *   pnpm --filter @wp/db run make-admin you@example.com
 *   pnpm --filter @wp/db run make-admin you@example.com --revoke
 *
 * ⚠️ Deliberately a CLI and not an API route. There is no "promote to admin"
 * endpoint anywhere in the product, so a compromised session — even an
 * existing admin's — cannot mint another administrator. Creating one requires
 * database credentials, which is a much higher bar than stealing a cookie.
 */
const [email, ...flags] = process.argv.slice(2);
const revoke = flags.includes('--revoke');

if (!email) {
  console.error('usage: make-admin <email> [--revoke]');
  process.exit(2);
}

const user = await prisma.user.findUnique({
  where: { email: email.toLowerCase() },
  select: { id: true, email: true, displayName: true, isAdmin: true },
});

if (!user) {
  console.error(`No user with email "${email}". Register the account first, then run this.`);
  process.exit(1);
}

if (user.isAdmin === !revoke) {
  console.warn(`${user.displayName} <${user.email}> is already ${revoke ? 'not ' : ''}an admin.`);
  process.exit(0);
}

await prisma.user.update({ where: { id: user.id }, data: { isAdmin: !revoke } });

// Recorded like any other privileged change. actorId is null because this ran
// from a shell, not a session — the absence of an actor IS the useful signal.
await prisma.auditLog.create({
  data: {
    action: revoke ? 'admin.revoke' : 'admin.grant',
    entityType: 'User',
    entityId: user.id,
    before: { isAdmin: user.isAdmin },
    after: { isAdmin: !revoke, via: 'make-admin CLI' },
  },
});

console.warn(
  `${revoke ? 'Revoked admin from' : 'Granted admin to'} ${user.displayName} <${user.email}>.`,
);
console.warn(
  '⚠️ Sign out and back in — the session cache holds the old isAdmin for up to 5 minutes.',
);

await prisma.$disconnect();
