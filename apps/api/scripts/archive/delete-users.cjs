/**
 * Delete specific users by email (VPS / local).
 *
 *   cd apps/api
 *   node scripts/delete-users.cjs user1@example.com user2@example.com
 *
 * Skips isAdmin users and ADMIN_EMAILS / ADMIN_PANEL_EMAIL from .env
 */
const { PrismaClient } = require('@prisma/client');

function protectedEmails() {
  const raw = process.env.ADMIN_EMAILS ?? '';
  const panel = process.env.ADMIN_PANEL_EMAIL ?? '';
  return new Set(
    [...raw.split(','), panel]
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

async function main() {
  const emails = process.argv.slice(2).map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (emails.length === 0) {
    console.error('Usage: node scripts/delete-users.cjs email1@example.com [email2 ...]');
    process.exit(1);
  }

  const prisma = new PrismaClient();
  const guard = protectedEmails();

  const users = await prisma.user.findMany({
    where: { email: { in: emails, mode: 'insensitive' } },
    select: { id: true, email: true, isAdmin: true },
  });

  const blocked = users.filter((u) => u.isAdmin || guard.has(u.email.toLowerCase()));
  const toDelete = users.filter((u) => !u.isAdmin && !guard.has(u.email.toLowerCase()));
  const foundEmails = new Set(users.map((u) => u.email.toLowerCase()));
  const notFound = emails.filter((e) => !foundEmails.has(e));

  if (blocked.length) {
    console.warn('Skipped (admin):', blocked.map((u) => u.email).join(', '));
  }
  if (notFound.length) {
    console.warn('Not found:', notFound.join(', '));
  }
  if (toDelete.length === 0) {
    console.log('Nothing deleted.');
    await prisma.$disconnect();
    return;
  }

  const ids = toDelete.map((u) => u.id);
  await prisma.inviteCodePool.updateMany({
    where: { userId: { in: ids } },
    data: { userId: null, assignedAt: null },
  });
  const result = await prisma.user.deleteMany({ where: { id: { in: ids } } });
  console.log(`Deleted ${result.count} user(s):`, toDelete.map((u) => u.email).join(', '));
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
