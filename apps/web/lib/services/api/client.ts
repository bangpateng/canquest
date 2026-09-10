/**
 * Shared API client untuk layer services (lib/services/api/*).
 * Menambahkan JSON helper, ApiError, sinyal maintenance, dan event session expiry.
 * Catatan: sebagian komponen lama masih memakai fetch() langsung.
 */

export const SESSION_EXPIRED_CODE = 'SESSION_EXPIRED' as const;
export const SESSION_EXPIRED_EVENT = 'cq:session-expired' as const;

export type ApiFetchOptions = RequestInit & {
  /** JSON body: sets Content-Type and stringifies. */
  json?: unknown;
};

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function isSessionExpiredBody(body: unknown): boolean {
  return (
    body !== null &&
    typeof body === 'object' &&
    'code' in body &&
    (body as { code?: unknown }).code === SESSION_EXPIRED_CODE
  );
}

export function isSessionExpiredError(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 401 &&
    isSessionExpiredBody(error.body)
  );
}

let sessionExpiredEventQueued = false;

export function notifySessionExpired(): void {
  if (typeof window === 'undefined' || sessionExpiredEventQueued) return;

  sessionExpiredEventQueued = true;
  queueMicrotask(() => {
    try {
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
    } finally {
      sessionExpiredEventQueued = false;
    }
  });
}

export async function apiFetch<T = unknown>(
  path: string,
  options: ApiFetchOptions = {},
): Promise<T> {
  const { json, headers: initHeaders, ...rest } = options;

  const headers = new Headers(initHeaders);
  if (json !== undefined) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, {
    credentials: 'include',
    cache: 'no-store',
    ...rest,
    headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });

  const data: unknown = await res.json().catch(() => null);

  if (!res.ok) {
    if (
      res.status === 503 &&
      data &&
      typeof data === 'object' &&
      (data as { maintenance?: unknown }).maintenance === true &&
      typeof window !== 'undefined'
    ) {
      window.dispatchEvent(new CustomEvent('cq:maintenance'));
    }

    if (res.status === 401 && isSessionExpiredBody(data)) {
      notifySessionExpired();
    }

    const msg =
      data &&
      typeof data === 'object' &&
      'message' in data &&
      typeof (data as { message: unknown }).message === 'string'
        ? (data as { message: string }).message
        : `Request failed (${res.status})`;
    throw new ApiError(msg, res.status, data);
  }

  return data as T;
}
