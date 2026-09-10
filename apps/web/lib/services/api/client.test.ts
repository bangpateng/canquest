import {
  ApiError,
  SESSION_EXPIRED_EVENT,
  apiFetch,
  isSessionExpiredError,
} from './client';

function mockJsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}

describe('apiFetch session-expiry handling', () => {
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

  it('emits only one session-expired event for parallel marked 401 responses', async () => {
    const listener = jest.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, listener);

    jest.spyOn(global, 'fetch').mockImplementation(async () =>
      mockJsonResponse(401, {
        code: 'SESSION_EXPIRED',
        message: 'Session expired',
      }),
    );

    const results = await Promise.allSettled([
      apiFetch('/api/one'),
      apiFetch('/api/two'),
      apiFetch('/api/three'),
    ]);

    await Promise.resolve();

    expect(results).toHaveLength(3);
    expect(results.every((result) => result.status === 'rejected')).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    for (const result of results) {
      if (result.status === 'rejected') {
        expect(isSessionExpiredError(result.reason)).toBe(true);
      }
    }

    window.removeEventListener(SESSION_EXPIRED_EVENT, listener);
  });

  it('does not treat a business 403 as session expiry', async () => {
    const listener = jest.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, listener);

    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(
        mockJsonResponse(403, { message: 'Action is not allowed' }),
      );

    await expect(apiFetch('/api/business-action')).rejects.toMatchObject({
      status: 403,
      body: { message: 'Action is not allowed' },
    } satisfies Partial<ApiError>);

    await Promise.resolve();
    expect(listener).not.toHaveBeenCalled();

    window.removeEventListener(SESSION_EXPIRED_EVENT, listener);
  });

  it.each([500, 502, 503])(
    'does not force logout for temporary HTTP %s failures',
    async (status) => {
      const listener = jest.fn();
      window.addEventListener(SESSION_EXPIRED_EVENT, listener);

      jest
        .spyOn(global, 'fetch')
        .mockResolvedValue(
          mockJsonResponse(status, { message: 'Temporary upstream failure' }),
        );

      await expect(apiFetch('/api/temporary')).rejects.toMatchObject({ status });
      await Promise.resolve();
      expect(listener).not.toHaveBeenCalled();

      window.removeEventListener(SESSION_EXPIRED_EVENT, listener);
    },
  );

  it('propagates network failures without emitting session expiry', async () => {
    const listener = jest.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, listener);

    jest.spyOn(global, 'fetch').mockRejectedValue(new TypeError('Network unavailable'));

    await expect(apiFetch('/api/network')).rejects.toThrow('Network unavailable');
    await Promise.resolve();
    expect(listener).not.toHaveBeenCalled();

    window.removeEventListener(SESSION_EXPIRED_EVENT, listener);
  });
});
