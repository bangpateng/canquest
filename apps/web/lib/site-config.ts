/** Public site links — set in apps/web/.env.local */

function normalizeTwitterUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const handle = trimmed.replace(/^@/, "").replace(/^x\.com\//i, "").split("/")[0];
  return `https://x.com/${handle}`;
}

export type SiteSocialLink = {
  id: "twitter";
  label: string;
  href: string;
};

/** Footer / marketing social links from env. */
export function getSiteSocialLinks(): SiteSocialLink[] {
  const twitter = process.env.NEXT_PUBLIC_TWITTER_URL;
  if (!twitter?.trim()) return [];

  const href = normalizeTwitterUrl(twitter);
  if (!href) return [];

  return [{ id: "twitter", label: "X (Twitter)", href }];
}
