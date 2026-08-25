/**
 * TEST: External party preapproval via ExternalPartySetupProposal.
 * Flow: setup-proposal → prepare-accept → user SIGN → submit-accept
 * 
 * Ini template yang BENAR untuk external party (bukan AmuletRules_CreateTransferPreapproval
 * yang butuh dual authorization).
 */
import * as ed25519 from '@noble/ed25519';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const env = {};
for (const line of fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i < 1) continue;
  let v = t.slice(i + 1).trim().replace(/^"|"$/g, '');
  env[t.slice(0, i).trim()] = v;
}

const state = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'canquest-spike-party.json'), 'utf8'));
const PARTY = state.partyId;
const SEED = Buffer.from(state.privateKeyB64, 'base64').subarray(0, 32);

const DNS_FALLBACK = {
  'ledger.canquestlabs.com': '162.250.191.195',
  'auth.canquestlabs.com': '172.67.219.57',
  'validator.canquestlabs.com': '172.67.219.57',
};

async function main() {
  const r = new dnsPromises.Resolver();
  const pins = {};
  for (const h of Object.keys(DNS_FALLBACK)) {
    try { r.setServers(['1.1.1.1']); pins[h] = (await r.resolve4(h))[0]; } catch { pins[h] = DNS_FALLBACK[h]; }
  }
  const orig = dns.lookup.bind(dns);
  dns.lookup = (hostname, options, callback) => {
    let cb = callback, opts = options;
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    return pins[hostname] ? orig(pins[hostname], opts, cb) : orig(hostname, opts, cb);
  };

  const LEDGER = env.LEDGER_API_URL?.replace(/\/$/, '');
  const VAL = env.CANTON_VALIDATOR_URL?.replace(/\/$/, '');
  console.log(`Party:   ${PARTY.split('::')[0]}`);
  console.log(`Validator: ${VAL}`);

  const token = (await (await fetch(
    `${env.KEYCLOAK_URL}/realms/${env.KEYCLOAK_REALM}/protocol/openid-connect/token`,
    { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=client_credentials&client_id=${env.LEDGER_CLIENT_ID}&client_secret=${env.LEDGER_CLIENT_SECRET}&scope=daml_ledger_api` }
  )).json()).access_token;
  console.log('[0] Token OK');

  const valHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  // ═══ 1. Create setup proposal (or reuse existing) ═══
  console.log('\n[1] POST /admin/external-party/setup-proposal...');
  const propRes = await fetch(`${VAL}/api/validator/v0/admin/external-party/setup-proposal`, {
    method: 'POST',
    headers: valHeaders,
    body: JSON.stringify({ user_party_id: PARTY }),
  });
  const propText = await propRes.text();
  let CONTRACT_ID = null;
  if (propRes.ok) {
    CONTRACT_ID = JSON.parse(propText).contract_id;
    console.log(`    HTTP ${propRes.status} — created: ${CONTRACT_ID.slice(0, 24)}…`);
  } else if (propRes.status === 409) {
    // Already exists — extract from error
    CONTRACT_ID = propText.match(/ContractId\(([^)]+)\)/)?.[1] ?? null;
    console.log(`    HTTP 409 — existing: ${CONTRACT_ID?.slice(0, 24) ?? '?'}…`);
  }
  if (!CONTRACT_ID) {
    console.log(`    HTTP ${propRes.status}: ${propText.slice(0, 200)}`);
    process.exit(1);
  }

  // ═══ 2. Prepare accept ═══
  console.log('\n[2] POST /admin/external-party/setup-proposal/prepare-accept...');
  const prepRes = await fetch(`${VAL}/api/validator/v0/admin/external-party/setup-proposal/prepare-accept`, {
    method: 'POST',
    headers: valHeaders,
    body: JSON.stringify({ user_party_id: PARTY, contract_id: CONTRACT_ID }),
  });
  const prepText = await prepRes.text();
  console.log(`    HTTP ${prepRes.status}: ${prepText.slice(0, 400)}`);
  if (!prepRes.ok) {
    console.log('\n❌ prepare-accept gagal');
    process.exit(1);
  }
  const prep = JSON.parse(prepText);
  console.log(`    Keys: ${Object.keys(prep).join(', ')}`);

  // ═══ 3. Sign hash ═══
  const hash = prep.tx_hash || prep.preparedTransactionHash || prep.transactionHash || prep.hash;
  if (!hash) {
    console.log('❌ Tidak ada hash di response — keys:', Object.keys(prep));
    process.exit(1);
  }
  console.log(`\n[3] tx_hash: ${String(hash).slice(0, 40)}…`);

  // Debug: coba decode sebagai hex DAN base64 untuk lihat yang benar
  const asHex = String(hash).replace(/[^0-9a-fA-F]/g, '');
  const hexDecoded = new Uint8Array(Buffer.from(asHex, 'hex'));
  const b64Decoded = new Uint8Array(Buffer.from(String(hash), 'base64'));
  console.log(`    as hex:  len=${hexDecoded.length} first_bytes=${Buffer.from(hexDecoded.slice(0, 4)).toString('hex')}`);
  console.log(`    as b64:  len=${b64Decoded.length} first_bytes=${Buffer.from(b64Decoded.slice(0, 4)).toString('hex')}`);

  // Pakai yang 34 bytes dan mulai dengan 1220 (multihash format)
  let hashBytes;
  if (hexDecoded.length === 34 && hexDecoded[0] === 0x12) {
    hashBytes = hexDecoded;
    console.log(`    → using HEX decoded (34 bytes, starts with 1220)`);
  } else if (b64Decoded.length === 34 && b64Decoded[0] === 0x12) {
    hashBytes = b64Decoded;
    console.log(`    → using B64 decoded (34 bytes, starts with 1220)`);
  } else if (hexDecoded.length === 32) {
    hashBytes = new Uint8Array([0x12, 0x20, ...hexDecoded]);
    console.log(`    → HEX 32 bytes + 1220 prefix`);
  } else if (b64Decoded.length === 32) {
    hashBytes = new Uint8Array([0x12, 0x20, ...b64Decoded]);
    console.log(`    → B64 32 bytes + 1220 prefix`);
  } else {
    // Fallback: sign raw bytes as-is
    hashBytes = b64Decoded.length >= 32 ? b64Decoded : hexDecoded;
    console.log(`    → fallback raw (${hashBytes.length} bytes)`);
  }
  console.log(`    Signing ${hashBytes.length} bytes: ${Buffer.from(hashBytes.slice(0, 8)).toString('hex')}…`);

  // Sign WITH 1220 prefix — hashBytes sudah di-set oleh logic di atas
  console.log(`    Signing ${hashBytes.length} bytes: ${Buffer.from(hashBytes.slice(0, 6)).toString('hex')}…`);
  const sigBytes = await ed25519.signAsync(hashBytes, SEED);

  // ═══ 4. Submit accept ═══
  console.log('\n[4] POST /admin/external-party/setup-proposal/submit-accept...');
  // EXACT schema dari ExternalPartySubmission type definition:
  // { party_id, transaction, signed_tx_hash (HEX SIG), public_key (HEX) }
  const submitBody = {
    submission: {
      party_id: PARTY,
      transaction: prep.transaction,
      signed_tx_hash: Buffer.from(sigBytes).toString('hex'),
      public_key: Buffer.from(state.publicKeyB64, 'base64').toString('hex'),
    },
  };
  const subRes = await fetch(`${VAL}/api/validator/v0/admin/external-party/setup-proposal/submit-accept`, {
    method: 'POST',
    headers: valHeaders,
    body: JSON.stringify(submitBody),
  });
  const subText = await subRes.text();
  console.log(`    HTTP ${subRes.status}: ${subText.slice(0, 400)}`);

  if (subRes.ok) {
    console.log('\n🎉 PASS — TransferPreapproval CREATED untuk external party!');
    console.log('   Direct transfers sekarang aktif untuk party ini.');
  } else {
    console.log('\n❌ submit-accept gagal — lihat error di atas');
  }
}

main().catch(e => { console.error('FATAL:', e?.code ?? '', e?.cause ?? e?.message ?? e); process.exit(1); });
