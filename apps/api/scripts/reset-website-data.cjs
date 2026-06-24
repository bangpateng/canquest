/**
 * Reset CanQuest dev / test data in PostgreSQL (does NOT delete Canton parties on-chain).
 *
 *   cd apps/api
 *   node scripts/reset-website-data.cjs --dry-run
 *   node scripts/reset-website-data.cjs --apply --quests
 *   node scripts/reset-website-data.cjs --apply --wallet-history
 *   node scripts/reset-website-data.cjs --apply --quests --wallet-history
 *   node scripts/reset-website-data.cjs --apply --quests --demos   # also delete demo quests from seed scripts
 *   node scripts/reset-website-data.cjs --apply --users            # delete all non-admin users
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const apply = process.argv.includes('--apply');
const dryRun = !apply || process.argv.includes('--dry-run');
const doQuests = process.argv.includes('--quests');
const doWallet = process.argv.includes('--wallet-history');
const doDemos = process.argv.includes('--demos');
const doUsers = process.argv.includes('--users');
const doUsersAll = process.argv.includes('--users-all');

function protectedEmails() {
  const raw = process.env.ADMIN_EMAILS ?? '';
  const panel = process.env.ADMIN_PANEL_EMAIL ?? '';
  return new Set(
    [...raw.split(','), panel]
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

async function counts() {
  return {
    users: await prisma.user.count(),
    quests: await prisma.quest.count(),
    questTasks: await prisma.questTask.count(),
    questSubmissions: await prisma.questSubmission.count(),
    questCompletions: await prisma.questCompletion.count(),
    winnerDraws: await prisma.winnerDraw.count(),
    inviteAssigned: await prisma.inviteCodePool.count({ where: { userId: { not: null } } }),
    ccTransactions: await prisma.ccTransaction.count(),
    ccBalances: await prisma.ccBalance.count(),
    refreshTokens: await prisma.refreshToken.count(),
  };
}

async function resetQuestProgress() {
  const r1 = await prisma.questCompletion.deleteMany({});
  const r2 = await prisma.questSubmission.deleteMany({});
  const r3 = await prisma.winnerDraw.deleteMany({});
  const r4 = await prisma.inviteCodePool.updateMany({
    data: { userId: null, assignedAt: null },
  });
  return {
    questCompletions: r1.count,
    questSubmissions: r2.count,
    winnerDraws: r3.count,
    inviteCodesUnassigned: r4.count,
  };
}

async function resetWalletHistory() {
  const r1 = await prisma.ccTransaction.deleteMany({});
  const r2 = await prisma.ccBalance.deleteMany({});
  return { ccTransactions: r1.count, ccBalances: r2.count };
}

async function deleteDemoQuests() {
  const demos = await prisma.quest.findMany({
    where: {
      OR: [
        { orgSlug: { in: ['demo', 'test', 'reward-demo'] } },
        { title: { contains: 'demo', mode: 'insensitive' } },
        { title: { contains: 'test quest', mode: 'insensitive' } },
      ],
    },
    select: { id: true, title: true },
  });
  if (demos.length === 0) return { questsDeleted: 0, titles: [] };
  const ids = demos.map((q) => q.id);
  const r = await prisma.quest.deleteMany({ where: { id: { in: ids } } });
  return { questsDeleted: r.count, titles: demos.map((q) => q.title) };
}

async function resetWalletInvitesAndAllocations() {
  const invites = await prisma.walletInviteCode.updateMany({
    data: {
      redeemedAt: null,
      redeemedById: null,
      reservedAt: null,
      reservedById: null,
    },
  });
  const allocs = await prisma.walletAllocationLog.deleteMany({});
  return {
    walletInvitesReset: invites.count,
    walletAllocationLogsDeleted: allocs.count,
  };
}

async function deleteNonAdminUsers() {
  const guard = protectedEmails();
  const users = await prisma.user.findMany({
    select: { id: true, email: true, isAdmin: true },
  });
  const ids = users
    .filter((u) => !u.isAdmin && !guard.has(u.email.toLowerCase()))
    .map((u) => u.id);
  if (ids.length === 0) return { usersDeleted: 0 };
  await prisma.referralReward.deleteMany({ where: { OR: [{ referrerId: { in: ids } }, { referredUserId: { in: ids } }] } });
  const r = await prisma.user.deleteMany({ where: { id: { in: ids } } });
  return { usersDeleted: r.count };
}

async function deleteAllUsers() {
  const n = await prisma.user.count();
  if (n === 0) return { usersDeleted: 0 };
  await prisma.referralReward.deleteMany({});
  const r = await prisma.user.deleteMany({});
  return { usersDeleted: r.count };
}

async function main() {
  if (!doQuests && !doWallet && !doDemos && !doUsers && !doUsersAll) {
    console.log(`
CanQuest data reset — pick at least one flag:

  --quests           Quest completions, task submissions, winner draws; unassign invite codes
  --wallet-history   CcTransaction + CcBalance rows (Canton wallet parties unchanged; inbound sync refills balance)
  --demos            Delete quests whose title/org looks like demo/test
  --users            Delete all users except admin (ADMIN_EMAILS / isAdmin)
  --users-all        Delete EVERY user row (including admin) — full re-register

With --users or --users-all, wallet invite reservations and allocation logs are also cleared.

Examples:
  node scripts/reset-website-data.cjs --dry-run --quests --wallet-history --users-all
  node scripts/reset-website-data.cjs --apply --quests --wallet-history --users-all
`);
    process.exit(0);
  }

  console.log(apply ? '=== APPLY reset ===' : '=== DRY RUN (pass --apply to execute) ===\n');
  const before = await counts();
  console.log('Current DB counts:', before);

  if (dryRun && !apply) {
    console.log('\nNo changes written. Re-run with --apply to execute.');
    await prisma.$disconnect();
    return;
  }

  const results = {};

  if (doQuests) {
    console.log('\n→ Reset quest progress…');
    results.quests = await resetQuestProgress();
    console.log(results.quests);
  }

  if (doWallet) {
    console.log('\n→ Clear wallet history mirror (DB only)…');
    results.wallet = await resetWalletHistory();
    console.log(results.wallet);
    console.log('  Tip: CC balance will repopulate from Splice on next inbound sync / balance fetch.');
  }

  if (doDemos) {
    console.log('\n→ Delete demo/test quests…');
    results.demos = await deleteDemoQuests();
    console.log(results.demos);
  }

  if (doUsers || doUsersAll) {
    console.log('\n→ Reset wallet invites + daily allocation logs…');
    results.walletInvites = await resetWalletInvitesAndAllocations();
    console.log(results.walletInvites);
  }

  if (doUsersAll) {
    console.log('\n→ Delete ALL users (including admin)…');
    results.users = await deleteAllUsers();
    console.log(results.users);
  } else if (doUsers) {
    console.log('\n→ Delete non-admin users…');
    results.users = await deleteNonAdminUsers();
    console.log(results.users);
  }

  const after = await counts();
  console.log('\nAfter:', after);
  console.log('\nNot touched: Canton parties/wallets on validator, uploaded DAR on participant, on-chain DAML contracts.');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
