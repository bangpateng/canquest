import { isSessionExpiredError } from '@/lib/services/api/client';

const DEFAULT_NEXT_PATH = '/ecosystem';

/**
 * Accept only same-origin application paths. Reject protocol-relative URLs,
 * absolute URLs, backslash variants, control characters, and auth redirects
 * that could create redirect loops.
 */
export function safeInternalNextPath(
  candidate: string | null | undefined,
  fallback = DEFAULT_NEXT_PATH,
): string {
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//')) {
    return fallback;
  }

  if (
    candidate.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(candidate)
  ) {
    return fallback;
  }

  try {
    const parsed = new URL(candidate, 'https://canquest.invalid');
    if (parsed.origin !== 'https://canquest.invalid') return fallback;
    if (parsed.pathname === '/api/auth/refresh') return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function currentInternalNextPath(location: Pick<Location, 'pathname' | 'search' | 'hash'>): string {
  return safeInternalNextPath(
    `${location.pathname}${location.search}${location.hash}`,
  );
}

/** Build a full-navigation target understood by the existing auth modal opener. */
export function sessionExpiredLoginUrl(nextPath: string): string {
  const params = new URLSearchParams({
    auth: 'login',
    next: safeInternalNextPath(nextPath),
  });
  return `/?${params.toString()}`;
}

/** React Query must never retry final authentication failures. */
export function shouldRetryQuery(failureCount: number, error: unknown): boolean {
  if (isSessionExpiredError(error)) return false;
  return failureCount < 2;
}
