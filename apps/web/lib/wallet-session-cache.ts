/** Cached wallet profile so refresh survives brief API / node outages (per user). */

const STORAGE_PREFIX = "canquest.wallet.me.v2";
const LAST_USER_KEY = "canquest.wallet.userId";
const LEGACY_KEY = "canquest.wallet.me.v1";

export type CachedWalletMe = {
  userId: string;
  username?: string | null;
  cantonPartyId?: string | null;
};

export function isRealCantonPartyId(partyId: string | null | undefined): boolean {
  return Boolean(partyId && !partyId.startsWith("canquest:"));
}

export function readLastWalletUserId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return sessionStorage.getItem(LAST_USER_KEY);
  } catch {
    return null;
  }
}

export function readCachedWalletMe(userId?: string | null): CachedWalletMe | null {
  if (typeof window === "undefined") return null;
  const uid = userId ?? readLastWalletUserId();
  if (!uid) return null;
  try {
    const raw = sessionStorage.getItem(`${STORAGE_PREFIX}.${uid}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedWalletMe;
    if (parsed.userId !== uid) return null;
    if (!parsed.username && !isRealCantonPartyId(parsed.cantonPartyId)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** True when session cache can show the wallet dashboard without waiting on /api/me. */
export function hasUsableWalletCache(userId?: string | null): boolean {
  const cached = readCachedWalletMe(userId);
  return Boolean(cached?.username && isRealCantonPartyId(cached.cantonPartyId));
}

export function cacheWalletMe(
  me:
    | (CachedWalletMe & { id?: string })
    | { id?: string; userId?: string; username?: string | null; cantonPartyId?: string | null }
    | null
    | undefined,
): void {
  if (typeof window === "undefined" || !me) return;
  const userId = ("userId" in me && me.userId) || me.id;
  if (!userId) return;

  try {
    sessionStorage.setItem(LAST_USER_KEY, userId);
    if (!me.username && !isRealCantonPartyId(me.cantonPartyId)) return;
    const entry: CachedWalletMe = {
      userId,
      username: me.username ?? null,
      cantonPartyId: me.cantonPartyId ?? null,
    };
    sessionStorage.setItem(`${STORAGE_PREFIX}.${userId}`, JSON.stringify(entry));
  } catch {
    /* quota / private mode */
  }
}

export function clearCachedWalletMe(): void {
  if (typeof window === "undefined") return;
  try {
    const uid = readLastWalletUserId();
    if (uid) sessionStorage.removeItem(`${STORAGE_PREFIX}.${uid}`);
    sessionStorage.removeItem(LAST_USER_KEY);
    sessionStorage.removeItem(LEGACY_KEY);
  } catch {
    /* ignore */
  }
}
