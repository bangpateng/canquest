/**
 * Reset canton Party ID and username for a specific user (by email).
 * Keeps the account — just clears wallet data so you can re-run "Generate Wallet".
 *
 * Usage (from apps/api):
 *   node scripts/reset-my-wallet.cjs your@email.com
 */
const { PrismaClient } = require('@prisma/client');

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: node scripts/reset-my-wallet.cjs <email>');
    process.exit(1);
  }

  const prisma = new PrismaClient();

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error(`No user found with email: ${email}`);
    await prisma.$disconnect();
    process.exit(1);
  }

  const updated = await prisma.user.update({
    where: { email },
    data: {
      cantonPartyId: null,
      username: null,
    },
  });

  console.log(`✓ Wallet reset for: ${updated.email}`);
  console.log(`  cantonPartyId → null`);
  console.log(`  username      → null`);
  console.log(`\nYou can now open /wallet and click "Generate Wallet" again.`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
