export const PLATFORM_LOCALES = [
  { code: "en", label: "English", native: "English" },
  { code: "es", label: "Spanish", native: "Español" },
  { code: "fr", label: "French", native: "Français" },
  { code: "de", label: "German", native: "Deutsch" },
  { code: "pt", label: "Portuguese", native: "Português" },
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
  notifications: {
    title: string;
    aria: string;
    empty: string;
    markRead: string;
    viewWallet: string;
    toastEarn: string;
    toastSpin: string;
    toastReceived: string;
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
  walletGate: {
    title: string;
    description: string;
    createWallet: string;
    navLocked: string;
    quotaRemaining: string;
    quotaFull: string;
  };
  questReferral: {
    aria: string;
    title: string;
    perFriend: string;
    lead: string;
    invited: string;
    earned: string;
    copyLink: string;
    loadError: string;
    copyError: string;
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
  earnCampaigns: {
    title: string;
    description: string;
    badge: string;
    heroSubtitle: string;
    dailyTasksLink: string;
    statsAria: string;
    statsLabel: string;
    live: string;
    active: string;
    completed: string;
    total: string;
    howItWorks: string;
    rewardCcTitle: string;
    rewardCcDesc: string;
    rewardInviteTitle: string;
    rewardInviteDesc: string;
    rewardFcfsTitle: string;
    rewardFcfsDesc: string;
    campaignsHeader: string;
    campaignsLead: string;
    progressCompleted: string;
    loadFailed: string;
    loadFailedHint: string;
    noCampaignsHint: string;
    tryOtherTab: string;
    showingCount: string;
    rewardLabel: string;
    kindFcfs: string;
    kindCc: string;
    kindInvite: string;
    kindWaitlist: string;
    kindRaffle: string;
    kindCampaign: string;
    dailyTasks: string;
    cardRewardPerWinner: string;
    cardFcfsSlots: string;
    cardClaimFlow: string;
    cardClaimFee: string;
    cardPoolTotal: string;
    cardCodesRemaining: string;
    slotsEnded: string;
    slotsClaimed: string;
    viewMyQuest: string;
    slotsFullBanner: string;
    slotsFullClosedBanner: string;
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
    profileStale: string;
    profileStaleHint: string;
    reconnectTitle: string;
    reconnectHint: string;
    reconnectBtn: string;
    reconnecting: string;
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
    referralTitle: string;
    referralLead: string;
    referralRewardHint: string;
    referralInvited: string;
    referralPointsEarned: string;
    referralCodeLabel: string;
    referralLinkLabel: string;
    referralCopyCode: string;
    referralCopyLink: string;
    referralCopied: string;
    referralLoadError: string;
    referralCopyError: string;
    referralCodeOptional: string;
  };
  spin: {
    pageLead: string;
    pointsAvailable: string;
    spinCost: string;
    spinNow: string;
    spinning: string;
    rewardsPool: string;
    history: string;
    historyEmpty: string;
    noItems: string;
    noItemsHint: string;
    statusDelivered: string;
    statusPending: string;
    pointsSpent: string;
    loadError: string;
    retry: string;
  };
};
