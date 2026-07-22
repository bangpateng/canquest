export type DocsNavItem = {
  id: string;
  title: string;
  children?: { id: string; title: string }[];
};

export const DOCS_NAV: DocsNavItem[] = [
  { id: "introduction", title: "Introduction" },
  { id: "getting-started", title: "Getting started" },
  { id: "verification", title: "Verification & anti-sybil" },
  { id: "cc-lock", title: "CC Lock & Earn access" },
  { id: "wallet", title: "Wallet" },
  { id: "earn", title: "Earn (partner campaigns)" },
  { id: "quests", title: "Quests & points" },
  { id: "leaderboard", title: "Leaderboard" },
  { id: "settings", title: "Settings" },
  { id: "fees", title: "Fees & rewards" },
  { id: "coming-soon", title: "Coming soon" },
];
