import { act, render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import { SessionBoundary } from './session-boundary';
import { SESSION_EXPIRED_EVENT } from '@/lib/services/api/client';
import { clearCachedWalletMe } from '@/lib/auth/wallet-session-cache';

const cancelQueries = jest.fn();
const clear = jest.fn();

jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ cancelQueries, clear }),
}));

jest.mock('@/lib/auth/wallet-session-cache', () => ({
  clearCachedWalletMe: jest.fn(),
}));

jest.mock('@/lib/auth/session-expiry', () => ({
  currentInternalNextPath: jest.fn(() => '/quests?tab=active'),
  sessionExpiredLoginUrl: jest.fn(
    (nextPath: string) => `/?auth=login&next=${encodeURIComponent(nextPath)}`,
  ),
}));

function Wrapper({ children }: { children: ReactNode }) {
  return <SessionBoundary>{children}</SessionBoundary>;
}

describe('SessionBoundary', () => {
  beforeEach(() => {
    cancelQueries.mockReset();
    clear.mockReset();
    jest.mocked(clearCachedWalletMe).mockReset();
    cancelQueries.mockResolvedValue(undefined);
  });

  it('cancels queries before clearing wallet and query caches', async () => {
    let resolveCancellation: (() => void) | undefined;
    cancelQueries.mockReturnValue(
      new Promise<void>((resolve) => {
        resolveCancellation = resolve;
      }),
    );

    render(<Wrapper>content</Wrapper>);

    act(() => {
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
    });

    expect(cancelQueries).toHaveBeenCalledTimes(1);
    expect(clearCachedWalletMe).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();

    await act(async () => {
      resolveCancellation?.();
      await Promise.resolve();
    });

    expect(clearCachedWalletMe).toHaveBeenCalledTimes(1);
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it('still performs cache cleanup when query cancellation rejects', async () => {
    cancelQueries.mockRejectedValue(new Error('Cancellation failed'));

    render(<Wrapper>content</Wrapper>);

    act(() => {
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
    });

    await waitFor(() => {
      expect(clearCachedWalletMe).toHaveBeenCalledTimes(1);
      expect(clear).toHaveBeenCalledTimes(1);
    });
  });

  it('deduplicates repeated session-expired events', async () => {
    render(<Wrapper>content</Wrapper>);

    act(() => {
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
      window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
    });

    await waitFor(() => {
      expect(cancelQueries).toHaveBeenCalledTimes(1);
      expect(clearCachedWalletMe).toHaveBeenCalledTimes(1);
      expect(clear).toHaveBeenCalledTimes(1);
    });
  });
});
