const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const now = new Date();

prisma.quest
  .findMany({
    select: { id: true, title: true, status: true, startsAt: true, endsAt: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  })
  .then((quests) => {
    console.log('now:', now.toISOString());
    for (const q of quests) {
      const hidden =
        (q.startsAt && q.startsAt > now) || (q.endsAt && q.endsAt < now);
      console.log({
        title: q.title,
        status: q.status,
        startsAt: q.startsAt,
        endsAt: q.endsAt,
        hiddenFromPublicList: hidden,
      });
    }
  })
  .finally(() => prisma.$disconnect());
