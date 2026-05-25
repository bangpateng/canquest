/** True when user has a real Canton party (not a local placeholder). */
export function hasRealWallet(cantonPartyId: string | null | undefined): boolean {
  const id = cantonPartyId?.trim();
  return Boolean(id && !id.startsWith("canquest:"));
}

/** Routes that require a Canton wallet (logged-in account is not enough). */
export const WALLET_GATED_HREFS = ["/earn", "/spin-reward"] as const;

export function hrefRequiresWallet(href: string): boolean {
  return WALLET_GATED_HREFS.some((p) => href === p || href.startsWith(`${p}/`));
}
