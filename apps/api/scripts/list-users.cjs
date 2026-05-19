const { PrismaClient } = require('@prisma/client');
async function main() {
  const p = new PrismaClient();
  const users = await p.user.findMany({ select: { email: true, username: true, cantonPartyId: true } });
  console.table(users);
  await p.$disconnect();
}
main().catch(console.error);
