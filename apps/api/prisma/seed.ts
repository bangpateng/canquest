/**
 * Seed script — populates Quest + QuestTask data from the original mock set.
 * Run with: npx ts-node prisma/seed.ts
 * Or via: npx prisma db seed
 */
import { PrismaClient, QuestStatus } from '@prisma/client';

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
  rewardCc: number;
  rewardPool: string;
  deadline?: string;
  status: QuestStatus;
  tags: string[];
  tasks: SeedTask[];
};

const prisma = new PrismaClient();

const QUESTS: SeedQuest[] = [
  {
    title: 'Canton Builder Season • Wave 3',
    org: 'Digital Asset Collective',
    orgSlug: 'DA',
    rewardPool: '150 CC · WL spots',
    rewardCc: 150,
    deadline: 'Jun 12, 2026',
    banner:
      'linear-gradient(135deg, rgba(6,182,212,0.42) 0%, rgba(6,182,212,0.18) 40%, rgba(17,24,39,0.40) 100%)',
    description:
      'Follow ecosystem accounts, bridge testnet demos, and submit your Canton participant handle for verification.',
    tags: ['Live', 'Featured'],
    status: QuestStatus.ACTIVE,
    tasks: [
      {
        type: 'twitter_follow',
        title: 'Follow @CantonNetwork',
        description:
          'Follow the official Canton ecosystem account — verified after your Twitter handle is submitted.',
        points: 25,
        target: '@CantonNetwork',
        order: 0,
      },
      {
        type: 'twitter_retweet',
        title: 'Retweet the Builder Season post',
        description: 'Amplify Wave 3 announcement; quote tweets welcome.',
        points: 40,
        target: 'Post #CQ-BUILDER-W3',
        order: 1,
      },
      {
        type: 'telegram_join',
        title: 'Join the campaign Telegram',
        description: 'Stay in the loop for winner announcements.',
        points: 30,
        target: 't.me/canquest-builder',
        order: 2,
      },
      {
        type: 'discord_join',
        title: 'Join Discord #builder-quests',
        description: 'Role sync — verified by CanQuest bot.',
        points: 35,
        target: 'discord.gg/canquest-demo',
        order: 3,
      },
      {
        type: 'submit_canton_address',
        title: 'Submit your Canton Party ID',
        description: 'Paste your full Canton participant party ID (includes "::").',
        points: 50,
        order: 4,
      },
      {
        type: 'visit_website',
        title: 'Read the Builder Charter (~2 min)',
        description: 'Visit the official Canton builder docs.',
        points: 20,
        target: 'https://docs.digitalasset.com/build/3.5/index.html',
        order: 5,
      },
    ],
  },
  {
    title: 'Institutional Onboarding Sprint',
    org: 'CanQuest Labs',
    orgSlug: 'CQ',
    rewardPool: '85 CC · FCFS vouchers',
    rewardCc: 85,
    deadline: 'May 28, 2026',
    banner:
      'linear-gradient(135deg, rgba(6,182,212,0.42) 0%, rgba(6,182,212,0.14) 40%, rgba(17,24,39,0.45) 100%)',
    description:
      'KYC-lite email capture + Discord verification. Complete all tasks to earn your reward.',
    tags: ['High demand'],
    status: QuestStatus.ACTIVE,
    tasks: [
      {
        type: 'submit_email',
        title: 'Submit your work email',
        description: 'Institutional onboarding — domain allowlist checked server-side.',
        points: 80,
        order: 0,
      },
      {
        type: 'discord_join',
        title: 'Discord verification',
        description: 'Join our Discord and verify your role.',
        points: 60,
        order: 1,
      },
      {
        type: 'twitter_follow',
        title: 'Follow @CanQuestLabs',
        points: 35,
        target: '@CanQuestLabs',
        order: 2,
      },
      {
        type: 'visit_website',
        title: 'Complete the compliance checklist',
        description: 'Download manifest + confirm read.',
        points: 100,
        order: 3,
      },
    ],
  },
  {
    title: 'Validator Education Cohort',
    org: 'Ecosystem Fund',
    orgSlug: 'EF',
    rewardPool: '50 CC · Spin tickets ×5',
    rewardCc: 50,
    deadline: 'Jul 1, 2026',
    banner:
      'linear-gradient(135deg, rgba(99,102,241,0.35) 0%, rgba(30,58,138,0.45) 100%)',
    description:
      'Short reads, quizzes, and a Canton-address submission checkpoint for proof of completion.',
    tags: ['Learning'],
    status: QuestStatus.COMING_SOON,
    tasks: [
      {
        type: 'visit_website',
        title: 'Read: Canton Validator Primer',
        description: 'Required reading — approx. 5 minutes.',
        points: 15,
        target: 'https://docs.digitalasset.com/build/3.5/index.html',
        order: 0,
      },
      {
        type: 'quiz_choice',
        title: 'Quiz: What is the role of a Canton validator?',
        description: 'Choose the correct answer.',
        points: 40,
        correctAnswer: 'b',
        order: 1,
      },
      {
        type: 'telegram_join',
        title: 'Join the study-group Telegram',
        points: 25,
        order: 2,
      },
      {
        type: 'twitter_retweet',
        title: 'Retweet the cohort kickoff',
        points: 30,
        order: 3,
      },
      {
        type: 'submit_canton_address',
        title: 'Submit your testnet Party ID',
        description: 'Paste your full Canton party ID with "::".',
        points: 55,
        order: 4,
      },
      {
        type: 'visit_website',
        title: 'Office hours RSVP form',
        points: 15,
        order: 5,
      },
      {
        type: 'discord_join',
        title: 'Join Discord #validator-study',
        points: 20,
        order: 6,
      },
      {
        type: 'submit_email',
        title: 'Email for certificate delivery',
        points: 25,
        order: 7,
      },
    ],
  },
  {
    title: 'DevConnect Side Quest',
    org: 'Vala Builders',
    orgSlug: 'VB',
    rewardPool: '30 CC · NFT POAP',
    rewardCc: 30,
    deadline: 'May 20, 2026',
    banner:
      'linear-gradient(135deg, rgba(244,114,182,0.30) 0%, rgba(88,28,135,0.40) 100%)',
    description:
      'Check in on-site, post proof link, and join the Telegram group to secure your POAP slot.',
    tags: ['IRL', 'Limited'],
    status: QuestStatus.ENDED,
    tasks: [
      {
        type: 'visit_website',
        title: 'On-site QR check-in',
        description: 'Scan the kiosk QR code at the event entrance.',
        points: 120,
        order: 0,
      },
      {
        type: 'telegram_join',
        title: 'Announcements channel',
        points: 40,
        target: 't.me/canquest-live',
        order: 1,
      },
      {
        type: 'submit_email',
        title: 'POAP delivery email',
        points: 60,
        order: 2,
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
        rewardCc: questData.rewardCc,
        rewardPool: questData.rewardPool,
        deadline: questData.deadline,
        status: questData.status,
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

  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
