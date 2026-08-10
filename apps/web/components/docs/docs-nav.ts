/**
 * Multi-page docs navigation.
 *
 * Each item maps to a route under `/docs`. Groups provide the sidebar
 * section headings; `children` (optional) renders nested links. The active
 * page is derived from `usePathname()` in the sidebar, so ordering here is
 * also the sidebar order.
 */
export type DocsNavItem = {
  /** Route slug under /docs. Use "" for the index page. */
  slug: string;
  title: string;
};

export type DocsNavGroup = {
  /** Sidebar group heading (e.g. "Get started"). Empty string = no heading. */
  group: string;
  items: DocsNavItem[];
};

export const DOCS_NAV: DocsNavGroup[] = [
  {
    group: "",
    items: [{ slug: "", title: "Introduction" }],
  },
  {
    group: "Get started",
    items: [
      { slug: "getting-started", title: "Getting started" },
      { slug: "concepts", title: "Core concepts" },
      { slug: "anti-sybil", title: "Verification & anti-sybil" },
    ],
  },
  {
    group: "Using the app",
    items: [
      { slug: "wallet", title: "Wallet — CC, tokens & swap" },
      { slug: "quests", title: "Quests & reward claims" },
      { slug: "earn", title: "Earn — daily tasks & points" },
    ],
  },
  {
    group: "Partners",
    items: [{ slug: "campaigns", title: "Campaigns for partners" }],
  },
  {
    group: "Reference",
    items: [{ slug: "faq", title: "FAQ" }],
  },
];

/** Flattened list of all doc pages (slug + title), for prev/next paging. */
export const DOCS_FLAT: DocsNavItem[] = DOCS_NAV.flatMap((g) => g.items);

/** Absolute href for a doc slug (handles the index case). */
export function docsHref(slug: string): string {
  return slug === "" ? "/docs" : `/docs/${slug}`;
}
