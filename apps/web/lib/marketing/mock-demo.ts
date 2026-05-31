/** Fictional data for UI / QA only — not from the API. */

export const MOCK_USER = {
  displayName: "Alex Chen",
  username: "alex_canton",
  points: 12_847,
  weeklyRank: 14,
};

export type MockQuestStatus = "active" | "coming_soon" | "ended";

export const QUEST_STATUS_BADGE: Record<
  MockQuestStatus,
  { label: string; className: string }
> = {
  active: {
    label: "Active",
    className:
      "bg-canton-soft text-canton border border-canton-muted backdrop-blur-sm",
  },
  coming_soon: {
    label: "Coming soon",
    className:
      "bg-[rgb(var(--canton-cyan-rgb)/0.12)] text-[rgb(var(--canton-cyan-rgb)/0.95)] border border-[rgb(var(--canton-cyan-rgb)/0.25)]",
  },
  ended: {
    label: "Ended",
    className:
      "bg-[var(--muted)] text-[var(--muted-foreground)] border border-[var(--border)]",
  },
};

export type MockQuest = {
  id: string;
  title: string;
  org: string;
  orgSlug: string;
  rewardPool: string;
  participants: string;
  deadline: string;
  taskCount: number;
  banner: string;
  description: string;
  tags: string[];
  status: MockQuestStatus;
};



export type MockQuestTaskType =
  | "twitter_follow"
  | "twitter_retweet"
  | "telegram_join"
  | "discord_join"
  | "submit_email"
  | "submit_canton_address"
  | "visit_website"
  | "quiz_choice";

export type MockQuestTask = {
  id: string;
  type: MockQuestTaskType;
  title: string;
  /** Optional explanation / instructions */
  description?: string;
  points: number;
  /** Mock URL, handle, or email hint shown in the UI */
  target?: string;
};

export const MOCK_QUESTS: MockQuest[] = [
  {
    id: "1",
    title: "Canton Builder Season • Wave 3",
    org: "Digital Asset Collective",
    orgSlug: "DA",
    rewardPool: "150,000 pts + WL spots",
    participants: "12.4k",
    deadline: "Jun 12, 2026",
    taskCount: 6,
    banner:
      "linear-gradient(135deg, rgb(var(--canton-rgb) / 42%) 0%, rgb(var(--canton-rgb) / 18%) 40%, rgb(17 24 39 / 40%) 100%)",
    description:
      "Follow ecosystem accounts, bridge testnet demos, and submit your Canton participant handle for verification.",
    tags: ["Live", "Featured"],
    status: "active",
  },
  {
    id: "2",
    title: "Institutional onboarding sprint",
    org: "CanQuest Labs",
    orgSlug: "CQ",
    rewardPool: "85k pts • FCFS vouchers",
    participants: "4.2k",
    deadline: "May 28, 2026",
    taskCount: 4,
    banner:
      "linear-gradient(135deg, rgb(var(--canton-rgb) / 42%) 0%, rgb(var(--canton-rgb) / 14%) 40%, rgb(17 24 39 / 45%) 100%)",
    description:
      "KYC-lite email capture + Discord verification. Winners announced with server-side RNG and ledger stubs.",
    tags: ["High demand"],
    status: "active",
  },
  {
    id: "3",
    title: "Validator education cohort",
    org: "Ecosystem Fund",
    orgSlug: "EF",
    rewardPool: "Spin tickets ×400",
    participants: "8.9k",
    deadline: "Jul 1, 2026",
    taskCount: 8,
    banner: "linear-gradient(135deg, rgb(99 102 241 / 35%) 0%, rgb(30 58 138 / 45%) 100%)",
    description:
      "Short reads, quizzes, and a final Canton-address submission checkpoint for proof of completion.",
    tags: ["Learning"],
    status: "coming_soon",
  },
  {
    id: "4",
    title: "DevConnect side quest",
    org: "Vala Builders",
    orgSlug: "VB",
    rewardPool: "NFT POAP • 500 winners",
    participants: "2.7k",
    deadline: "May 20, 2026",
    taskCount: 3,
    banner: "linear-gradient(135deg, rgb(244 114 182 / 30%) 0%, rgb(88 28 135 / 40%) 100%)",
    description:
      "Check in on-site, post proof link, and join the Telegram group to secure your POAP slot.",
    tags: ["IRL", "Limited"],
    status: "ended",
  },
];

