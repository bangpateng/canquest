"use client";

import { useCallback } from 'react';

import { useMe } from '@/lib/hooks/use-me';
import { signRelayPrepared } from './sign-relay';
import { usePassphrasePrompt } from './use-passphrase-prompt';

export type ExternalClaimType =
  | 'fcfs'
  | 'draw_cc'
  | 'invite'
  | 'cc_code_raffle';

/**
 * useExternalClaimFee — klaim quest oleh user external (M3b, semua tipe
 * campaign): siapkan fee leg (precheck server) → tanda tangan di browser
 * (passphrase bila terkunci) → return externalFeeTxId untuk endpoint klaim.
 *
 * Pemakaian:
 *   const { isExternalWallet, signClaimFee, passphraseModal } = useExternalClaimFee();
 *   ...
 *   const externalFeeTxId = await signClaimFee(questId, 'draw_cc', fee, label);
 *   ...fetch claim dengan body { externalFeeTxId }
 *   ...render {passphraseModal}
 */
export function useExternalClaimFee() {
  const { me } = useMe();
  const isExternalWallet = me?.walletKind === 'external';
  const { prompt: promptPassphrase, passphraseModal } = usePassphrasePrompt();

  const signClaimFee = useCallback(
    async (
      questId: string,
      claimType: ExternalClaimType,
      fee: number,
      label?: string,
    ): Promise<string | undefined> => {
      if (!isExternalWallet || fee <= 0) return undefined;

      const prep = await fetch(
        `/api/quests/${questId}/claim-external/prepare`,
        {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ claimType }),
        },
      );
      const prepRaw = (await prep.json().catch(() => null)) as {
        hash?: string;
        description?: string;
        message?: string;
      } | null;
      if (!prep.ok || !prepRaw?.hash) {
        throw new Error(prepRaw?.message ?? 'Failed to prepare the claim fee.');
      }

      const signed = await signRelayPrepared(
        { hash: prepRaw.hash, description: prepRaw.description },
        {
          onWalletLocked: () =>
            promptPassphrase(label ?? `Claim fee ${fee} CC`),
        },
      );
      return signed.updateId;
    },
    [isExternalWallet, promptPassphrase],
  );

  return { isExternalWallet, signClaimFee, passphraseModal };
}
