/**
 * External-party setup (ValidatorRight + TransferPreapproval + domain join)
 * untuk party B — jalur sama dengan M5b preapproval spike.
 * Tujuan: buktikan party external baru butuh setup sebelum interactive submission.
 */
import * as ed25519 from '@noble/ed25519';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
import fs from 'node:fs';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import os from 'node:os';
import path from 'node:path';

const env = {};
for (const line of fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('='); if (i < 1) continue;
  env[t.slice(0, i).trim()] = t.slice(i + 1).trim().replace(/^"|"$/g, '');
}

const DNS_FALLBACK = {
  'auth.canquestlabs.com': '172.67.219.57',
  'validator.canquestlabs.com': '172.67.219.57',
};
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

const state = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), process.argv[2] ?? 'canquest-spike-party-b.json'), 'utf8'));
const PARTY = state.partyId;
const SEED = Buffer.from(state.privateKeyB64, 'base64').subarray(0, 32);
const PUBHEX = Buffer.from(state.publicKeyB64, 'base64').toString('hex');
const VAL = env.CANTON_VALIDATOR_URL.replace(/\/$/, '');

const token = (await (await fetch(
  `${env.KEYCLOAK_URL}/realms/${env.KEYCLOAK_REALM}/protocol/openid-connect/token`,
  { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=client_credentials&client_id=${env.LEDGER_CLIENT_ID}&client_secret=${env.LEDGER_CLIENT_SECRET}&scope=daml_ledger_api` },
)).json()).access_token;
const H = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

console.log('Party:', PARTY.split('::')[0]);

// 1. setup-proposal
const p1 = await fetch(`${VAL}/api/validator/v0/admin/external-party/setup-proposal`, { method: 'POST', headers: H, body: JSON.stringify({ user_party_id: PARTY }) });
const t1 = await p1.text();
if (!p1.ok) { console.log('setup-proposal', p1.status, t1.slice(0, 200)); process.exit(1); }
const CID = JSON.parse(t1).contract_id;
console.log('[1] setup-proposal OK');

// 2. prepare-accept
const p2 = await fetch(`${VAL}/api/validator/v0/admin/external-party/setup-proposal/prepare-accept`, { method: 'POST', headers: H, body: JSON.stringify({ user_party_id: PARTY, contract_id: CID }) });
const prep = await p2.json();
if (!p2.ok) { console.log('prepare-accept', p2.status, JSON.stringify(prep).slice(0, 200)); process.exit(1); }
console.log('[2] prepare-accept OK');

// 3. sign raw 32 bytes + submit-accept
const bytes = new Uint8Array((String(prep.tx_hash).match(/.{2}/g) ?? []).map((b) => parseInt(b, 16)));
const sig = await ed25519.signAsync(bytes, SEED);
const p3 = await fetch(`${VAL}/api/validator/v0/admin/external-party/setup-proposal/submit-accept`, {
  method: 'POST', headers: H,
  body: JSON.stringify({ submission: { party_id: PARTY, transaction: prep.transaction, signed_tx_hash: Buffer.from(sig).toString('hex'), public_key: PUBHEX } }),
});
const t3 = await p3.text();
console.log('[3] submit-accept:', p3.status, t3.slice(0, 250));
process.exit(p3.ok ? 0 : 1);
