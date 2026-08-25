/**
 * Key manager — dompet non-custodial CanQuest (M1).
 *
 * Kunci Ed25519 hidup HANYA di browser user:
 *   - seed 32 byte (backup = raw hex 64 karakter, format pilihan user ala nuxaris)
 *   - tersimpan TERENKRIPSI passphrase (PBKDF2-SHA256 → AES-256-GCM) di IndexedDB
 *   - tidak pernah dikirim ke server; hanya public key + partyHint yang keluar
 *
 * Kompatibilitas byte-per-byte dengan @canton-network/wallet-sdk:
 *   - fingerprint: '1220' + sha256(0x0000000c || publicKey) — diverifikasi
 *     empiris terhadap SDK (5/5 match) di M0.
 *   - signature: Ed25519 detached atas byte hash — noble memakai seed 32 byte,
 *     SDK memakai secret 64 byte (seed‖pub); keduanya menghasilkan signature
 *     RFC 8032 yang identik.
 *
 * Modul ini browser-only (IndexedDB + crypto.subtle). Semua fungsi storage
 * melempar error jika dipanggil di server-side render.
 */

import * as ed25519 from '@noble/ed25519';

// ── konstanta ──────────────────────────────────────────────────────────────
const DB_NAME = 'canquest-wallet';
const DB_VERSION = 1;
const STORE = 'keys';
const RECORD_KEY = 'primary';
const PBKDF2_ITERATIONS = 310_000; // OWASP 2023 untuk PBKDF2-SHA256
const SALT_BYTES = 16;
const IV_BYTES = 12;

export const PARTY_HINT_PREFIX = 'canquest-user-';

// ── tipe ───────────────────────────────────────────────────────────────────
export interface WalletKeyMeta {
  /** Nama party opaque, mis. "canquest-user-8f3k2a91b7". */
  hint: string;
  /** Fingerprint namespace (hex 68 char, diawali 1220). */
  fingerprint: string;
  /** Preview party ID: `${hint}::${fingerprint}`. */
  partyIdPreview: string;
  /** Public key (hex 64 char) — boleh dikirim ke server. */
  publicKeyHex: string;
  createdAt: string;
}

interface StoredKeyRecord {
  v: 1;
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; saltB64: string };
  cipher: { name: 'AES-GCM'; ivB64: string; ctB64: string };
  meta: WalletKeyMeta;
}

export interface GeneratedKey {
  /** RAW HEX 64 karakter — format backup pilihan user. Tampil SEKALI saat onboarding. */
  seedHex: string;
  meta: WalletKeyMeta;
}

interface UnlockedKey {
  seed: Uint8Array;
  meta: WalletKeyMeta;
}

// ── util encoding ──────────────────────────────────────────────────────────
const hex = (b: Uint8Array): string => {
  let s = '';
  for (const x of b) s += x.toString(16).padStart(2, '0');
  return s;
};
const unhex = (s: string): Uint8Array => {
  if (!/^[0-9a-fA-F]*$/.test(s) || s.length % 2 !== 0) {
    throw new Error('Invalid hex string');
  }
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
};
const b64 = (b: Uint8Array): string =>
  btoa(String.fromCharCode(...Array.from(b)));
const unb64 = (s: string): Uint8Array =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function subtle(): SubtleCrypto {
  if (typeof globalThis.crypto?.subtle !== 'object') {
    throw new Error('WebCrypto unavailable in this environment');
  }
  return globalThis.crypto.subtle;
}

// ── IndexedDB (mini wrapper, tanpa dependency) ─────────────────────────────
function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB unavailable — key-manager is browser-only');
  }
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
}

async function idbRun<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
    });
  } finally {
    db.close();
  }
}

// ── kripto inti ────────────────────────────────────────────────────────────

/**
 * Fingerprint Canton dari public key — formula terverifikasi terhadap
 * wallet-sdk: hex(0x12 0x20 ‖ sha256(BE_uint32(12) ‖ publicKey)).
 */
export async function computeFingerprint(publicKey: Uint8Array): Promise<string> {
  const input = new Uint8Array(4 + publicKey.length);
  new DataView(input.buffer).setUint32(0, 12);
  input.set(publicKey, 4);
  const digest = new Uint8Array(await subtle().digest('SHA-256', input));
  return hex(new Uint8Array([0x12, 0x20, ...digest]));
}

export function randomPartyHint(): string {
  const b = new Uint8Array(6);
  globalThis.crypto.getRandomValues(b);
  return PARTY_HINT_PREFIX + hex(b);
}

