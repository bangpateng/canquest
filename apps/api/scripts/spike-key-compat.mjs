#!/usr/bin/env node
/**
 * M0/M1 — uji kompatibilitas kripto browser (noble, seed 32-byte) vs
 * wallet-sdk (nacl, secret 64-byte). Harus 100% match:
 *   1. fingerprint public key identik
 *   2. signature Ed25519 atas hash transaksi identik
 *
 * Kalau keduanya hijau, modul key-manager frontend (apps/web/lib/wallet/
 * key-manager.ts) terbukti menghasilkan material yang sama persis dengan SDK
 * backend — syarat arsitektur relay (prepare di server, sign di browser).
 */
import * as ed25519 from '@noble/ed25519';
import { SDK, signTransactionHash } from '@canton-network/wallet-sdk';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const toB64 = (b) => Buffer.from(b).toString('base64');
const fromB64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));

// Formula fingerprint — sama dengan key-manager.ts (terverifikasi vs SDK).
async function fingerprintMine(pub) {
  const input = new Uint8Array(4 + pub.length);
  new DataView(input.buffer).setUint32(0, 12);
  input.set(pub, 4);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', input));
  const out = new Uint8Array(2 + digest.length);
  out.set([0x12, 0x20], 0);
  out.set(digest, 2);
  return Buffer.from(out).toString('hex');
}

async function main() {
  const offline = SDK.createOffline();
  let fpOk = 0;
  let sigOk = 0;
  const N = 10;
  for (let i = 0; i < N; i++) {
    // 1) Generate SEED ala browser (inilah raw-hex backup user).
    const seed = ed25519.utils.randomSecretKey();
    const pub = await ed25519.getPublicKeyAsync(seed);

    // 2) Fingerprint: browser formula vs SDK.
    const fpMine = await fingerprintMine(pub);
    const fpSdk = await offline.keys.fingerprint(toB64(pub));
    if (fpMine === fpSdk) fpOk++;

    // 3) Signature: noble(seed 32B) vs SDK signTransactionHash(secret 64B).
    const hashB64 = toB64(ed25519.utils.randomSecretKey()); // hash acak 32 byte
    const naclSecret = Buffer.concat([Buffer.from(seed), Buffer.from(pub)]);
    const sigSdk = signTransactionHash(hashB64, naclSecret.toString('base64'));
    const sigMine = toB64(await ed25519.signAsync(fromB64(hashB64), seed));
    if (sigMine === sigSdk) sigOk++;

    // 4) Verifikasi signature noble dengan public key (self-check).
    if (!(await ed25519.verifyAsync(fromB64(sigMine), fromB64(hashB64), pub))) {
      throw new Error('verify ed25519 gagal — sesi ke-' + i);
    }
  }
  console.log(`fingerprint match : ${fpOk}/${N}`);
  console.log(`signature   match : ${sigOk}/${N}`);
  console.log(`verify      ok     : ${N}/${N}`);
  const pass = fpOk === N && sigOk === N;
  console.log(pass ? 'PASS — browser & SDK kompatibel byte-per-byte' : 'FAIL');
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
