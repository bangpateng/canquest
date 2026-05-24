/** Cached wallet profile so refresh survives brief API / node outages. */

const STORAGE_KEY = "canquest.wallet.me.v1";

export type CachedWalletMe = {
  username?: string | null;
  cantonPartyId?: string | null;
};

export function isRealCantonPartyId(partyId: string | null | undefined): boolean {
  return Boolean(partyId && !partyId.startsWith("canquest:"));
}

export function readCachedWalletMe(): CachedWalletMe | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedWalletMe;
    if (!parsed.username && !isRealCantonPartyId(parsed.cantonPartyId)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** True when session cache can show the wallet dashboard without waiting on /api/me. */
export function hasUsableWalletCache(): boolean {
  const cached = readCachedWalletMe();
  return Boolean(cached?.username && isRealCantonPartyId(cached.cantonPartyId));
}

export function cacheWalletMe(me: CachedWalletMe | null | undefined): void {
  if (typeof window === "undefined" || !me) return;
  if (!me.username && !isRealCantonPartyId(me.cantonPartyId)) return;
  try {
    sessionStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        username: me.username ?? null,
        cantonPartyId: me.cantonPartyId ?? null,
      }),
    );
  } catch {
    /* quota / private mode */
  }
}

export function clearCachedWalletMe(): void {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
