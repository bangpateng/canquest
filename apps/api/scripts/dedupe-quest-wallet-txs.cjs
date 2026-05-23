/**
 * Remove duplicate wallet history rows: TRANSFER_IN from inbound sync when
 * QUEST_REWARD already recorded the same amount recently.
 *
 * Usage:
 *   node scripts/dedupe-quest-wallet-txs.cjs           # dry-run
 *   node scripts/dedupe-quest-wallet-txs.cjs --apply
 */
const { PrismaClient } = require('@prisma/client');

const apply = process.argv.includes('--apply');
const WINDOW_MS = 15 * 60_000;

async function main() {
  const prisma = new PrismaClient();

  const rewards = await prisma.ccTransaction.findMany({
    where: { type: 'QUEST_REWARD' },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      userId: true,
      amountMicroCc: true,
      createdAt: true,
      description: true,
    },
  });

  const toDelete = [];

  for (const reward of rewards) {
    const windowStart = new Date(reward.createdAt.getTime() - WINDOW_MS);
    const windowEnd = new Date(reward.createdAt.getTime() + WINDOW_MS);

    const dupes = await prisma.ccTransaction.findMany({
      where: {
        userId: reward.userId,
        type: 'TRANSFER_IN',
        amountMicroCc: reward.amountMicroCc,
        createdAt: { gte: windowStart, lte: windowEnd },
        NOT: { id: reward.id },
      },
      select: { id: true, ledgerTxId: true, description: true, createdAt: true },
    });

    for (const d of dupes) {
      if (d.ledgerTxId?.startsWith('inbound-sync:')) {
        toDelete.push({ id: d.id, rewardId: reward.id, userId: reward.userId });
      }
    }
  }

  const unique = [...new Map(toDelete.map((d) => [d.id, d])).values()];

  console.log(`Found ${unique.length} duplicate TRANSFER_IN row(s) (inbound-sync within ±15m of QUEST_REWARD)`);
  for (const d of unique.slice(0, 20)) {
    console.log(' ', d.id, 'user=', d.userId.slice(0, 8), '…');
  }
  if (unique.length > 20) console.log(`  … and ${unique.length - 20} more`);

  if (!apply) {
    console.log('\nDry-run. Re-run with --apply to delete.');
    await prisma.$disconnect();
    return;
  }

  const deleted = await prisma.ccTransaction.deleteMany({
    where: { id: { in: unique.map((d) => d.id) } },
  });
  console.log(`Deleted ${deleted.count} row(s).`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
