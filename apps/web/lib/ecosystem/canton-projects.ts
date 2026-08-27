/**
 * Curated Canton Network ecosystem projects.
 * Organized by category with metadata for rich display.
 */
export interface EcosystemProject {
  name: string;
  symbol: string;
  category: "DEX" | "Quest" | "Infrastructure" | "Wallet" | "Network" | "Data" | "DeFi" | "Validator";
  description: string;
  url: string;
  icon: string;
  gradient: string;
  status: "live" | "beta" | "soon";
  featured?: boolean;
  stats?: { label: string; value: string }[];
}

export const ECOSYSTEM_CATEGORIES = [
  "All",
  "DeFi",
  "DEX",
  "Quest",
  "Infrastructure",
  "Wallet",
  "Data",
  "Network",
] as const;

export const CANTON_PROJECTS: EcosystemProject[] = [
  // ── Featured ──
  {
    name: "Canton Network",
    symbol: "CC",
    category: "Network",
    description: "The privacy-enabled blockchain for institutional assets. Built by Digital Asset, backed by Goldman Sachs, BNP Paribas, and others.",
    url: "https://canton.network",
    icon: "🌐",
    gradient: "from-blue-600/30 via-cyan-500/20 to-transparent",
    status: "live",
    featured: true,
    stats: [
      { label: "Consensus", value: "BFT" },
      { label: "Privacy", value: "Native" },
    ],
  },
  {
    name: "CanQuest",
    symbol: "CQ",
    category: "Quest",
    description: "Quest & reward platform on Canton. Complete on-chain tasks, earn CC and tokens, join partner campaigns.",
    url: "https://www.canquest.cc",
    icon: "🎯",
    gradient: "from-emerald-600/30 via-lime-500/20 to-transparent",
    status: "live",
    featured: true,
    stats: [
      { label: "Members", value: "2,900+" },
      { label: "Rewards", value: "CC + USDCx" },
    ],
  },
  {
    name: "OneSwap",
    symbol: "1SWAP",
    category: "DEX",
    description: "On-chain swap protocol for Canton Network. Instant CC ↔ USDCx swaps with transparent fees.",
    url: "https://oneswap.cc",
    icon: "🔄",
    gradient: "from-violet-600/30 via-purple-500/20 to-transparent",
    status: "live",
    featured: true,
    stats: [
      { label: "Pairs", value: "CC/USDCx" },
      { label: "Fee", value: "0.30%" },
    ],
  },
  {
    name: "Tradecraft",
    symbol: "TC",
    category: "DEX",
    description: "The exchange layer for Canton. AMM pools with commitment locking, transparent incentives, and on-chain settlement.",
    url: "https://tradecraft.fi",
    icon: "📊",
    gradient: "from-amber-600/30 via-orange-500/20 to-transparent",
    status: "live",
    stats: [
      { label: "Model", value: "AMM" },
      { label: "Fee", value: "0.30%" },
    ],
  },

  // ── DeFi & DEX ──
  {
    name: "USDCx",
    symbol: "USDCx",
    category: "DeFi",
    description: "Bridged USDC on Canton Network by Circle. The leading stablecoin for DeFi on Canton.",
    url: "https://circle.com",
    icon: "💵",
    gradient: "from-blue-500/25 via-indigo-400/15 to-transparent",
    status: "live",
    stats: [{ label: "Issuer", value: "Circle" }],
  },

  // ── Infrastructure ──
  {
    name: "Canton Token Foundation",
    symbol: "CTF",
    category: "Infrastructure",
    description: "Governance and token standards for the Canton ecosystem.",
    url: "https://canton.network",
    icon: "🏛️",
    gradient: "from-slate-500/25 via-gray-400/15 to-transparent",
    status: "live",
  },
  {
    name: "Splice",
    symbol: "SPL",
    category: "Infrastructure",
    description: "Validator and sequencer infrastructure powering Canton Network — staking, sequencing, and security.",
    url: "https://canton.network",
    icon: "🔒",
    gradient: "from-teal-500/25 via-emerald-400/15 to-transparent",
    status: "live",
  },
  {
    name: "Global Synchronizer",
    symbol: "GS",
    category: "Infrastructure",
    description: "Cross-domain messaging layer enabling interoperability between Canton applications and domains.",
    url: "https://canton.network",
    icon: "🔗",
    gradient: "from-cyan-500/25 via-blue-400/15 to-transparent",
    status: "live",
  },

  // ── Data & Analytics ──
  {
    name: "CCTools",
    symbol: "CC",
    category: "Data",
    description: "Analytics, ecosystem mapping, portfolio tracking, and network stats for Canton.",
    url: "https://cctools.network",
    icon: "📈",
    gradient: "from-pink-500/25 via-rose-400/15 to-transparent",
    status: "live",
    stats: [
      { label: "Projects", value: "493+" },
      { label: "TVL Source", value: "DefiLlama" },
    ],
  },

  // ── Wallets ──
  {
    name: "Nuxaris",
    symbol: "NUX",
    category: "Wallet",
    description: "Non-custodial wallet for Canton Network with browser-key signing.",
    url: "https://nuxaris.xyz",
    icon: "👛",
    gradient: "from-fuchsia-500/25 via-pink-400/15 to-transparent",
    status: "beta",
  },
];
