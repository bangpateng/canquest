export const PLATFORM_LOCALES = [
  { code: "en", label: "English", native: "English" },
  { code: "es", label: "Spanish", native: "Español" },
  { code: "fr", label: "French", native: "Français" },
  { code: "de", label: "German", native: "Deutsch" },
  { code: "pt", label: "Portuguese", native: "Português" },
  { code: "id", label: "Indonesian", native: "Bahasa Indonesia" },
  { code: "zh", label: "Chinese", native: "中文" },
] as const;

export type PlatformLocale = (typeof PLATFORM_LOCALES)[number]["code"];

export type PlatformMessages = {
  nav: {
    overview: string;
    earn: string;
    quests: string;
    spin: string;
    wallet: string;
    leaderboard: string;
    settings: string;
  };
  leaderboard: {
    title: string;
    description: string;
  };
  shell: {
    platform: string;
    landing: string;
    signOut: string;
  };
  theme: {
    light: string;
    dark: string;
    toggle: string;
  };
  lang: {
    label: string;
    select: string;
  };
  common: {
    loading: string;
    viewAll: string;
    refresh: string;
    copy: string;
    copied: string;
    prev: string;
    next: string;
    pageOf: string;
    total: string;
  };
  time: {
    justNow: string;
    minutesAgo: string;
    hoursAgo: string;
    yesterday: string;
    daysAgo: string;
  };
  overview: {
    community: string;
    leaderboard: string;
  };
  dashboard: {
    welcomeBack: string;
    walletActive: string;
    questPoints: string;
    questPointsHint: string;
    ccBalance: string;
    noWallet: string;
    ccBalanceHintLive: string;
    ccBalanceHintCreate: string;
    weeklyRank: string;
    weeklyRankHint: string;
    questsCompleted: string;
    questsCompletedHint: string;
    ccTransactions: string;
    ccTransactionsHint: string;
    walletNotCreated: string;
    walletNotCreatedHint: string;
    createWallet: string;
    recentActivity: string;
    recentActivityHint: string;
    noActivity: string;
    browseEarn: string;
    browseQuests: string;
  };
  quests: {
    searchPlaceholder: string;
    searchLabel: string;
    noMatch: string;
    tryAnother: string;
    noPrograms: string;
    joinQuest: string;
    startQuest: string;
    viewQuest: string;
    viewRecap: string;
    questComplete: string;
  };
  wallet: {
    nodeIssue: string;
    walletActive: string;
    partyId: string;
    balance: string;
    refreshBalance: string;
    estimatedUsd: string;
    sendReceive: string;
    transactionHistory: string;
    checkingPreapproval: string;
    cip56Active: string;
    walletNotConnected: string;
    walletNotConnectedHint: string;
    enablePreapproval: string;
    enablePreapprovalBtn: string;
    enabling: string;
    generateWallet: string;
    generatingWallet: string;
    walletCreatedLoading: string;
  };
  transactions: {
    title: string;
    type: string;
    amount: string;
    description: string;
    counterparty: string;
    ledgerTx: string;
    when: string;
    empty: string;
    page: string;
    questReward: string;
    spinReward: string;
    receivedCc: string;
    sentCc: string;
    airdrop: string;
  };
  settings: {
    signingOut: string;
    signOut: string;
  };
  spin: {
    comingSoon: string;
    comingSoonHint: string;
  };
};
