import {
  currentInternalNextPath,
  safeInternalNextPath,
  sessionExpiredLoginUrl,
} from './session-expiry';

describe('safeInternalNextPath', () => {
  it('preserves a valid internal path with query and hash', () => {
    expect(safeInternalNextPath('/quests/123?tab=details#claim')).toBe(
      '/quests/123?tab=details#claim',
    );
  });

  it.each([
    null,
    undefined,
    '',
    'quests',
    'https://evil.example/steal',
    '//evil.example/steal',
    '/\\evil.example/steal',
    '/safe\nunsafe',
    '/api/auth/refresh',
  ])('rejects unsafe next path %p', (candidate) => {
    expect(safeInternalNextPath(candidate)).toBe('/ecosystem');
  });

  it('uses the supplied fallback for an unsafe path', () => {
    expect(safeInternalNextPath('//evil.example', '/dashboard')).toBe(
      '/dashboard',
    );
  });

  it('builds the current internal path from location components', () => {
    expect(
      currentInternalNextPath({
        pathname: '/quests/123',
        search: '?tab=details',
        hash: '#claim',
      } as Location),
    ).toBe('/quests/123?tab=details#claim');
  });

  it('builds a login URL with an encoded validated next path', () => {
    expect(sessionExpiredLoginUrl('/quests/123?tab=details#claim')).toBe(
      '/?auth=login&next=%2Fquests%2F123%3Ftab%3Ddetails%23claim',
    );
  });

  it('replaces an unsafe login next path with the default', () => {
    expect(sessionExpiredLoginUrl('//evil.example')).toBe(
      '/?auth=login&next=%2Fecosystem',
    );
  });
});
