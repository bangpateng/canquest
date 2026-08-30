/**
 * Demo Earn campaigns for LOCAL UI capture (database canquest_ui only).
 * Run: node prisma/seed-earn-demo.cjs
 * Adds one campaign per reward-type family + COMING_SOON / ENDED rows so
 * every Earn tab and card variant renders. Safe to re-run (skips by title).
 */
const { PrismaClient, QuestKind, QuestStatus, RewardType } = require('@prisma/client');

const prisma = new PrismaClient();

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();
const d = (ms) => new Date(now + ms);

const CAMPAIGNS = [
  {
    title: 'Swap & Earn with NovaPay',
    projectName: 'NovaPay',
    org: 'NovaPay',
    orgSlug: 'NV',
    description:
      'Complete swaps on NovaPay DEX and earn CC rewards for every qualified transaction.',
    bannerImageUrl:
      'https://images.unsplash.com/photo-1639762681485-074b7f938ba0?w=800&q=70',
    rewardCc: 25,
    rewardToken: 'CC',
    rewardPool: '2500 CC',
    deadline: 'Sep 10, 2026',
    startsAt: d(-2 * DAY),
    endsAt: d(14 * DAY),
    status: QuestStatus.ACTIVE,
    rewardType: RewardType.CC_ONLY,
    maxWinners: 100,
    tags: JSON.stringify(['defi', 'swap']),
    socialLinks: JSON.stringify([
      { platform: 'twitter', url: 'https://x.com/novapay' },
      { platform: 'website', url: 'https://novapay.example.com' },
    ]),
    tasks: [
      { type: 'twitter_follow', title: 'Follow @novapay on X', points: 10, target: 'https://x.com/novapay', order: 0 },
      { type: 'telegram_group', title: 'Join NovaPay Telegram', points: 10, target: 'https://t.me/novapay', order: 1 },
      { type: 'quiz_yes_no', title: 'Quiz: What does NovaPay do?', points: 15, order: 2, correctAnswer: 'yes' },
    ],
  },
  {
    title: 'Glint Wallet Beta — FCFS Codes',
    projectName: 'Glint Labs',
    org: 'Glint Labs',
    orgSlug: 'GL',
    description:
      'Grab a limited beta invite code for the Glint wallet. First come, first served — slots go fast.',
    bannerImageUrl:
      'https://images.unsplash.com/photo-1639721626828-9b5b2a1f8bca?w=800&q=70',
    rewardCc: 0,
    rewardToken: 'CC',
    rewardPool: 'Beta invite code',
    deadline: 'Sep 6, 2026',
    startsAt: d(-1 * DAY),
    endsAt: d(10 * DAY),
    status: QuestStatus.ACTIVE,
    rewardType: RewardType.INVITE_CODE_FCFS,
    maxWinners: 200,
    tags: JSON.stringify(['wallet', 'beta']),
    socialLinks: JSON.stringify([{ platform: 'twitter', url: 'https://x.com/glintlabs' }]),
    tasks: [
      { type: 'twitter_follow', title: 'Follow @glintlabs on X', points: 10, target: 'https://x.com/glintlabs', order: 0 },
      { type: 'twitter_retweet', title: 'Retweet the beta announcement', points: 10, target: 'https://x.com/glintlabs/status/1', order: 1 },
    ],
  },
  {
    title: 'MintX CC + Code Raffle',
    projectName: 'MintX',
    org: 'MintX',
    orgSlug: 'MX',
    description:
      'Win CC plus an exclusive platform code. Winners drawn at random when the campaign ends.',
    bannerImageUrl:
      'https://images.unsplash.com/photo-1640340434855-6084b1f4a1c3?w=800&q=70',
    rewardCc: 50,
    rewardToken: 'CC',
    rewardPool: '50 CC + 1 code',
    deadline: 'Sep 16, 2026',
    startsAt: d(-3 * DAY),
    endsAt: d(20 * DAY),
    status: QuestStatus.ACTIVE,
    rewardType: RewardType.CC_AND_CODE_RAFFLE,
    maxWinners: 50,
    tags: JSON.stringify(['raffle', 'drop']),
    socialLinks: JSON.stringify([
      { platform: 'twitter', url: 'https://x.com/mintx' },
      { platform: 'telegram', url: 'https://t.me/mintx' },
    ]),
    tasks: [
      { type: 'twitter_follow', title: 'Follow @mintx on X', points: 10, target: 'https://x.com/mintx', order: 0 },
      { type: 'twitter_retweet', title: 'Retweet the raffle post', points: 10, target: 'https://x.com/mintx/status/2', order: 1 },
      { type: 'quiz_choice', title: 'Quiz: What is MintX?', points: 15, order: 2 },
    ],
  },
  {
    title: 'Lend & Earn USDCx with AquaLend',
    projectName: 'AquaLend',
    org: 'AquaLend',
    orgSlug: 'AQ',
    description:
      'Supply liquidity to AquaLend pools. Top lenders share the USDCx reward pool.',
    bannerImageUrl:
      'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=800&q=70',
    rewardCc: 5,
    rewardToken: 'USDCx',
    rewardPool: '500 USDCx',
    deadline: 'Sep 8, 2026',
    startsAt: d(-2 * DAY),
    endsAt: d(12 * DAY),
    status: QuestStatus.ACTIVE,
    rewardType: RewardType.CC_ONLY,
    maxWinners: 100,
    tags: JSON.stringify(['defi', 'lending']),
    socialLinks: JSON.stringify([
      { platform: 'twitter', url: 'https://x.com/aqualend' },
      { platform: 'website', url: 'https://aqualend.example.com' },
    ]),
    tasks: [
      { type: 'twitter_follow', title: 'Follow @aqualend on X', points: 10, target: 'https://x.com/aqualend', order: 0 },
      { type: 'telegram_channel', title: 'Join AquaLend channel', points: 10, target: 'https://t.me/aqualend', order: 1 },
      { type: 'submit_canton_address', title: 'Submit your Canton address', points: 20, order: 2 },
    ],
  },
  {
    title: 'PulseNet Mainnet Waitlist',
    projectName: 'PulseNet',
    org: 'PulseNet',
    orgSlug: 'PN',
    description:
      'Join the waitlist for PulseNet mainnet launch rewards. Spots drawn at launch.',
    bannerImageUrl:
      'https://images.unsplash.com/photo-1518186285589-2f7649de83e0?w=800&q=70',
    rewardCc: 0,
    rewardToken: 'CC',
    rewardPool: 'Waitlist spot',
    deadline: 'Sep 15, 2026',
    startsAt: d(-1 * DAY),
    endsAt: d(19 * DAY),
    status: QuestStatus.ACTIVE,
    rewardType: RewardType.WAITLIST_EMAIL,
    maxWinners: 1000,
    tags: JSON.stringify(['waitlist', 'mainnet']),
    socialLinks: JSON.stringify([
      { platform: 'twitter', url: 'https://x.com/pulsenet' },
      { platform: 'website', url: 'https://pulsenet.example.com' },
    ]),
    tasks: [
      { type: 'twitter_follow', title: 'Follow @pulsenet on X', points: 10, target: 'https://x.com/pulsenet', order: 0 },
      { type: 'submit_email', title: 'Register your email', points: 15, order: 1 },
    ],
  },
  {
    title: 'OrbitFi Follow & Retweet Raffle',
    projectName: 'OrbitFi',
    org: 'OrbitFi',
    orgSlug: 'OR',
    description:
      'Spread the word about OrbitFi and win an invite code. Winners drawn at random.',
    bannerImageUrl:
      'https://images.unsplash.com/photo-1620731291205-43231a7f9b94?w=800&q=70',
    rewardCc: 0,
    rewardToken: 'CC',
    rewardPool: 'Invite code',
    deadline: 'Sep 26, 2026',
    startsAt: d(5 * DAY),
    endsAt: d(30 * DAY),
    status: QuestStatus.COMING_SOON,
    rewardType: RewardType.INVITE_CODE_RANDOM,
    maxWinners: 150,
    tags: JSON.stringify(['social', 'raffle']),
    socialLinks: JSON.stringify([{ platform: 'twitter', url: 'https://x.com/orbitfi' }]),
    tasks: [
      { type: 'twitter_follow', title: 'Follow @orbitfi on X', points: 10, target: 'https://x.com/orbitfi', order: 0 },
      { type: 'twitter_retweet', title: 'Retweet the campaign post', points: 10, target: 'https://x.com/orbitfi/status/3', order: 1 },
    ],
  },
  {
    title: 'ZenithX FCFS Airdrop',
    projectName: 'ZenithX',
    org: 'ZenithX',
    orgSlug: 'ZX',
    description:
      'First-come, first-served CC airdrop for early supporters. All slots claimed.',
    bannerImageUrl:
      'https://images.unsplash.com/photo-1605792657660-596af9009e82?w=800&q=70',
    rewardCc: 10,
    rewardToken: 'CC',
    rewardPool: '2000 CC',
    deadline: 'Ended',
    startsAt: d(-30 * DAY),
    endsAt: d(-7 * DAY),
    status: QuestStatus.ENDED,
    rewardType: RewardType.CC_ONLY,
    maxWinners: 200,
    tags: JSON.stringify(['airdrop', 'fcfs']),
    socialLinks: JSON.stringify([{ platform: 'twitter', url: 'https://x.com/zenithx' }]),
    tasks: [
      { type: 'twitter_follow', title: 'Follow @zenithx on X', points: 10, target: 'https://x.com/zenithx', order: 0 },
      { type: 'discord_join', title: 'Join ZenithX Discord', points: 10, target: 'https://discord.gg/zenithx', order: 1 },
    ],
  },
];

async function main() {
  for (const data of CAMPAIGNS) {
    const existing = await prisma.quest.findFirst({
      where: { title: data.title, questKind: QuestKind.CAMPAIGN },
    });
    if (existing) {
      console.log(`  = ${data.title} (exists)`);
      continue;
    }
    const { tasks, ...quest } = data;
    await prisma.quest.create({
      data: { ...quest, questKind: QuestKind.CAMPAIGN, tasks: { create: tasks } },
    });
    console.log(`  + ${data.title}`);
  }

  // Alpend (from base seed) points at /quest-media files that do not exist
  // locally — clear them so cards fall back to the gradient banner.
  await prisma.quest.updateMany({
    where: { bannerImageUrl: { startsWith: '/quest-media/' } },
    data: { bannerImageUrl: null, logoUrl: null },
  });
  console.log('Done.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
