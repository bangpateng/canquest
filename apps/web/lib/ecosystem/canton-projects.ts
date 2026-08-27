/**
 * Curated Canton Network ecosystem projects.
 *
 * Static data — known projects + DEXes + infrastructure on Canton.
 * Campaign partners auto-merge from /api/quests (org field) at runtime
 * (see ecosystem-projects.tsx).
 */
export interface EcosystemProject {
  name: string;
  symbol: string;
  category: "DEX" | "Quest" | "Infrastructure" | "Wallet" | "Network" | "Data";
  description: string;
  url: string;
  icon: string;
  accent: string;
  featured?: boolean;
}

export const CANTON_PROJECTS: EcosystemProject[] = [
  {
    name: "Canton Network",
    symbol: "CC",
    category: "Network",
    description:
      "The privacy-enabled blockchain designed for institutional assets. Built by Digital Asset.",
    url: "https://canton.network",
    icon: "🌐",
    accent: "from-blue-500/20 to-cyan-500/10",
    featured: true,
  },
  {
    name: "CanQuest",
    symbol: "CQ",
    category: "Quest",
    description:
      "Quest & reward platform on Canton — earn CC and tokens by completing on-chain tasks.",
    url: "https://www.canquest.cc",
    icon: "🎯",
    accent: "from-emerald-500/20 to-lime-500/10",
    featured: true,
  },
  {
    name: "OneSwap",
    symbol: "1SWAP",
    category: "DEX",
    description:
      "On-chain swap protocol for Canton Network. Trade CC ↔ USDCx and more.",
    url: "https://oneswap.cc",
    icon: "🔄",
    accent: "from-violet-500/20 to-purple-500/10",
    featured: true,
  },
  {
    name: "Tradecraft",
    symbol: "TC",
    category: "DEX",
    description:
      "The exchange layer for Canton Network — AMM pools with transparent fees.",
    url: "https://tradecraft.fi",
    icon: "📊",
    accent: "from-amber-500/20 to-orange-500/10",
  },
  {
    name: "Canton Token Foundation",
    symbol: "CTF",
    category: "Infrastructure",
    description:
      "Governance and token standards for the Canton ecosystem.",
    url: "https://canton.network",
    icon: "🏛️",
    accent: "from-slate-500/20 to-gray-500/10",
  },
  {
    name: "Splice Validator",
    symbol: "SPL",
    category: "Infrastructure",
    description:
      "Validator infrastructure powering the Canton Network — staking, sequencing, and security.",
    url: "https://canton.network",
    icon: "🔒",
    accent: "from-teal-500/20 to-emerald-500/10",
  },
  {
    name: "CCTools",
    symbol: "CC",
    category: "Data",
    description:
      "Analytics, ecosystem mapping, and portfolio tracking for Canton Network.",
    url: "https://cctools.network",
    icon: "📈",
    accent: "from-pink-500/20 to-rose-500/10",
  },
  {
    name: "USDCx",
    symbol: "USDCx",
    category: "Infrastructure",
    description:
      "Bridged USDC on Canton Network — the leading stablecoin for DeFi on Canton.",
    url: "https://circle.com",
    icon: "💵",
    accent: "from-blue-500/20 to-indigo-500/10",
  },
];
