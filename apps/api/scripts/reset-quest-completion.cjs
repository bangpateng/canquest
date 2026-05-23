/**
 * Delete quest completion so user can submit again. Usage:
 *   node scripts/reset-quest-completion.cjs <email> [questId]
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const email = process.argv[2]?.toLowerCase();
const questIdArg = process.argv[3];

async function main() {
  if (!email) {
    console.error('Usage: node scripts/reset-quest-completion.cjs <email> [questId]');
    process.exit(1);
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    console.error('User not found:', email);
    process.exit(1);
  }

  let questId = questIdArg;
  if (!questId) {
    const quest = await prisma.quest.findFirst({ orderBy: { createdAt: 'desc' } });
    if (!quest) {
      console.error('No quests in DB');
      process.exit(1);
    }
    questId = quest.id;
  }

  const deleted = await prisma.questCompletion.deleteMany({
    where: { userId: user.id, questId },
  });

  console.log(`Deleted ${deleted.count} completion(s) for ${email} quest=${questId}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
