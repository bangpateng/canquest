/* Wipes all auth rows in the local dev DB — run: node scripts/clear-dev-users.cjs (from apps/api) */
const { PrismaClient } = require('@prisma/client');

async function main() {
  const prisma = new PrismaClient();
  const rt = await prisma.refreshToken.deleteMany({});
  const users = await prisma.user.deleteMany({});
  console.log(`Removed ${rt.count} refresh token(s) and ${users.count} user(s).`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
