/**
 * Delete all quests except the one titled "Alpend".
 * Run: node scripts/keep-alpend-quest.cjs
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const keep = await prisma.quest.findFirst({
    where: { title: { equals: 'Alpend', mode: 'insensitive' } },
    include: { tasks: true },
  });

  if (!keep) {
    console.error('No quest titled "Alpend" found. Nothing deleted.');
    process.exit(1);
  }

  const deleted = await prisma.quest.deleteMany({
    where: { id: { not: keep.id } },
  });

  console.log(`Kept: "${keep.title}" (${keep.id}), ${keep.tasks.length} tasks`);
  console.log(`Deleted ${deleted.count} other quest(s).`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
