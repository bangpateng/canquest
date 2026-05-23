const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.user
  .findMany({
    select: { id: true, email: true, displayName: true, emailVerified: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })
  .then((u) => console.log(JSON.stringify(u, null, 2)))
  .finally(() => p.$disconnect());
