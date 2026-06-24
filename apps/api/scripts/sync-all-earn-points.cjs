/**
 * One-off: align User.earnPoints with verified tasks and quest completions.
 * Usage: node scripts/sync-all-earn-points.cjs
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function computePoints(userId) {
  const [submissions, completions] = await Promise.all([
    prisma.questSubmission.findMany({
      where: { userId, status: 'VERIFIED' },
      include: { task: { select: { points: true } } },
    }),
    prisma.questCompletion.findMany({
      where: { userId },
      include: { quest: { select: { rewardCc: true } } },
    }),
  ]);

  let total = submissions.reduce((s, sub) => s + sub.task.points, 0);
  total += completions.reduce((s, c) => s + Math.round(c.quest.rewardCc * 10), 0);
  return total;
}

async function main() {
  const users = await prisma.user.findMany({ select: { id: true, earnPoints: true } });
  let updated = 0;
  for (const u of users) {
    const computed = await computePoints(u.id);
    const final = Math.max(u.earnPoints, computed);
    if (final !== u.earnPoints) {
      await prisma.user.update({ where: { id: u.id }, data: { earnPoints: final } });
      updated++;
      console.log(`  ${u.id.slice(0, 8)}… ${u.earnPoints} → ${final}`);
    }
  }
  console.log(`Done. Updated ${updated}/${users.length} users.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
