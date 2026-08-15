const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const email = process.argv[2] || 'coinnyari@gmail.com';
const questId = process.argv[3] || 'cmpfxuh5t0004v2x0oymxdxc9';

prisma.user
  .findUnique({ where: { email } })
  .then((u) =>
    prisma.questSubmission.findMany({
      where: { userId: u.id, questId },
      select: { taskId: true, status: true },
    }),
  )
  .then((s) => {
    console.log(JSON.stringify(s, null, 2));
    const allVerified = s.length > 0 && s.every((x) => x.status === 'VERIFIED');
    console.log('allVerified:', allVerified, 'count:', s.length);
  })
  .finally(() => prisma.$disconnect());
