#!/usr/bin/env node
/**
 * M2 — validasi end-to-end alur onboarding external party Persis Seperti Browser.
 *
 * Mereplikasi path key-manager frontend (noble, seed 32-byte, WebCrypto) +
 * path service backend (prepare → multiHash → signature → allocate tanpa
 * operator rights), lalu verifikasi party terdaftar di /v2/parties.
 *
 * Inilah bukti terakhir M2: signature yang dihitung persis seperti
 * apps/web/lib/wallet/key-manager.ts DITERIMA oleh allocate endpoint.
 */
import * as ed25519 from '@noble/ed25519';
import { SDK, CustomLogAdapter } from '@canton-network/wallet-sdk';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import crypto from 'node:crypto';
import { webcrypto } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const env = (() => {
  const out = {};
  for (const line of fs.readFileSync(path.join(__dirname, '..', '.env'), 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
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
    try {
      r.setServers([s]);
      const a = await r.resolve4(h);
      if (a.length) return a[0];
    } catch {}
  }
  return null;
}

async function main() {
  // DNS pin (LAN override bypass)
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

  // ════ 1. Sisi "browser": generate kunci ala key-manager.ts ════
  const seed = ed25519.utils.randomSecretKey(); // 32 byte = raw-hex backup user
  const pub = await ed25519.getPublicKeyAsync(seed);
  const pubHex = toHex(pub);
  const hint = `canquest-user-${toHex(crypto.getRandomValues(new Uint8Array(4)))}`;
  console.log(`[browser] seed(raw-hex backup): ${toHex(seed).slice(0, 12)}…(disimpan user)`);
  console.log(`[browser] publicKeyHex: ${pubHex.slice(0, 12)}…`);
  console.log(`[browser] partyHint: ${hint}`);

  // ════ 2. Sisi "backend": prepare topology ════
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
  console.log(`[backend] topology OK — partyId=${topo.partyId.split('::')[0]} multiHash=${topo.multiHash.slice(0, 16)}…`);

  // ════ 3. Sisi "browser": sign multiHash PERSIS key-manager.signPreparedHash ════
  const sig = toB64(await ed25519.signAsync(fromB64(topo.multiHash), seed));
  console.log(`[browser] signature(b64): ${sig.slice(0, 16)}…`);

  // ════ 4. Sisi "backend": allocate dengan signature, TANPA operator rights ════
  const res = await prepared.execute(sig, { grantUserRights: false });
  console.log(`[backend] ALLOCATE OK — partyId=${res.partyId}`);

  // ════ 5. Verifikasi terdaftar ════
  const tres = await fetch(`${env.KEYCLOAK_URL}/realms/${env.KEYCLOAK_REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.LEDGER_CLIENT_ID,
      clientSecret: env.LEDGER_CLIENT_SECRET,
      scope: 'daml_ledger_api',
    }),
  });
  const token = (await tres.json()).access_token;
  const pres = await fetch(`${env.LEDGER_API_URL.replace(/\/$/, '')}/v2/parties/${encodeURIComponent(res.partyId)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log(`[verify] /v2/parties -> HTTP ${pres.status}`);

  const pass = pres.status === 200 && res.partyId.startsWith(hint);
  console.log(pass ? '\nPASS — alur M2 (browser-sign + backend-relay) valid end-to-end.' : '\nFAIL');
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
