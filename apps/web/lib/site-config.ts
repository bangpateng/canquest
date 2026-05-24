/** Public site links — set in apps/web/.env.local */

function normalizeTwitterUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const handle = trimmed.replace(/^@/, "").replace(/^x\.com\//i, "").split("/")[0];
  return `https://x.com/${handle}`;
}

function normalizeTelegramUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^t\.me\//i.test(trimmed)) return `https://${trimmed}`;
  const handle = trimmed.replace(/^@/, "").replace(/^t\.me\//i, "").split("/")[0];
  return `https://t.me/${handle}`;
}

function normalizeHttpUrl(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export type SiteSocialLinkId = "twitter" | "telegram" | "discord" | "brand_kit";

export type SiteSocialLink = {
  id: SiteSocialLinkId;
  label: string;
  href: string;
};

/** Footer / marketing social links from env (only configured URLs are shown). */
export function getSiteSocialLinks(): SiteSocialLink[] {
  const links: SiteSocialLink[] = [];

  const twitter = process.env.NEXT_PUBLIC_TWITTER_URL;
  if (twitter?.trim()) {
    const href = normalizeTwitterUrl(twitter);
    if (href) links.push({ id: "twitter", label: "Twitter", href });
  }

  const telegram = process.env.NEXT_PUBLIC_TELEGRAM_URL;
  if (telegram?.trim()) {
    const href = normalizeTelegramUrl(telegram);
    if (href) links.push({ id: "telegram", label: "Telegram", href });
  }

  const discord = process.env.NEXT_PUBLIC_DISCORD_URL;
  if (discord?.trim()) {
    const href = normalizeHttpUrl(discord);
    if (href) links.push({ id: "discord", label: "Discord", href });
  }

  const brandKit = process.env.NEXT_PUBLIC_BRAND_KIT_URL;
  if (brandKit?.trim()) {
    const href = normalizeHttpUrl(brandKit);
    if (href) links.push({ id: "brand_kit", label: "Brand Kit", href });
  }

  return links;
}
