"use client";

import { useCallback, useState } from 'react';

import { SignPassphraseModal } from '@/components/app/wallet/sign-passphrase-modal';

/**
 * usePassphrasePrompt — prompt passphrase dompet (deferred promise) untuk
 * alur sign-relay saat dompet user external terkunci.
 *
 * Pemakaian:
 *   const { prompt, passphraseModal } = usePassphrasePrompt();
 *   ...
 *   signRelayTransaction(flow, params, { onWalletLocked: () => prompt(desc) })
 *   ...
 *   return (<>{passphraseModal}{...}</>);
 */
export function usePassphrasePrompt() {
  const [state, setState] = useState<{
    description: string;
    resolve: (pass: string) => void;
    reject: () => void;
  } | null>(null);

  const prompt = useCallback((description: string) => {
    return new Promise<string>((resolve, reject) => {
      setState({ description, resolve, reject });
    });
  }, []);

  const passphraseModal = (
    <SignPassphraseModal
      open={!!state}
      description={state?.description}
      onSubmit={(pass) => {
        state?.resolve(pass);
        setState(null);
      }}
      onCancel={() => {
        state?.reject();
        setState(null);
      }}
    />
  );

  return { prompt, passphraseModal };
}
