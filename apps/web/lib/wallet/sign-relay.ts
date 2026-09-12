/**
 * Sign relay client (M3) — helper dua-langkah tanda tangan transaksi.
 *
 * Pola: /api/party/sign/prepare (hash) → signPreparedHash di browser
 * (kunci user; throws kalau dompet terkunci → UI minta passphrase dulu)
 * → /api/party/sign/execute (signature) → updateId on-chain.
 *
 * Private key tidak pernah keluar dari perangkat.
 */

import { signPreparedHash, tryDeviceAutoUnlock, unlock } from './key-manager';

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

/** Potongan pesan backend saat ada entry pending yang belum selesai. */
const PREPARE_BUSY_MSG = 'already awaiting your signature';

/**
 * Buang entry pending signing milik user di relay. Dipanggil saat tanda tangan
 * gagal/dibatalkan DI BROWSER (entry belum ditandatangani → belum ada di chain,
 * aman dibuang) supaya transaksi berikutnya tidak terblokir sampai TTL 10 menit.
 * Best-effort — kegagalan fetch diabaikan.
 */
async function cancelPendingSigning(): Promise<void> {
  try {
    await fetch('/api/party/sign/cancel', {
      method: 'POST',
      credentials: 'include',
    });
  } catch {
    /* best-effort — TTL relay tetap membersihkan */
  }
}

/**
 * Tanda tangani hash transaksi dengan auto-unlock — dipakai semua alur sign
 * (relay & resume upgrade). Kalau dompet terkunci, panggil onWalletLocked
 * (prompt passphrase UI), unlock, lalu tanda tangani ulang.
 */
export async function signHashWithUnlock(
  hash: string,
  description: string,
  options?: SignRelayOptions,
): Promise<string> {
  try {
    return await signPreparedHash(hash);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes('Wallet locked')) throw err;
    // 1) Passwordless: coba device auto-unlock dulu ("remember this device").
    if (await tryDeviceAutoUnlock()) {
      return signPreparedHash(hash);
    }
    // 2) Fallback terakhir: prompt passphrase (device belum pernah unlock /
    //    blob dihapus). Setelah unlock berhasil, device blob dibuat ulang —
    //    prompt ini hanya muncul sekali per perangkat.
    if (options?.onWalletLocked) {
      const pass = await options.onWalletLocked(description);
      if (!pass) {
        // User batal passphrase → buang entry pending supaya tidak nyangkut.
        void cancelPendingSigning();
        throw err;
      }
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
  const doPrepare = () =>
    fetch('/api/party/sign/prepare', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flow, params }),
    });

  let prep = await doPrepare();
  let prepRaw = (await prep.json().catch(() => null)) as {
    hash?: string;
    description?: string;
    message?: string;
  } | null;
  if (!prep.ok || !prepRaw?.hash) {
    // SELF-HEAL: entry pending lama (mis. sign gagal sebelum restore wallet)
    // memblokir prepare baru. Buang entry-nya lalu prepare sekali lagi.
    const msg = (prepRaw?.message ?? '').toLowerCase();
    if (msg.includes(PREPARE_BUSY_MSG)) {
      await cancelPendingSigning();
      prep = await doPrepare();
      prepRaw = (await prep.json().catch(() => null)) as typeof prepRaw;
    }
    if (!prep.ok || !prepRaw?.hash) {
      throw new Error(prepRaw?.message ?? 'Failed to prepare transaction.');
    }
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
  let signature: string;
  try {
    // Tanda tangan terjadi di sini — di browser, dengan kunci user.
    signature = await signHashWithUnlock(prep.hash, prep.description ?? '', options);
  } catch (err) {
    // Sign gagal/dibatalkan di browser → entry pending di relay belum
    // ditandatangani (belum ada di chain), aman dibuang supaya transaksi
    // berikutnya tidak terblokir sampai TTL 10 menit habis.
    void cancelPendingSigning();
    throw err;
  }

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
