/** Bentuk row partner dari GET /api/partners (sudah di-parse di backend). */

export type PartnerSocialLink = { platform: string; url: string };

export type PartnerTeamMember = {
  initials: string;
  name: string;
  role: string;
  socials?: PartnerSocialLink[];
};

export type PartnerAppFeatured = {
  name: string;
  description?: string;
  url?: string;
};

export type Partner = {
  id: string;
  name: string;
  initials: string;
  logoUrl: string | null;
  category: string;
  about: string;
  website: string | null;
  socialLinks: PartnerSocialLink[];
  team: PartnerTeamMember[];
  appsFeatured: PartnerAppFeatured[];
  features: PartnerFeature[];
  createdAt: string;
  activeQuestCount?: number;
};

export type PartnerFeature = { title: string; description?: string };

/** Kategori tetap — harus match PARTNER_CATEGORIES di apps/api/src/common/prisma-types.ts. */
export const PARTNER_CATEGORIES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "COMPLIANCE", label: "Compliance" },
  { value: "CUSTODY", label: "Custody" },
  { value: "DATA_ANALYTICS", label: "Data & Analytics" },
  { value: "DEVELOPER_TOOLS", label: "Developer Tools" },
  { value: "EXCHANGES", label: "Exchanges" },
  { value: "FINANCING", label: "Financing" },
  { value: "FORENSICS_SECURITY", label: "Forensics & Security" },
  { value: "INTEROPERABILITY", label: "Interoperability" },
  { value: "LIQUIDITY", label: "Liquidity" },
  { value: "NAAS", label: "NaaS" },
  { value: "PAYMENTS", label: "Payments" },
  { value: "STABLECOINS", label: "Stablecoins" },
  { value: "TOKENIZED_ASSETS", label: "Tokenized Assets" },
  { value: "WALLETS", label: "Wallets" },
];

export function partnerCategoryLabel(value: string): string {
  return PARTNER_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}
