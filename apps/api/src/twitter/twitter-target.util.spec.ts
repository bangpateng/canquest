import {
  parseTweetIdFromTarget,
  parseTwitterFollowTarget,
} from './twitter-target.util';

describe('parseTweetIdFromTarget', () => {
  it('parses x.com status URL', () => {
    expect(
      parseTweetIdFromTarget('https://x.com/canquest/status/1846987139428634858'),
    ).toBe('1846987139428634858');
  });

  it('parses twitter.com /i/web/status URL', () => {
    expect(
      parseTweetIdFromTarget('https://twitter.com/i/web/status/1846987139428634858'),
    ).toBe('1846987139428634858');
  });

  it('parses raw numeric id', () => {
    expect(parseTweetIdFromTarget('1846987139428634858')).toBe('1846987139428634858');
  });

  it('rejects profile-only URL', () => {
    expect(parseTweetIdFromTarget('https://x.com/alpendhq')).toBeNull();
  });
});

describe('parseTwitterFollowTarget', () => {
  it('parses handle', () => {
    expect(parseTwitterFollowTarget('@CanQuest')).toBe('canquest');
  });

  it('parses profile URL', () => {
    expect(parseTwitterFollowTarget('https://x.com/alpendhq')).toBe('alpendhq');
  });
});
