const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const quest = await prisma.quest.findFirst({
    where: { title: { in: ['tellaW', 'Naxweb'] } },
    include: { tasks: true },
  });
  console.log('quest', quest?.title, quest?.id, 'tasks', quest?.tasks?.length);

  const completions = await prisma.questCompletion.findMany({
    orderBy: { completedAt: 'desc' },
    take: 5,
    include: { user: { select: { email: true, cantonPartyId: true } } },
  });
  for (const c of completions) {
    console.log({
      email: c.user.email,
      party: c.user.cantonPartyId,
      questId: c.questId,
      participation: c.ledgerParticipationId,
      completedAt: c.completedAt,
    });
  }
}

main().finally(() => prisma.$disconnect());