const MOCK_QUEST_TASKS_BY_ID: Record<string, MockQuestTask[]> = {
  "1": [
    {
      id: "t1-1",
      type: "twitter_follow",
      title: "Follow @CantonNetwork",
      description:
        "Follow the official Canton ecosystem account — verification runs on the backend after OAuth / tweet proof.",
      points: 25,
      target: "@CantonNetwork",
    },
    {
      id: "t1-2",
      type: "twitter_retweet",
      title: "Retweet the Builder Season post",
      description: "Amplify Wave 3 announcement; quote tweets optional.",
      points: 40,
      target: "Post #CQ-BUILDER-W3",
    },
    {
      id: "t1-3",
      type: "telegram_join",
      title: "Join the campaign Telegram",
      description: "Stay in the loop for winner announcements.",
      points: 30,
      target: "t.me/canquest-builder",
    },
    {
      id: "t1-4",
      type: "discord_join",
      title: "Join Discord #builder-quests",
      description: "Role sync manual in preview; prod uses bot verification.",
      points: 35,
      target: "discord.gg/canquest-demo",
    },
    {
      id: "t1-5",
      type: "submit_canton_address",
      title: "Submit Canton party handle",
      description: "Participant-visible party id from your operator.",
      points: 50,
    },
    {
      id: "t1-6",
      type: "visit_website",
      title: "Read the Builder charter (~2 min)",
      description:
        "Canonical DAO rules page — eventual product tracks dwell time server-side.",
      points: 20,
      target: "https://docs.digitalasset.com/build/3.5/index.html",
    },
  ],
  "2": [
    {
      id: "t2-1",
      type: "submit_email",
      title: "Submit work email",
      description: "Institutional onboarding — domain allowlist in prod.",
      points: 80,
      target: "you@institution.invalid",
    },
    {
      id: "t2-2",
      type: "discord_join",
      title: "Discord verification",
      description: "Role + optional captcha in staging builds.",
      points: 60,
    },
    {
      id: "t2-3",
      type: "twitter_follow",
      title: "Follow @CanQuestLabs",
      points: 35,
      target: "@CanQuestLabs",
    },
    {
      id: "t2-4",
      type: "visit_website",
      title: "Complete compliance checklist",
      description: "Download manifest + attest read.",
      points: 100,
    },
  ],
  "3": [
    {
      id: "t3-1",
      type: "visit_website",
      title: "Read: Canton validator primer",
      description: "Required reading card.",
      points: 15,
    },
    {
      id: "t3-2",
      type: "quiz_choice",
      title: "Quiz: consensus vs ordering",
      description: "Three questions scored on the API in prod.",
      points: 40,
    },
    {
      id: "t3-3",
      type: "telegram_join",
      title: "Join study-group Telegram",
      points: 25,
    },
    {
      id: "t3-4",
      type: "twitter_retweet",
      title: "Retweet cohort kickoff",
      points: 30,
    },
    {
      id: "t3-5",
      type: "submit_canton_address",
      title: "Submit testnet party id",
      points: 55,
    },
    {
      id: "t3-6",
      type: "visit_website",
      title: "Office hours RSVP form",
      points: 15,
    },
    {
      id: "t3-7",
      type: "discord_join",
      title: "Discord #validator-study",
      points: 20,
    },
    {
      id: "t3-8",
      type: "submit_email",
      title: "Receipt email for certificate",
      points: 25,
    },
  ],
  "4": [
    {
      id: "t4-1",
      type: "visit_website",
      title: "On-site QR check-in",
      description: "Kiosk simulation for UI demo only.",
      points: 120,
    },
    {
      id: "t4-2",
      type: "telegram_join",
      title: "Announcements channel",
      points: 40,
      target: "t.me/canquest-live",
    },
    {
      id: "t4-3",
      type: "submit_email",
      title: "POAP delivery email",
      points: 60,
    },
  ],
};

export type MockQuestDetail = MockQuest & { tasks: MockQuestTask[] };

export function getQuestDetail(questId: string): MockQuestDetail | undefined {
  const base = MOCK_QUESTS.find((q) => q.id === questId);
  const tasks = MOCK_QUEST_TASKS_BY_ID[questId];
  if (!base || !tasks?.length) return undefined;
  return { ...base, tasks, taskCount: tasks.length };
}
export type MockLeaderRow = {
  rank: number;
  handle: string;
  points: number;
  change: string;
  badge?: string;
};

/** Mock display profile per @handle — indexer would join this from user service. */
const CORE_LEADER_PROFILES: Record<
  string,
  { displayName: string; initials: string; avatarGradient: string }
