/**
 * Seed demo quests — one per reward type, all social tasks + reward-specific task.
 * Usage: node scripts/seed-reward-demo-quests.cjs
 *        node scripts/seed-reward-demo-quests.cjs --replace  (delete old [DEMO] quests first)
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const PREFIX = '[DEMO]';
const replace = process.argv.includes('--replace');

const SOCIAL_TASKS = [
  { type: 'twitter_follow', title: 'Follow on X', points: 10, target: 'https://x.com/naxweb', order: 0 },
  { type: 'twitter_retweet', title: 'Retweet announcement', points: 10, target: 'https://x.com/naxweb', order: 1 },
  { type: 'telegram_channel', title: 'Join Telegram channel', points: 10, target: 'https://t.me/naxweb', order: 2 },
  { type: 'telegram_group', title: 'Join Telegram group', points: 10, target: 'https://t.me/naxweb', order: 3 },
  { type: 'discord_join', title: 'Join Discord', points: 10, target: 'https://discord.gg/example', order: 4 },
];

const endsAt = new Date('2026-12-31T23:59:00.000Z');
const startsAt = new Date('2026-05-01T00:00:00.000Z');
const banner =
  'linear-gradient(135deg,rgba(6,182,212,0.42) 0%,rgba(6,182,212,0.18) 40%,rgba(17,24,39,0.40) 100%)';

const QUESTS = [
  {
    title: `${PREFIX} Reward CC`,
    rewardType: 'CC_ONLY',
    rewardCc: 5,
    rewardPool: '5 CC per winner',
    maxWinners: null,
    extraTasks: [
      { type: 'submit_party_id', title: 'Submit Party ID', points: 15, target: '', order: 5 },
    ],
    inviteCodes: [],
  },
  {
    title: `${PREFIX} Reward Waitlist`,
    rewardType: 'WAITLIST_EMAIL',
    rewardCc: 0,
    rewardPool: 'Waitlist · email export',
    maxWinners: null,
    extraTasks: [
      { type: 'submit_email', title: 'Submit email', points: 15, target: '', order: 5 },
    ],
    inviteCodes: [],
  },
  {
    title: `${PREFIX} Invite Random Draw`,
    rewardType: 'INVITE_CODE_RANDOM',
    rewardCc: 0,
    rewardPool: '50 invite codes · random draw',
    maxWinners: 10,
    extraTasks: [],
    inviteCodes: Array.from({ length: 15 }, (_, i) => `DEMO-RND-${String(i + 1).padStart(3, '0')}`),
  },
  {
    title: `${PREFIX} Invite FCFS`,
    rewardType: 'INVITE_CODE_FCFS',
    rewardCc: 0,
    rewardPool: 'FCFS · 5 codes',
    maxWinners: 5,
    extraTasks: [],
    inviteCodes: ['DEMO-FCFS-01', 'DEMO-FCFS-02', 'DEMO-FCFS-03', 'DEMO-FCFS-04', 'DEMO-FCFS-05'],
  },
  {
    title: `${PREFIX} CC + Invite FCFS`,
    rewardType: 'CC_AND_INVITE',
    rewardCc: 3,
    rewardPool: '3 CC + FCFS code',
    maxWinners: 3,
    extraTasks: [
      { type: 'submit_party_id', title: 'Submit Party ID', points: 15, target: '', order: 5 },
    ],
    inviteCodes: ['DEMO-MIX-01', 'DEMO-MIX-02', 'DEMO-MIX-03'],
  },
];

async function main() {
  if (replace) {
    const old = await prisma.quest.findMany({
      where: { title: { startsWith: PREFIX } },
      select: { id: true, title: true },
    });
    for (const q of old) {
      await prisma.quest.delete({ where: { id: q.id } });
      console.log('Deleted:', q.title);
    }
  }

  for (const spec of QUESTS) {
    const existing = await prisma.quest.findFirst({ where: { title: spec.title } });
    if (existing) {
      console.log('Skip (exists):', spec.title);
      continue;
    }

    const tasks = [...SOCIAL_TASKS, ...spec.extraTasks].map((t, i) => ({
      ...t,
      order: i,
      description: null,
    }));

    const quest = await prisma.quest.create({
      data: {
        title: spec.title,
        org: 'CanQuest QA',
        orgSlug: 'CQA',
        description:
          `Demo quest for testing ${spec.rewardType}.\n\n` +
          'Complete all social tasks, then submit the quest. ' +
          'Use coinnyari@gmail.com or a fresh test account.',
        banner,
        rewardCc: spec.rewardCc,
        rewardPool: spec.rewardPool,
        deadline: endsAt.toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }),
        startsAt,
        endsAt,
        status: 'ACTIVE',
        rewardType: spec.rewardType,
        maxWinners: spec.maxWinners,
        tags: JSON.stringify(['Demo', 'QA', spec.rewardType]),
        tasks: { create: tasks },
      },
      include: { tasks: true },
    });

    for (const code of spec.inviteCodes) {
      await prisma.inviteCodePool.create({
        data: { questId: quest.id, code },
      });
    }

    console.log('Created:', quest.title);
    console.log('  id:', quest.id);
    console.log('  rewardType:', quest.rewardType);
    console.log('  tasks:', quest.tasks.length);
    console.log('  invite codes:', spec.inviteCodes.length);
    console.log('');
  }

  console.log('Done. Open http://localhost:3000/quests (app) or /admin (dashboard).');
  console.log('Then: node scripts/create-demo-test-users.cjs');
  console.log('E2E:  node scripts/e2e-reward-demos.cjs --admin-draw');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
