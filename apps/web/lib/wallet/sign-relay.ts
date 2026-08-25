/**
 * Sign relay client (M3) — helper dua-langkah tanda tangan transaksi.
 *
 * Pola: /api/party/sign/prepare (hash) → signPreparedHash di browser
 * (kunci user; throws kalau dompet terkunci → UI minta passphrase dulu)
 * → /api/party/sign/execute (signature) → updateId on-chain.
 *
 * Private key tidak pernah keluar dari perangkat.
 */

import { signPreparedHash, unlock } from './key-manager';

export interface SignRelayResult {
  flow: string;
  updateId?: string;
  completionOffset?: number;
}

export interface SignRelayOptions {
  /**
   * Dipanggil kalau dompet masih terkunci saat menandatangani. UI menampilkan
   * prompt passphrase dan resolve dengan passphrase-nya; helper akan unlock
   * lalu menandatangani ulang. Resolve dengan passphrase kosong = batal.
   */
  onWalletLocked?: (description: string) => Promise<string>;
}

async function signWithUnlock(
  hash: string,
  description: string,
  options?: SignRelayOptions,
): Promise<string> {
  try {
    return await signPreparedHash(hash);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Wallet locked') && options?.onWalletLocked) {
      const pass = await options.onWalletLocked(description);
      if (!pass) throw err;
      await unlock(pass);
      return signPreparedHash(hash);
    }
    throw err;
  }
}

export async function signRelayTransaction(
  flow: string,
  params?: Record<string, unknown>,
  options?: SignRelayOptions,
): Promise<SignRelayResult> {
  const prep = await fetch('/api/party/sign/prepare', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ flow, params }),
  });
  const prepRaw = (await prep.json().catch(() => null)) as {
    hash?: string;
    description?: string;
    message?: string;
  } | null;
  if (!prep.ok || !prepRaw?.hash) {
    throw new Error(prepRaw?.message ?? 'Failed to prepare transaction.');
  }
  return signRelayPrepared(
    { hash: prepRaw.hash, description: prepRaw.description },
    options,
  );
}

/**
 * Tanda tangani + execute transaksi yang SUDAH disiapkan (hash dari endpoint
 * prepare apa pun — mis. /quests/:id/claim-fcfs/prepare-external). Dipakai
 * flow dengan endpoint prepare kustom di luar /party/sign/prepare.
 */
export async function signRelayPrepared(
  prep: { hash: string; description?: string },
  options?: SignRelayOptions,
): Promise<SignRelayResult> {
  // Tanda tangan terjadi di sini — di browser, dengan kunci user.
  const signature = await signWithUnlock(prep.hash, prep.description ?? '', options);

  const exec = await fetch('/api/party/sign/execute', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ signature }),
  });
  const execRaw = (await exec.json().catch(() => null)) as
    | (SignRelayResult & { message?: string })
    | null;
  if (!exec.ok || !execRaw) {
    throw new Error(execRaw?.message ?? 'Failed to execute transaction.');
  }
  return execRaw;
}
