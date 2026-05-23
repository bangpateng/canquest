/**
 * Seed script — populates Quest + QuestTask data from the original mock set.
 * Run with: npx ts-node prisma/seed.ts
 * Or via: npx prisma db seed
 */
import { PrismaClient, QuestKind, QuestStatus, RewardType } from '@prisma/client';

type SeedTask = {
  type: string;
  title: string;
  description?: string;
  points: number;
  target?: string;
  order: number;
  correctAnswer?: string;
};

type SeedQuest = {
  title: string;
  org: string;
  orgSlug: string;
  description: string;
  banner: string;
  bannerImageUrl?: string;
  logoUrl?: string;
  rewardCc: number;
  rewardPool: string;
  deadline?: string;
  startsAt?: Date;
  endsAt?: Date;
  status: QuestStatus;
  rewardType?: RewardType;
  maxWinners?: number;
  tags: string[];
  tasks: SeedTask[];
};

const prisma = new PrismaClient();

const QUESTS: SeedQuest[] = [
  {
    title: 'Alpend',
    org: 'Private Positions. Open Markets.',
    orgSlug: 'DA',
    description:
      'Private Positions.\nOpen Markets.\nA decentralized money market on Canton — confidential by design, MEV-free execution.',
    banner:
      'linear-gradient(135deg,rgba(6,182,212,0.42) 0%,rgba(6,182,212,0.18) 40%,rgba(17,24,39,0.40) 100%)',
    bannerImageUrl: '/quest-media/22df0978-96ca-4fe8-8097-d0c782b0f010.jpg',
    logoUrl: '/quest-media/136e973d-04d8-4700-abb2-1586a2937460.jpg',
    rewardPool: 'Reward Code 50',
    rewardCc: 0,
    deadline: 'Jun 30,2026',
    startsAt: new Date('2026-05-11T18:16:00.000Z'),
    endsAt: new Date('2026-06-29T18:16:00.000Z'),
    rewardType: RewardType.INVITE_CODE_RANDOM,
    maxWinners: 50,
    tags: [],
    status: QuestStatus.ACTIVE,
    tasks: [
      {
        type: 'twitter_follow',
        title: 'Alpend',
        points: 10,
        target: 'https://x.com/alpendhq',
        order: 0,
      },
      {
        type: 'twitter_retweet',
        title: 'Retweet Post',
        points: 10,
        target: 'https://x.com/alpendhq',
        order: 1,
      },
      {
        type: 'telegram_group',
        title: 'Join Telegram Group',
        description: 'https://x.com/alpendhq',
        points: 10,
        order: 2,
      },
      {
        type: 'submit_email',
        title: 'Submit Email',
        points: 10,
        order: 3,
      },
    ],
  },
];

async function main() {
  console.log('Seeding quests...');

  for (const q of QUESTS) {
    const { tasks, ...questData } = q;

    const quest = await prisma.quest.upsert({
      where: { id: '' }, // will always create (no id provided)
      update: {},
      create: {
        title: questData.title,
        org: questData.org,
        orgSlug: questData.orgSlug,
        description: questData.description,
        banner: questData.banner,
        bannerImageUrl: questData.bannerImageUrl ?? null,
        logoUrl: questData.logoUrl ?? null,
        rewardCc: questData.rewardCc,
        rewardPool: questData.rewardPool,
        deadline: questData.deadline,
        startsAt: questData.startsAt ?? null,
        endsAt: questData.endsAt ?? null,
        rewardType: questData.rewardType ?? RewardType.CC_ONLY,
        maxWinners: questData.maxWinners ?? null,
        status: questData.status,
        questKind: QuestKind.CAMPAIGN,
        tags: JSON.stringify(questData.tags),
      },
    });

    // Simpler: create if not exists via findFirst
    const existing = await prisma.quest.findFirst({
      where: { title: questData.title },
    });

    const target = existing ?? quest;

    for (const task of tasks) {
      const existingTask = await prisma.questTask.findFirst({
        where: { questId: target.id, title: task.title },
      });
      if (!existingTask) {
        await prisma.questTask.create({
          data: {
            questId: target.id,
            type: task.type,
            title: task.title,
            description: task.description ?? null,
            points: task.points,
            target: task.target ?? null,
            order: task.order,
            correctAnswer: task.correctAnswer ?? null,
          },
        });
      }
    }

    console.log(`  ✓ ${questData.title}`);
  }

  const earnHub = await prisma.quest.findFirst({
    where: { questKind: QuestKind.EARN_HUB },
  });
  if (!earnHub) {
    await prisma.quest.create({
      data: {
        title: 'CanQuest Earn',
        org: 'CanQuest',
        orgSlug: 'CQ',
        description:
          'Daily check-in, social tasks, and quizzes. Collect points and redeem for CC and other rewards.',
        banner:
          'linear-gradient(135deg,rgba(90,217,138,0.35) 0%,rgba(17,24,39,0.9) 100%)',
        rewardCc: 0,
        rewardPool: 'Earn points',
        status: QuestStatus.ACTIVE,
        rewardType: RewardType.CC_ONLY,
        questKind: QuestKind.EARN_HUB,
        tags: JSON.stringify(['earn', 'daily']),
        tasks: {
          create: [
            {
              type: 'daily_check_in',
              title: 'Daily check-in',
              points: 10,
              order: 0,
              repeatEvery24h: true,
            },
          ],
        },
      },
    });
    console.log('  ✓ CanQuest Earn hub');
  } else {
    console.log('  ✓ CanQuest Earn hub (exists)');
  }

  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
