/**
 * Cantex DEX signers — TypeScript port dari Python SDK `caviarnine/cantex_sdk`
 * (`src/cantex_sdk/_sdk.py`, class OperatorKeySigner & IntentTradingKeySigner).
 *
 * Dua skema signature berbeda:
 *   1. OperatorKeySigner  — Ed25519 (untuk auth challenge + ledger transaction hash).
 *   2. IntentTradingKeySigner — secp256k1 ECDSA, DER-encoded (untuk intent/swap digest).
 *
 * Memakai @noble/ed25519 v2 + @noble/secp256k1 v2 (pure JS, Node 20-safe).
 *
 * === ATURAN BASE64 YANG KRITIS (jangan tertukar) ===
 * Python SDK (`_sdk.py` lines 508-510 vs 1564):
 *   - OUTBOUND (pubkey, auth sig, tx-hash sig): urlsafe_b64encode().rstrip("=")
 *       → di TS: Buffer.from(x).toString('base64url')  (base64url sudah no-pad).
 *   - INBOUND transaction_hash dari server: standard base64 decode
 *       → di TS: Buffer.from(hash, 'base64').
 *
 * === SPKI DER PREFIX UNTUK INTENT PUBLIC KEY ===
 * Python `_sdk.py` lines 722-726: 23-byte prefix hardcoded:
 *   30 56 30 10 06 07 2A 86 48 CE 3D 02 01 06 05 2B 81 04 00 0A 03 42 00
 * = SEQUENCE { SEQUENCE { OID ecPublicKey, OID secp256k1 }, BIT STRING }
 * Diikuti `04` + X‖Y (65 byte) → total 88 byte / 176 hex chars.
 */

import * as ed from '@noble/ed25519';
import * as secp from '@noble/secp256k1';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';
import { CantexError } from './cantex.types';

// ── Inisialisasi hash sync untuk noble v2 (wajib sebelum sign) ──────────
// ed25519 butuh sha512; secp256k1 butuh hmacSha256 (untuk RFC6979 deterministic k).
ed.etc.sha512Sync = (...msgs: Uint8Array[]) => {
  const h = sha512.create();
  for (const m of msgs) h.update(m);
  return h.digest();
};
secp.etc.hmacSha256Sync = (key: Uint8Array, ...msgs: Uint8Array[]) => {
  const h = hmac.create(sha256, key);
  for (const m of msgs) h.update(m);
  return h.digest();
};

// ── helpers ─────────────────────────────────────────────────────────────

/** Strip `0x` prefix + whitespace dari hex string (mirror `_clean_hex`). */
function cleanHex(hex: string): string {
  return hex.trim().replace(/^0x/i, '');
}

/** Hex string → Buffer, validasi panjang. */
function hexToBuf(hex: string, expectedBytes?: number): Buffer {
  const clean = cleanHex(hex);
  if (!/^[0-9a-fA-F]*$/.test(clean) || clean.length % 2 !== 0) {
    throw new CantexError(`Invalid hex string (len=${clean.length}).`);
  }
  const buf = Buffer.from(clean, 'hex');
  if (expectedBytes && buf.length !== expectedBytes) {
    throw new CantexError(
      `Key must be ${expectedBytes} bytes, got ${buf.length}.`,
    );
  }
  return buf;
}

/**
 * Encode ECDSA signature (r, s) ke format DER.
 * Format: 30 <totalLen> 02 <rlen> <r> 02 <slen> <s>
 * Mirror Python ecdsa `sigencode_der`.
 */
function encodeDer(r: Uint8Array, s: Uint8Array): Buffer {
  // Strip leading zero padding, tapi keep minimal 1 byte; prepend 0x00 bila high bit set.
  const encodeInt = (val: Uint8Array): Buffer => {
    let v = Buffer.from(val);
    // Strip leading zeros.
    while (v.length > 1 && v[0] === 0) v = v.subarray(1);
    // Prepend 0x00 bila high bit set (positive integer sign).
    if (v[0] & 0x80) v = Buffer.concat([Buffer.from([0x00]), v]);
    return v;
  };
  const rEnc = encodeInt(r);
  const sEnc = encodeInt(s);
  // 0x02 + len + value for each.
  const rBody = Buffer.concat([Buffer.from([0x02, rEnc.length]), rEnc]);
  const sBody = Buffer.concat([Buffer.from([0x02, sEnc.length]), sEnc]);
  const body = Buffer.concat([rBody, sBody]);
  // 0x30 + total len + body.
  return Buffer.concat([Buffer.from([0x30, body.length]), body]);
}

// ── OperatorKeySigner (Ed25519) ─────────────────────────────────────────

/**
 * Ed25519 signer untuk auth challenge + ledger transaction hash.
 * Port dari Python `_sdk.py` OperatorKeySigner (lines 646-711).
 */
export class OperatorKeySigner {
  private readonly privateKey: Uint8Array; // 32 bytes

  private constructor(privateKey: Uint8Array) {
    this.privateKey = privateKey;
  }

  /** Construct dari hex private key (64 hex chars = 32 bytes). */
  static fromHex(hex: string): OperatorKeySigner {
    const buf = hexToBuf(hex, 32);
    return new OperatorKeySigner(Uint8Array.from(buf));
  }