/** Public key Ed25519 dari seed 32 byte (async — WebCrypto SHA-512, tanpa dep tambahan). */
export async function publicKeyFromSeed(seed: Uint8Array): Promise<Uint8Array> {
  return ed25519.getPublicKeyAsync(seed);
}

// ── passphrase encryption (PBKDF2 → AES-GCM) ──────────────────────────────
async function deriveAesKey(passphrase: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await subtle().importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return subtle().deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: salt as unknown as ArrayBuffer,
      iterations: PBKDF2_ITERATIONS,
    },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

async function encryptSeed(
  seed: Uint8Array,
  passphrase: string,
): Promise<Pick<StoredKeyRecord, 'kdf' | 'cipher'>> {
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveAesKey(passphrase, salt);
  const ct = new Uint8Array(
    await subtle().encrypt(
      { name: 'AES-GCM', iv: iv as unknown as ArrayBuffer },
      key,
      seed as unknown as ArrayBuffer,
    ),
  );
  return {
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS, saltB64: b64(salt) },
    cipher: { name: 'AES-GCM', ivB64: b64(iv), ctB64: b64(ct) },
  };
}

async function decryptSeed(
  record: StoredKeyRecord,
  passphrase: string,
): Promise<Uint8Array> {
  const key = await deriveAesKey(passphrase, unb64(record.kdf.saltB64));
  const plain = await subtle().decrypt(
    { name: 'AES-GCM', iv: unb64(record.cipher.ivB64) as unknown as ArrayBuffer },
    key,
    unb64(record.cipher.ctB64) as unknown as ArrayBuffer,
  );
  return new Uint8Array(plain);
}

// ── sesi unlock (memori saja, tidak persisten) ────────────────────────────
let session: UnlockedKey | null = null;

export function isUnlocked(): boolean {
  return session !== null;
}

export function lock(): void {
  if (session) session.seed.fill(0);
  session = null;
}

// ── API publik ─────────────────────────────────────────────────────────────

/**
 * Generate kunci dompet baru (browser-only). Tidak menyimpan apa pun —
 * pemanggil bertanggung jawab menampilkan seedHex SEKALI lalu memanggil
 * saveWalletKey() setelah user verifikasi backup.
 */
export async function generateWalletKey(): Promise<GeneratedKey> {
  const seed = ed25519.utils.randomSecretKey();
  const pub = await publicKeyFromSeed(seed);
  const fingerprint = await computeFingerprint(pub);
  const hint = randomPartyHint();
  return {
    seedHex: hex(seed),
    meta: {
      hint,
      fingerprint,
      partyIdPreview: `${hint}::${fingerprint}`,
      publicKeyHex: hex(pub),
      createdAt: new Date().toISOString(),
    },
  };
}

/** Simpan seed terenkripsi (setelah user verifikasi backup). */
export async function saveWalletKey(
  seedHexInput: string,
  passphrase: string,
  meta: WalletKeyMeta,
): Promise<void> {
  if (await hasWalletKey()) throw new Error('A wallet key already exists in this browser');
  if (passphrase.length < 8) throw new Error('Passphrase must be at least 8 characters');
  const seed = unhex(seedHexInput);
  if (seed.length !== 32) throw new Error('Seed must be 32 bytes (64 hex characters)');
  const record: StoredKeyRecord = { v: 1, ...(await encryptSeed(seed, passphrase)), meta };
  await idbRun('readwrite', (s) => s.put(record, RECORD_KEY));
}

export async function hasWalletKey(): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return false;
  try {
    const rec = await idbRun<StoredKeyRecord | undefined>('readonly', (s) => s.get(RECORD_KEY));
    return !!rec;
  } catch {
    return false;
  }
}

export async function getWalletKeyMeta(): Promise<WalletKeyMeta | null> {
  const rec = await idbRun<StoredKeyRecord | undefined>('readonly', (s) => s.get(RECORD_KEY));
  return rec?.meta ?? null;
}

/**
 * Buka kunci dengan passphrase. Validasi integritas: fingerprint yang
 * dihitung ulang dari seed harus cocok dengan metadata tersimpan.
 */
export async function unlock(passphrase: string): Promise<WalletKeyMeta> {
  const rec = await idbRun<StoredKeyRecord | undefined>('readonly', (s) => s.get(RECORD_KEY));
  if (!rec) throw new Error('No wallet found in this browser');
  const seed = await decryptSeed(rec, passphrase).catch(() => {
    throw new Error('Wrong passphrase or corrupted wallet data');
  });
  const pub = await publicKeyFromSeed(seed);
  const fingerprint = await computeFingerprint(pub);
  if (fingerprint !== rec.meta.fingerprint) {
    throw new Error('Wallet integrity check failed — fingerprint mismatch');
  }
  session = { seed, meta: { ...rec.meta, publicKeyHex: hex(pub) } };
  return session.meta;
}

