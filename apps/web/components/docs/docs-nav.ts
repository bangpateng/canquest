export type DocsNavItem = {
  id: string;
  title: string;
  children?: { id: string; title: string }[];
};

export const DOCS_NAV: DocsNavItem[] = [
  { id: "introduction", title: "Introduction" },
  { id: "getting-started", title: "Getting started" },
  { id: "landing-page", title: "Landing page" },
  { id: "app-menus", title: "App menus" },
  {
    id: "what-you-can-do",
    title: "What you can do",
    children: [
      { id: "reward-types", title: "Reward types" },
      { id: "partner-campaigns", title: "Partner campaigns" },
      { id: "daily-hub", title: "Daily hub" },
      { id: "wallet-cc", title: "Wallet & CC" },
      { id: "compete-customize", title: "Compete & customize" },
      { id: "coming-soon", title: "Coming soon" },
    ],
  },
];
