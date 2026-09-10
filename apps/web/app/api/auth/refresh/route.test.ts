/** @jest-environment node */

import { NextRequest } from 'next/server';

import { POST } from './route';

jest.mock('@/lib/api/internal-api-url', () => ({
  postJsonParse: jest.fn(),
}));

import { postJsonParse } from '@/lib/api/internal-api-url';

const mockPostJsonParse = jest.mocked(postJsonParse);

function request(refreshToken?: string): NextRequest {
  return new NextRequest('https://canquest.test/api/auth/refresh', {
    method: 'POST',
    headers: refreshToken ? { cookie: `cq_refresh=${refreshToken}` } : undefined,
  });
}

function cookieHeaders(response: Response): string {
  return response.headers.get('set-cookie') ?? '';
}

describe('POST /api/auth/refresh', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it('returns SESSION_EXPIRED and clears both auth cookies when the refresh token is missing', async () => {
    const response = await POST(request());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      code: 'SESSION_EXPIRED',
    });
    expect(mockPostJsonParse).not.toHaveBeenCalled();

    const setCookie = cookieHeaders(response);
    expect(setCookie).toContain('cq_access=');
    expect(setCookie).toContain('cq_refresh=');
    expect(setCookie).toMatch(/cq_access=[^,;]*;[^,]*Max-Age=0/i);
    expect(setCookie).toMatch(/cq_refresh=[^,;]*;[^,]*Max-Age=0/i);
  });

  it.each([401, 403])(
    'returns SESSION_EXPIRED and clears both auth cookies when upstream rejects refresh with %s',
    async (status) => {
      mockPostJsonParse.mockResolvedValue({
        res: new Response(JSON.stringify({ message: 'Rejected' }), { status }),
        data: { message: 'Rejected' },
      });

      const response = await POST(request('old-refresh'));

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toMatchObject({
        ok: false,
        code: 'SESSION_EXPIRED',
      });

      const setCookie = cookieHeaders(response);
      expect(setCookie).toContain('cq_access=');
      expect(setCookie).toContain('cq_refresh=');
      expect(setCookie).toMatch(/cq_access=[^,;]*;[^,]*Max-Age=0/i);
      expect(setCookie).toMatch(/cq_refresh=[^,;]*;[^,]*Max-Age=0/i);
    },
  );

  it('rotates both auth cookies after a successful explicit refresh', async () => {
    mockPostJsonParse.mockResolvedValue({
      res: new Response(JSON.stringify({ ok: true }), { status: 200 }),
      data: {
        accessToken: 'new-access',
        refreshToken: 'new-refresh',
      },
    });

    const response = await POST(request('old-refresh'));

    expect(mockPostJsonParse).toHaveBeenCalledWith('/auth/refresh', {
      refreshToken: 'old-refresh',
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });

    const setCookie = cookieHeaders(response);
    expect(setCookie).toContain('cq_access=new-access');
    expect(setCookie).toContain('cq_refresh=new-refresh');
  });

  it.each([500, 502, 503])(
    'forwards temporary upstream %s without clearing cookies',
    async (status) => {
      mockPostJsonParse.mockResolvedValue({
        res: new Response(JSON.stringify({ message: 'Temporary failure' }), {
          status,
        }),
        data: { message: 'Temporary failure' },
      });

      const response = await POST(request('old-refresh'));

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toEqual({
        message: 'Temporary failure',
      });
      expect(cookieHeaders(response)).toBe('');
    },
  );

  it('returns 502 without clearing cookies for a malformed successful response', async () => {
    mockPostJsonParse.mockResolvedValue({
      res: new Response(JSON.stringify({ ok: true }), { status: 200 }),
      data: { ok: true },
    });

    const response = await POST(request('old-refresh'));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      message: 'Authentication service returned an invalid response',
    });
    expect(cookieHeaders(response)).toBe('');
  });

  it('returns 502 without clearing cookies when the refresh request throws', async () => {
    mockPostJsonParse.mockRejectedValue(new TypeError('Network unavailable'));

    const response = await POST(request('old-refresh'));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      message: 'Authentication service temporarily unavailable',
    });
    expect(cookieHeaders(response)).toBe('');
  });
});