/**
 * Tanda tangani hash transaksi ter-prepare (interactive submission).
 * Mirror persis signTransactionHash() SDK: base64 hash masuk → tanda tangan
 * Ed25519 detached atas byte-nya → base64 keluar.
 * Harus dalam keadaan unlocked.
 */
export async function signPreparedHash(hashB64Input: string): Promise<string> {
  if (!session) throw new Error('Wallet locked — unlock with your passphrase first');
  const sig = await ed25519.signAsync(unb64(hashB64Input), session.seed);
  return b64(sig);
}

/** Tanda tangani pesan arbitrer (byte) — untuk kebutuhan registrasi M2. */
export async function signBytes(message: Uint8Array): Promise<string> {
  if (!session) throw new Error('Wallet locked — unlock with your passphrase first');
  return b64(await ed25519.signAsync(message, session.seed));
}

/** Backup: tampilkan ulang seed raw hex. Harus unlocked. */
export function exportSeedHex(): string {
  if (!session) throw new Error('Wallet locked — unlock with your passphrase first');
  return hex(session.seed);
}

/**
 * Restore dari backup raw hex (pindah perangkat / browser baru).
 * Validasi format, derivasi ulang public key + fingerprint, lalu simpan
 * terenkripsi dengan passphrase baru.
 */
export async function importWalletKey(
  seedHexInput: string,
  passphrase: string,
): Promise<WalletKeyMeta> {
  if (await hasWalletKey()) throw new Error('A wallet key already exists in this browser — hapus dulu untuk restore');
  if (passphrase.length < 8) throw new Error('Passphrase must be at least 8 characters');
  const seed = unhex(seedHexInput.trim().toLowerCase());
  if (seed.length !== 32) throw new Error('Backup key must be 64 hex characters (32 bytes)');
  const pub = await publicKeyFromSeed(seed);
  const fingerprint = await computeFingerprint(pub);
  const hint = randomPartyHint();
  const meta: WalletKeyMeta = {
    hint,
    fingerprint,
    partyIdPreview: `${hint}::${fingerprint}`,
    publicKeyHex: hex(pub),
    createdAt: new Date().toISOString(),
  };
  const record: StoredKeyRecord = { v: 1, ...(await encryptSeed(seed, passphrase)), meta };
  await idbRun('readwrite', (s) => s.put(record, RECORD_KEY));
  return meta;
}

/** Hapus dompet dari browser ini (reset/migrasi). Tidak menyentuh chain. */
export async function deleteWalletKey(): Promise<void> {
  lock();
  await idbRun('readwrite', (s) => s.delete(RECORD_KEY));
}

// ── M4b: sync blob antar-browser ───────────────────────────────────────────

/**
 * Export record terenkripsi utk sync ke akun (server hanya menyimpan blob —
 * dekripsi butuh passphrase yang tidak pernah keluar dari browser).
 * Return null kalau browser ini belum punya kunci.
 */
export async function exportSyncBlob(): Promise<string | null> {
  const rec = await idbRun<StoredKeyRecord | undefined>(
    'readonly',
    (s) => s.get(RECORD_KEY),
  );
  if (!rec) return null;
  return JSON.stringify(rec);
}

/**
 * Import blob terenkripsi dari akun ke browser ini (browser baru/perangkat
 * baru). Tidak butuh passphrase saat import — passphrase diverifikasi saat
 * unlock pertama. Return meta; throw kalau browser sudah punya kunci lain.
 */
export async function importSyncBlob(blobJson: string): Promise<WalletKeyMeta> {
  if (await hasWalletKey()) {
    throw new Error('A wallet key already exists in this browser');
  }
  let rec: StoredKeyRecord;
  try {
    const parsed = JSON.parse(blobJson) as StoredKeyRecord;
    if (
      parsed?.v !== 1 ||
      !parsed?.kdf?.saltB64 ||
      !parsed?.cipher?.ivB64 ||
      !parsed?.cipher?.ctB64 ||
      !parsed?.meta?.fingerprint
    ) {
      throw new Error('shape');
    }
    rec = parsed;
  } catch {
    throw new Error('Invalid encrypted backup blob');
  }
  await idbRun('readwrite', (s) => s.put(rec, RECORD_KEY));
  return rec.meta;
}