  /** Construct dari raw 32-byte buffer. */
  static fromRaw(buf: Buffer): OperatorKeySigner {
    if (buf.length !== 32) {
      throw new CantexError(
        `Operator key must be 32 bytes, got ${buf.length}.`,
      );
    }
    return new OperatorKeySigner(Uint8Array.from(buf));
  }

  /**
   * Raw Ed25519 signature (64 bytes) — SYNC.
   * Dipakai untuk: (a) auth challenge = UTF-8 bytes of server `message`;
   * (b) ledger tx hash = decoded transaction_hash bytes.
   * `data` ditandatangani AS-IS (no hashing — Ed25519 pure).
   */
  signSync(data: Buffer): Buffer {
    const sig = ed.sign(data, this.privateKey);
    return Buffer.from(sig);
  }

  /** Async version (fallback). */
  async sign(data: Buffer): Promise<Buffer> {
    const sig = await ed.signAsync(data, this.privateKey);
    return Buffer.from(sig);
  }

  /**
   * Public key sebagai URL-safe base64 TANPA padding.
   * Dikirim ke /v1/auth/api-key/begin sebagai `publicKey`.
   * (Python `get_public_key_b64`, lines 704-711.)
   */
  getPublicKeyB64(): string {
    const pub = ed.getPublicKey(this.privateKey);
    return Buffer.from(pub).toString('base64url');
  }
}

// ── IntentTradingKeySigner (secp256k1) ──────────────────────────────────

/**
 * SPKI DER prefix untuk secp256k1 public key (23 bytes).
 * Sumber: Python `_sdk.py` lines 722-726.
 *   SEQUENCE {
 *     SEQUENCE { OID ecPublicKey (1.2.840.10045.2.1), OID secp256k1 (1.3.132.0.10) },
 *     BIT STRING <pubkey>
 *   }
 */
const SPKI_PREFIX_HEX = '3056301006072a8648ce3d020106052b8104000a034200';

/**
 * secp256k1 ECDSA signer untuk intent/swap digest.
 * Port dari Python `_sdk.py` IntentTradingKeySigner (lines 714-787).
 *
 * PENTING: `signDigest` menandatangani pre-hashed 32-byte digest —
 * TIDAK re-hash (mirror Python `sign_digest` + `sigencode_der`).
 */
export class IntentTradingKeySigner {
  private readonly privateKey: Uint8Array; // 32 bytes

  private constructor(privateKey: Uint8Array) {
    this.privateKey = privateKey;
  }

  /** Construct dari hex private key (64 hex chars = 32 bytes). */
  static fromHex(hex: string): IntentTradingKeySigner {
    const buf = hexToBuf(hex, 32);
    return new IntentTradingKeySigner(Uint8Array.from(buf));
  }

  /** Construct dari raw 32-byte buffer. */
  static fromRaw(buf: Buffer): IntentTradingKeySigner {
    if (buf.length !== 32) {
      throw new CantexError(`Trading key must be 32 bytes, got ${buf.length}.`);
    }
    return new IntentTradingKeySigner(Uint8Array.from(buf));
  }

  /**
   * Sign pre-hashed digest (32 bytes) → DER-encoded signature bytes.
   * Dipakai untuk intent digest dari /v1/intent/build/pool/swap.
   * (Python `sign`, lines 764-768.)
   *
   * noble secp256k1 v2 `sign(msgHash, priv)` butuh sync hmac (sudah di-init
   * di atas). Return Signature object (r, s); kita encode ke DER manual.
   */
  signDigest(digest: Buffer): Buffer {
    if (digest.length !== 32) {
      throw new CantexError(
        `Digest must be 32 bytes, got ${digest.length}. Intent signer tidak re-hash.`,
      );
    }
    // noble v2: sign(msgHashHex, priv) → Signature {r, s, recovery?} (sync, bila hmacSync di-set).
    const sig = secp.sign(digest, this.privateKey);
    // sig.toBytes() = compact r||s (64 bytes). Encode ke DER.
    const compact = sig.toBytes(); // Uint8Array 64 bytes
    const r = compact.subarray(0, 32);
    const s = compact.subarray(32, 64);
    return encodeDer(r, s);
  }

  /** Convenience: hex digest → hex DER signature (wire field `intentTradingKeySignature`). */
  signDigestHex(digestHex: string): string {
    return this.signDigest(hexToBuf(digestHex, 32)).toString('hex');
  }

  /**
   * Public key uncompressed: `04` + X‖Y (130 hex chars / 65 bytes).
   * (Python `get_public_key_hex`, lines 774-777.)
   */
  getPublicKeyUncompressed(): string {
    const point = secp.getPublicKey(this.privateKey, false); // uncompressed
    return Buffer.from(point).toString('hex');
  }

  /**
   * Public key SPKI DER-wrapped: prefix + `04` + X‖Y (176 hex chars / 88 bytes).
   * Dikirim ke /v1/ledger/transaction/build/pool/create_intent_account sebagai
   * `intentTradingPublicKeyHex`.
   * (Python `get_public_key_hex_der`, lines 779-787.)
   */
  getPublicKeyHexDer(): string {
    return SPKI_PREFIX_HEX + this.getPublicKeyUncompressed();
  }
}
