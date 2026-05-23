/**
 * Create 5 app test users (one per [DEMO] reward quest). Password: TestPass123!
 * Usage: node scripts/create-demo-test-users.cjs
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const PASSWORD = 'TestPass123!';
const PREFIX = '[DEMO]';

const USERS = [
  {
    email: 'demo-cc@test.local',
    displayName: 'Demo CC Tester',
    questTitle: `${PREFIX} Reward CC`,
    note: 'Reward CC + Party ID export',
  },
  {
    email: 'demo-waitlist@test.local',
    displayName: 'Demo Waitlist Tester',
    questTitle: `${PREFIX} Reward Waitlist`,
    note: 'Waitlist CSV export',
  },
  {
    email: 'demo-random@test.local',
    displayName: 'Demo Random Draw',
    questTitle: `${PREFIX} Invite Random Draw`,
    note: 'Admin random draw → code on quest page',
  },
  {
    email: 'demo-fcfs@test.local',
    displayName: 'Demo FCFS Tester',
    questTitle: `${PREFIX} Invite FCFS`,
    note: 'First submitters get code (max 5)',
  },
  {
    email: 'demo-mix@test.local',
    displayName: 'Demo CC + FCFS',
    questTitle: `${PREFIX} CC + Invite FCFS`,
    note: '3 CC + FCFS invite code on submit',
  },
];

const prisma = new PrismaClient();

async function main() {
  const hash = await bcrypt.hash(PASSWORD, 12);

  console.log('Password for all:', PASSWORD);
  console.log('');

  for (const spec of USERS) {
    const email = spec.email.toLowerCase();
    const quest = await prisma.quest.findFirst({
      where: { title: spec.questTitle },
      select: { id: true, title: true },
    });

    let user = await prisma.user.findUnique({ where: { email } });

    if (user) {
      user = await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: hash,
          emailVerified: true,
          displayName: spec.displayName,
        },
      });
      console.log('Updated:', email);
    } else {
      user = await prisma.user.create({
        data: {
          email,
          displayName: spec.displayName,
          passwordHash: hash,
          emailVerified: true,
          inviteCode: 'CANQUEST',
        },
      });
      console.log('Created:', email);
    }

    if (quest) {
      await prisma.questSubmission.deleteMany({
        where: { userId: user.id, questId: quest.id },
      });
      await prisma.questCompletion.deleteMany({
        where: { userId: user.id, questId: quest.id },
      });
      await prisma.winnerDraw.deleteMany({
        where: { userId: user.id, questId: quest.id },
      });
      await prisma.inviteCodePool.updateMany({
        where: { questId: quest.id, userId: user.id },
        data: { userId: null, assignedAt: null },
      });
    }

    console.log('  Quest:', quest?.title ?? '(not found — run seed-reward-demo-quests.cjs)');
    console.log('  Party:', user.cantonPartyId ?? '(none — create wallet in app after login)');
    console.log('  →', spec.note);
    console.log('');
  }

  console.log('E2E all demos: node scripts/e2e-reward-demos.cjs --prepare --admin-draw');
  console.log('Login: http://localhost:3000/login');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
