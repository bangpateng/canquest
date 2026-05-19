/** Server-only base URL for the Nest API (global prefix `/api`). */
export function internalApiBase(): string {
  const u = process.env.INTERNAL_API_URL?.trim().replace(/\/$/, '');
  return u ?? 'http://localhost:3001/api';
}

export async function postJsonParse<T>(
  path: string,
  body: unknown,
): Promise<{ res: Response; data: T }> {
  const res = await fetch(`${internalApiBase()}${path.startsWith('/') ? path : `/${path}`}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const text = await res.text();
  let data: T;
  try {
    data = text ? (JSON.parse(text) as T) : ({} as T);
  } catch {
    data = {} as T;
  }
  return { res, data };
}
