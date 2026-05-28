export type CooperationNavItem = {
  id: string;
  title: string;
  children?: { id: string; title: string }[];
};

export const COOPERATION_NAV: CooperationNavItem[] = [
  { id: "overview", title: "Overview" },
  { id: "who-its-for", title: "Who it's for" },
  { id: "what-we-offer", title: "What we offer" },
  {
    id: "collaboration-types",
    title: "Collaboration types",
    children: [
      { id: "earn-campaigns", title: "Earn campaigns" },
      { id: "events-launches", title: "Events & launches" },
      { id: "reward-formats", title: "Reward formats" },
    ],
  },
  { id: "how-it-works", title: "How it works" },
  { id: "what-we-need", title: "What we need from you" },
  { id: "get-in-touch", title: "Contact us" },
];
