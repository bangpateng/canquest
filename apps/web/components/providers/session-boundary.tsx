'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { clearCachedWalletMe } from '@/lib/auth/wallet-session-cache';
import {
  currentInternalNextPath,
  sessionExpiredLoginUrl,
} from '@/lib/auth/session-expiry';
import { SESSION_EXPIRED_EVENT } from '@/lib/services/api/client';

/**
 * Central boundary for final session-expiry handling.
 *
 * A stable SESSION_EXPIRED response is converted into one browser event by the
 * shared API client. This boundary performs cleanup once, then uses a full
 * navigation so the existing login modal opens with a validated internal next
 * path.
 */
export function SessionBoundary({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const handlingRef = useRef(false);

  useEffect(() => {
    const handleSessionExpired = () => {
      if (handlingRef.current) return;
      handlingRef.current = true;

      const nextPath = currentInternalNextPath(window.location);

      void queryClient
        .cancelQueries()
        .catch(() => undefined)
        .then(() => {
          clearCachedWalletMe();
          queryClient.clear();
          window.location.assign(sessionExpiredLoginUrl(nextPath));
        });
    };

    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => {
      window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    };
  }, [queryClient]);

  return children;
}
