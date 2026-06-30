/**
 * Isolated API client — all browser → Next BFF calls go through here.
 * Does not change endpoints, payloads, or cookie behavior.
 */

export type ApiFetchOptions = RequestInit & {
  /** JSON body — sets Content-Type and stringifies */
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
    // Maintenance 503 → sinyalkan overlay global tampil INSTAN (tanpa nunggu poll).
    if (
      res.status === 503 &&
      data &&
      typeof data === 'object' &&
      (data as { maintenance?: unknown }).maintenance === true &&
      typeof window !== 'undefined'
    ) {
      window.dispatchEvent(new CustomEvent('cq:maintenance'));
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
