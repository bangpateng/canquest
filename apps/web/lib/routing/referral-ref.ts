const STORAGE_KEY = "canquest_referral_ref";

/** Persist ?ref= from invite links until registration completes. */
export function storeReferralRef(code: string): void {
  const normalized = code.trim().toUpperCase();
  if (!normalized || normalized.length < 4) return;
  try {
    sessionStorage.setItem(STORAGE_KEY, normalized);
  } catch {
    /* ignore */
  }
}

export function getReferralRef(): string {
  try {
    return sessionStorage.getItem(STORAGE_KEY)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function clearReferralRef(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}