> = {
  node_runner: {
    displayName: "Jamie Okoye",
    initials: "JO",
    avatarGradient:
      "linear-gradient(145deg, rgb(217 245 66) 0%, rgb(128 146 42) 100%)",
  },
  ledger_sam: {
    displayName: "Sam Rivera",
    initials: "SR",
    avatarGradient:
      "linear-gradient(145deg, rgb(var(--canton-rgb)) 0%, rgb(71 85 105) 100%)",
  },
  alex_canton: {
    displayName: "Alex Chen",
    initials: "AC",
    avatarGradient:
      "linear-gradient(145deg, rgb(99 102 241) 0%, rgb(79 70 229) 100%)",
  },
  sybil_hunter: {
    displayName: "Morgan Blake",
    initials: "MB",
    avatarGradient:
      "linear-gradient(145deg, rgb(251 146 60) 0%, rgb(194 65 12) 100%)",
  },
  canton_fan: {
    displayName: "Priya Shah",
    initials: "PS",
    avatarGradient:
      "linear-gradient(145deg, rgb(236 72 153) 0%, rgb(139 92 246) 100%)",
  },
  quest_max: {
    displayName: "Max Weber",
    initials: "MW",
    avatarGradient:
      "linear-gradient(145deg, rgb(148 163 184) 0%, rgb(51 65 85) 100%)",
  },
  og_operator: {
    displayName: "Jordan Lee",
    initials: "JL",
    avatarGradient:
      "linear-gradient(145deg, rgb(20 184 166) 0%, rgb(8 145 178) 100%)",
  },
};

const EXTRA_LEADERBOARD_HANDLES = [
  "vala_builder",
  "canton_ops",
  "mesh_sync",
  "proof_line",
  "radix_dev",
  "infra_nina",
  "ledger_ada",
  "spin_host",
  "vault_k",
  "oracle_m",
  "scout_n",
  "pilot_p",
  "relay_q",
  "shard_r",
  "fabric_s",
  "tower_t",
  "pulse_u",
  "apex_v",
  "neon_w",
  "orbit_x",
] as const;

const PROFILE_GRADIENT_ROTATION = [
  "linear-gradient(145deg, rgb(56 189 248) 0%, rgb(37 99 235) 100%)",
  "linear-gradient(145deg, rgb(251 113 133) 0%, rgb(217 70 239) 100%)",
  "linear-gradient(145deg, rgb(90 217 138) 0%, rgb(50 180 120) 100%)",
  "linear-gradient(145deg, rgb(32 211 195) 0%, rgb(20 150 140) 100%)",
  "linear-gradient(145deg, rgb(167 139 250) 0%, rgb(109 40 217) 100%)",
  "linear-gradient(145deg, rgb(114 232 164) 0%, rgb(90 217 138) 100%)",
];

function prettifyLeaderHandle(handle: string) {
  return handle
    .replace(/_/g, " ")
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
}

function initialsLeaderHandle(handle: string) {
  const parts = handle.split("_").filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase().slice(0, 2);
  }
  return handle.slice(0, 2).toUpperCase();
}

const _synthProfiles = Object.fromEntries(
  EXTRA_LEADERBOARD_HANDLES.map((handle, i) => [
    handle,
    {
      displayName: prettifyLeaderHandle(handle),
      initials: initialsLeaderHandle(handle),
      avatarGradient:
        PROFILE_GRADIENT_ROTATION[i % PROFILE_GRADIENT_ROTATION.length]!,
    },
  ]),
);

export const LEADERBOARD_USER_PROFILE_FULL: Record<
  string,
  { displayName: string; initials: string; avatarGradient: string }
> = {
  ...CORE_LEADER_PROFILES,
  ..._synthProfiles,
};

/** Same merged map as {@link LEADERBOARD_USER_PROFILE_FULL} — kept for shorter imports. */
export const LEADERBOARD_USER_PROFILE = LEADERBOARD_USER_PROFILE_FULL;

export function getLeaderboardProfile(handle: string) {
  return (
    LEADERBOARD_USER_PROFILE_FULL[handle] ?? {
      displayName: prettifyLeaderHandle(handle),
      initials: initialsLeaderHandle(handle),
      avatarGradient:
        "linear-gradient(145deg, rgb(82 82 91) 0%, rgb(39 39 42) 100%)",
    }
  );
}

export const LEADERBOARD_PAGE_SIZE = 10;

function extendLeaderboardRows(
  seed: MockLeaderRow[],
  extraHandles: readonly string[],
  floorPts: number,
): MockLeaderRow[] {
  let prev = seed[seed.length - 1]!.points;
  const extra: MockLeaderRow[] = extraHandles.map((handle, idx) => {
    prev = Math.round(prev * 0.94 - (idx + 1) * (floorPts > 10_000 ? 80 : 22));
    prev = Math.max(floorPts, prev);
    const changeRoll = (seed.length + idx) % 4;
    const change =
      changeRoll === 0 ? "+12" : changeRoll === 1 ? "+36" : changeRoll === 2 ? "+8" : "—";
    return {
      rank: seed.length + idx + 1,
      handle,
      points: prev,
      change,
    };
  });
  return [...seed, ...extra];
}

