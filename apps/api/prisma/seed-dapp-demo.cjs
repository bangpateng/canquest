/**
 * Demo data untuk capture mockup dapp-full (LOCAL DB canquest_ui only).
 * Run: DATABASE_URL=postgresql://canquest:canquest_dev@127.0.0.1:5432/canquest_ui \
 *      node prisma/seed-dapp-demo.cjs
 * Idempotent — aman dijalankan berulang.
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();
const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const ago = (days, hours = 0) => new Date(now - days * DAY - hours * 3600_000);
const ahead = (days) => new Date(now + days * DAY);

const CUSTODIAL_EMAIL = 'uicapture.custodial@gmail.com';
const CUSTODIAL_PARTY =
  'uicapture-cust::1220b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9';

const LEADERBOARD_USERS = [
  { name: 'Rizky Pratama', points: 47 },
  { name: 'Sari Wulandari', points: 39 },
  { name: 'Dimas Anggara', points: 34 },
  { name: 'Nadia Putri', points: 28 },
  { name: 'Bagas Saputra', points: 22 },
  { name: 'Melati Rahayu', points: 17 },
  { name: 'Fajar Nugroho', points: 12 },
  { name: 'Intan Permata', points: 8 },
];

const TXS = [
  { cc: 25, type: 'QUEST_REWARD', desc: 'Quest reward: Swap & Earn with NovaPay', days: 0, hours: 5 },
  { cc: -2, type: 'TRANSFER_OUT', desc: 'Send CC to rizky.demo-party', days: 1, hours: 2 },
  { cc: 5, type: 'TRANSFER_IN', desc: 'Receive CC from sari.demo-party', days: 1, hours: 9 },
  { cc: -30, type: 'CC_LOCK', desc: 'Lock 30 CC for Earn access', days: 3, hours: 1 },
  { cc: -10.5, type: 'SWAP_OUT', desc: 'Swap CC → USDCx', days: 4, hours: 4 },
  { cc: 15, type: 'SPIN_REWARD', desc: 'Spin reward: lucky draw', days: 6, hours: 3 },
  { cc: 50, type: 'AIRDROP', desc: 'MintX campaign airdrop', days: 8, hours: 6 },
  { cc: -1, type: 'TRANSFER_OUT', desc: 'Send CC to dimas.demo-party', days: 10, hours: 8 },
  { cc: 30, type: 'CC_UNLOCK', desc: 'Lock expired — CC returned', days: 12, hours: 2 },
  { cc: 10, type: 'QUEST_REWARD', desc: 'Quest reward: Daily check-in streak', days: 14, hours: 5 },
];

async function main() {
  // ── 1. User custodial (untuk wallet dashboard + modal swap/send/lock) ──
  let cust = await prisma.user.findUnique({ where: { email: CUSTODIAL_EMAIL } });
  if (!cust) {
    const hash = await bcrypt.hash('UiCapture2026!x', 10);
    cust = await prisma.user.create({
      data: {
        email: CUSTODIAL_EMAIL,
        passwordHash: hash,
        displayName: 'Ui Capture',
        emailVerified: true,
        referralCode: 'UICAP22',
        cantonPartyId: CUSTODIAL_PARTY,
        walletKind: 'custodial',
        earnPoints: 420,
      },
    });
    console.log('  + user custodial', cust.id);
  } else {
    await prisma.user.update({
      where: { id: cust.id },
      data: { cantonPartyId: CUSTODIAL_PARTY, walletKind: 'custodial', earnPoints: 420 },
    });
    console.log('  = user custodial exists');
  }

  // ── 2. Saldo CC + USDCx ──
  await prisma.ccBalance.upsert({
    where: { userId: cust.id },
    create: { userId: cust.id, balanceMicroCc: 12_500_500_000n },
    update: { balanceMicroCc: 12_500_500_000n },
  });
  await prisma.cantexTokenBalance.upsert({
    where: {
      userId_instrumentId_instrumentAdmin: {
        userId: cust.id,
        instrumentId: 'USDCx',
        instrumentAdmin: 'DSO::1220demo',
      },
    },
    create: { userId: cust.id, instrumentId: 'USDCx', instrumentAdmin: 'DSO::1220demo', balance: 2140 },
    update: { balance: 2140 },
  });
  console.log('  + balances CC 12500.50 / USDCx 2140');

  // ── 3. Lock aktif 30 CC (15d) ──
  const existingLock = await prisma.ccLock.findFirst({
    where: { userId: cust.id, status: 'LOCKED' },
  });
  if (!existingLock) {
    await prisma.ccLock.create({
      data: {
        ownerParty: CUSTODIAL_PARTY,
        userId: cust.id,
        amountCc: 30,
        termKey: '15d',
        lockSeconds: 15 * 24 * 3600,
        lockedAt: ago(2),
        expiresAt: ahead(13),
        status: 'LOCKED',
      },
    });
    console.log('  + cc lock 30 CC');
  }

  // ── 4. Transaksi activity ──
  const txCount = await prisma.ccTransaction.count({ where: { userId: cust.id } });
  if (txCount === 0) {
    let i = 0;
    for (const t of TXS) {
      i++;
      // referenceId & ledgerTxId WAJIB non-NULL — filter histori memakai
      // Prisma startsWith yang meng-exclude baris NULL (semantik SQL NULL).
      const m = t.desc.match(/to (\S+)|from (\S+)/);
      await prisma.ccTransaction.create({
        data: {
          userId: cust.id,
          amountMicroCc: BigInt(Math.round(t.cc * 1_000_000)),
          type: t.type,
          description: t.desc,
          status: 'COMPLETED',
          referenceId:
            t.type === 'TRANSFER_IN' || t.type === 'TRANSFER_OUT'
              ? m ? m[1] || m[2] : 'demo-party'
              : 'demo-ref',
          ledgerTxId: 'demo-tx-' + i,
          cantonUpdateId: 'demo-upd-' + i,
          settledAt: ago(t.days, t.hours),
          createdAt: ago(t.days, t.hours),
        },
      });
    }
    console.log(`  + ${TXS.length} transaksi CC`);
  }

  // ── 5. Quest completion (state claim di detail quest) ──
  const novapay = await prisma.quest.findFirst({ where: { title: 'Swap & Earn with NovaPay' } });
  const mintx = await prisma.quest.findFirst({ where: { title: 'MintX CC + Code Raffle' } });
  for (const q of [novapay, mintx]) {
    if (!q) continue;
    await prisma.questCompletion.upsert({
      where: { userId_questId: { userId: cust.id, questId: q.id } },
      create: { userId: cust.id, questId: q.id, rewardMicroCc: 0n },
      update: {},
    });
  }
  console.log('  + quest completions');

  // ── 6. User leaderboard + submissions VERIFIED (sumber poin) ──
  const allTasks = await prisma.questTask.findMany({
    where: { quest: { questKind: { in: ['CAMPAIGN', 'EARN_HUB'] } } },
    select: { id: true, points: true, questId: true },
    orderBy: { points: 'desc' },
  });

  let made = 0;
  for (let i = 0; i < LEADERBOARD_USERS.length; i++) {
    const u = LEADERBOARD_USERS[i];
    const email = `lb${i + 1}.uicapdemo@gmail.com`;
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      const hash = await bcrypt.hash('LbNoLogin-' + Math.random().toString(36).slice(2), 10);
      user = await prisma.user.create({
        data: {
          email,
          passwordHash: hash,
          displayName: u.name,
          emailVerified: true,
          referralCode: ('LB' + i + Math.random().toString(36).slice(2, 6)).toUpperCase(),
          cantonPartyId: `lb${i + 1}-demo::1220${i}f${i}e${i}d${i}c${i}b${i}a${i}99887766554433221100aabbccddeeff`,
          earnPoints: u.points * 10,
        },
      });
      made++;
    }
    await prisma.user.update({ where: { id: user.id }, data: { earnPoints: u.points * 10 } });

    // submissions sampai total poin task >= target
    let target = u.points;
    const have = await prisma.questSubmission.count({ where: { userId: user.id } });
    if (have === 0) {
      let acc = 0;
      for (const t of allTasks) {
        if (acc >= target) break;
        await prisma.questSubmission.create({
          data: {
            userId: user.id,
            questId: t.questId,
            taskId: t.id,
            status: 'VERIFIED',
            submittedAt: ago(3),
            verifiedAt: ago(2),
          },
        });
        acc += t.points;
      }
    }
  }
  console.log(`  + leaderboard users (${made} baru)`);
  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
