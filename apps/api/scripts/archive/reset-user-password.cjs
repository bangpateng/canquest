/**
 * Reset a user's password (local dev only).
 * Usage: node scripts/reset-user-password.cjs email@example.com NewPassword123!
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const email = process.argv[2]?.trim().toLowerCase();
const password = process.argv[3];

if (!email || !password) {
  console.error('Usage: node scripts/reset-user-password.cjs <email> <password>');
  process.exit(1);
}

const prisma = new PrismaClient();

(async () => {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`User not found: ${email}`);
    process.exit(1);
  }
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await bcrypt.hash(password, 12),
      emailVerified: true,
    },
  });
  console.log(`OK: password updated for ${email} (${user.displayName ?? 'no name'})`);
})()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
