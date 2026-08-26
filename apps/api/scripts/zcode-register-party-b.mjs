/**
 * Register party external KEDUA khusus E2E test (penerima send_cc).
 * Kunci disimpan ke canquest-spike-party-b.json (file A tidak disentuh).
 */
import * as ed25519 from '@noble/ed25519';
import { SDK, CustomLogAdapter } from '@canton-network/wallet-sdk';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import crypto from 'node:crypto';
import { webcrypto } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = (() => {
  const out = {};
  for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('='); if (i < 1) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[t.slice(0, i).trim()] = v;
  }
  return out;
})();

const toB64 = (b) => Buffer.from(b).toString('base64');
const fromB64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
const toHex = (b) => Buffer.from(b).toString('hex');

async function resolveA(h) {
  const r = new dnsPromises.Resolver();
  for (const s of ['1.1.1.1', '8.8.8.8']) {
    try { r.setServers([s]); const a = await r.resolve4(h); if (a.length) return a[0]; } catch {}
  }
  return null;
}

const pins = {};
for (const h of [new URL(env.KEYCLOAK_URL).hostname, new URL(env.LEDGER_API_URL).hostname]) {
  const ip = await resolveA(h);
  if (ip) pins[h] = ip;
}
const orig = dns.lookup.bind(dns);
dns.lookup = (hostname, options, callback) => {
  let cb = callback, opts = options;
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  return pins[hostname] ? orig(pins[hostname], opts, cb) : orig(hostname, opts, cb);
};

const seed = ed25519.utils.randomSecretKey();
const pub = await ed25519.getPublicKeyAsync(seed);
const hint = `canquest-user-${toHex(crypto.getRandomValues(new Uint8Array(4)))}`;

const sdk = await SDK.create({
  auth: {
    method: 'client_credentials',
    configUrl: `${env.KEYCLOAK_URL}/realms/${env.KEYCLOAK_REALM}/.well-known/openid-configuration`,
    credentials: {
      clientId: env.LEDGER_CLIENT_ID,
      clientSecret: env.LEDGER_CLIENT_SECRET,
      audience: env.CANTON_LEDGER_API_AUDIENCE || 'https://canton.network.global',
      scope: env.LEDGER_API_AUTH_SCOPE || 'daml_ledger_api',
    },
  },
  ledgerClientUrl: env.LEDGER_API_URL,
  logAdapter: new CustomLogAdapter(() => {}),
});

const prepared = sdk.party.external.create(toB64(pub), { partyHint: hint });
const topo = await prepared.topology();
const sig = toB64(await ed25519.signAsync(fromB64(topo.multiHash), seed));
const res = await prepared.execute(sig, { grantUserRights: false });

fs.writeFileSync(
  path.join(os.tmpdir(), 'canquest-spike-party-b.json'),
  JSON.stringify({
    partyId: res.partyId, hint,
    publicKeyB64: toB64(pub),
    privateKeyB64: toB64(Buffer.concat([seed, pub])),
    privateKeyHex: toHex(Buffer.concat([seed, pub])),
    allocatedAt: new Date().toISOString(),
  }, null, 2),
);
console.log(`ALLOCATED: ${res.partyId}`);
console.log('saved → canquest-spike-party-b.json');
