/** @jest-environment node */

import { NextRequest } from 'next/server';

import { nestWithAccessCookie } from './nest-proxy-cookie-jwt';

function request(cookies: Record<string, string>): NextRequest {
  return new NextRequest('https://canquest.test/api/example', {
    headers: {
      cookie: Object.entries(cookies)
        .map(([name, value]) => `${name}=${value}`)
        .join('; '),
    },
  });
}

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function cookieHeaders(result: Response): string {
  return result.headers.get('set-cookie') ?? '';
}

describe('nestWithAccessCookie session refresh', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: jest.fn(),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('refreshes after an upstream 401, retries with the new access token, and rotates cookies', async () => {
    const fetchMock = jest.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(response(401, { message: 'Unauthorized' }))
      .mockResolvedValueOnce(
        response(200, {
          accessToken: 'new-access',
          refreshToken: 'new-refresh',
        }),
      )
      .mockResolvedValueOnce(response(200, { ok: true }));

    const result = await nestWithAccessCookie(
      request({ cq_access: 'old-access', cq_refresh: 'old-refresh' }),
      '/example',
      { method: 'GET' },
    );

    expect(result.status).toBe(200);
    await expect(result.json()).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const firstHeaders = new Headers(fetchMock.mock.calls[0][1]?.headers);
    const retryHeaders = new Headers(fetchMock.mock.calls[2][1]?.headers);
    expect(firstHeaders.get('authorization')).toBe('Bearer old-access');
    expect(retryHeaders.get('authorization')).toBe('Bearer new-access');

    const setCookie = cookieHeaders(result);
    expect(setCookie).toContain('cq_access=new-access');
    expect(setCookie).toContain('cq_refresh=new-refresh');
  });

  it.each([401, 403])(
    'returns SESSION_EXPIRED and clears both cookies when refresh is rejected with %s',
    async (refreshStatus) => {
      const fetchMock = jest.mocked(fetch);
      fetchMock
        .mockResolvedValueOnce(response(401, { message: 'Unauthorized' }))
        .mockResolvedValueOnce(response(refreshStatus, { message: 'Rejected' }));

      const result = await nestWithAccessCookie(
        request({ cq_access: 'old-access', cq_refresh: 'old-refresh' }),
        '/example',
        { method: 'GET' },
      );

      expect(result.status).toBe(401);
      await expect(result.json()).resolves.toMatchObject({
        code: 'SESSION_EXPIRED',
      });

      const setCookie = cookieHeaders(result);
      expect(setCookie).toContain('cq_access=');
      expect(setCookie).toContain('cq_refresh=');
      expect(setCookie).toMatch(/cq_access=[^,;]*;[^,]*Max-Age=0/i);
      expect(setCookie).toMatch(/cq_refresh=[^,;]*;[^,]*Max-Age=0/i);
    },
  );

  it('returns SESSION_EXPIRED and clears both cookies when the refresh token is missing', async () => {
    jest.mocked(fetch).mockResolvedValueOnce(
      response(401, { message: 'Unauthorized' }),
    );

    const result = await nestWithAccessCookie(
      request({ cq_access: 'old-access' }),
      '/example',
      { method: 'GET' },
    );

    expect(result.status).toBe(401);
    await expect(result.json()).resolves.toMatchObject({
      code: 'SESSION_EXPIRED',
    });

    const setCookie = cookieHeaders(result);
    expect(setCookie).toContain('cq_access=');
    expect(setCookie).toContain('cq_refresh=');
  });

  it.each([
    ['network failure', () => Promise.reject(new TypeError('Network unavailable'))],
    [
      'timeout',
      () => {
        const error = new Error('Request timed out');
        error.name = 'TimeoutError';
        return Promise.reject(error);
      },
    ],
    ['malformed success response', () => Promise.resolve(response(200, { ok: true }))],
    ['5xx response', () => Promise.resolve(response(503, { message: 'Unavailable' }))],
  ])(
    'returns a temporary failure without clearing cookies for refresh %s',
    async (_label, refreshResult) => {
      const fetchMock = jest.mocked(fetch);
      fetchMock
        .mockResolvedValueOnce(response(401, { message: 'Unauthorized' }))
        .mockImplementationOnce(refreshResult);

      const result = await nestWithAccessCookie(
        request({ cq_access: 'old-access', cq_refresh: 'old-refresh' }),
        '/example',
        { method: 'GET' },
      );

      expect(result.status).toBe(502);
      await expect(result.json()).resolves.toMatchObject({
        message: 'Authentication service temporarily unavailable',
      });
      expect(cookieHeaders(result)).toBe('');
    },
  );

  it('preserves an ordinary upstream business 403 without refreshing or clearing cookies', async () => {
    const fetchMock = jest.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      response(403, { message: 'Action is not allowed' }),
    );

    const result = await nestWithAccessCookie(
      request({ cq_access: 'valid-access', cq_refresh: 'valid-refresh' }),
      '/business-action',
      { method: 'POST', body: '{}' },
    );

    expect(result.status).toBe(403);
    await expect(result.json()).resolves.toEqual({
      message: 'Action is not allowed',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(cookieHeaders(result)).toBe('');
  });
});