const BASE_WEEKLY: MockLeaderRow[] = [
  { rank: 1, handle: "node_runner", points: 4820, change: "+420", badge: "On fire" },
  { rank: 2, handle: "ledger_sam", points: 4510, change: "+310" },
  { rank: 3, handle: "alex_canton", points: 4288, change: "+195", badge: "You" },
  { rank: 4, handle: "sybil_hunter", points: 4102, change: "+88" },
  { rank: 5, handle: "canton_fan", points: 3920, change: "+120" },
  { rank: 6, handle: "quest_max", points: 3555, change: "+45" },
];

const BASE_MONTHLY: MockLeaderRow[] = [
  { rank: 1, handle: "sybil_hunter", points: 58200, change: "+4.2k" },
  { rank: 2, handle: "node_runner", points: 55120, change: "+3.9k" },
  { rank: 3, handle: "ledger_sam", points: 52100, change: "+1.8k" },
  {
    rank: 4,
    handle: "alex_canton",
    points: 49800,
    change: "+2.4k",
    badge: "You",
  },
  { rank: 5, handle: "canton_fan", points: 44100, change: "+900" },
];

const BASE_ALL: MockLeaderRow[] = [
  { rank: 1, handle: "og_operator", points: 412000, change: "—" },
  { rank: 2, handle: "sybil_hunter", points: 398200, change: "—" },
  { rank: 3, handle: "ledger_sam", points: 301400, change: "—", badge: "Legend" },
  { rank: 4, handle: "alex_canton", points: 128470, change: "—", badge: "You" },
  { rank: 5, handle: "node_runner", points: 110900, change: "—" },
];

export const MOCK_LEADERBOARD: Record<"weekly" | "monthly" | "all", MockLeaderRow[]> = {
  weekly: extendLeaderboardRows(BASE_WEEKLY, EXTRA_LEADERBOARD_HANDLES, 420),
  monthly: extendLeaderboardRows(BASE_MONTHLY, EXTRA_LEADERBOARD_HANDLES, 12_000),
  all: extendLeaderboardRows(BASE_ALL, EXTRA_LEADERBOARD_HANDLES, 48_000),
};

export const MOCK_SPIN_TIERS = [
  { name: "Legendary bundle", pct: "0.5%", color: "text-canton" },
  { name: "Rare reward", pct: "1.5%", color: "text-violet-500" },
  { name: "CC drop", pct: "3%", color: "text-canton-muted" },
  { name: "WL code", pct: "5%", color: "text-sky-600" },
  { name: "Better luck next time", pct: "90%", color: "text-[var(--muted-foreground)]" },
];

export const MOCK_WALLET = {
  partyId: "canquest:user:alex_canton:demo01",
  ccBalance: "1,248.55",
  pointsBalance: MOCK_USER.points.toLocaleString(),
  pendingInbound: "+12 CC",
  networkLabel: "Canton (participant preview)",
};

/** Demo market liquidity party — Send modal can pre-fill this for CC → market flows. */
export const MOCK_MARKET_PARTY = {
  label: "Market liquidity (preview)",
  partyId: "canquest:market:liquidity:v1",
} as const;

export type MockTx = {
  id: string;
  type: string;
  amount: string;
  fee: string;
  status: "Settled" | "Pending";
  time: string;
  counterparty: string;
};

export const MOCK_TRANSACTIONS: MockTx[] = [
  {
    id: "cq-tx-9f2a",
    type: "Send CC",
    amount: "−120 CC",
    fee: "3 CC",
    status: "Settled",
    time: "Today · 09:14",
    counterparty: "treasury::master",
  },
  {
    id: "cq-tx-8c11",
    type: "Quest payout",
    amount: "+450 pts",
    fee: "—",
    status: "Settled",
    time: "Yesterday · 18:42",
    counterparty: "pool::builder_s3",
  },
  {
    id: "cq-tx-7ab0",
    type: "Receive CC",
    amount: "+500 CC",
    fee: "—",
    status: "Settled",
    time: "May 12 · 11:05",
    counterparty: "party::vala_ops",
  },
  {
    id: "cq-tx-661d",
    type: "Spin debit",
    amount: "−500 pts",
    fee: "—",
    status: "Settled",
    time: "May 11 · 20:31",
    counterparty: "engine::spin_v2",
  },
  {
    id: "cq-tx-pending",
    type: "Send CC",
    amount: "−80 CC",
    fee: "3 CC",
    status: "Pending",
    time: "Queued · 2m",
    counterparty: "party::custody_test",
  },
];

export const MOCK_ACTIVITIES = [
  { title: "Quest cleared", detail: "Canton Builder Wave 3 · +180 pts", time: "2h ago" },
  { title: "Spin redeemed", detail: "WL code · ALPHA-CRAFT-09", time: "5h ago" },
  { title: "CC transfer settled", detail: "To treasury fee route · −3 CC fee", time: "Yesterday" },
  { title: "Username locked", detail: "alex_canton bound to party placeholder", time: "May 10" },
];
