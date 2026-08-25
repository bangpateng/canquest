#!/usr/bin/env node
/**
 * M0 — probe keamanan KETAT (skenario penyerang sesungguhnya).
 *
 * Pertanyaan: kalau operator (pemilik validator + admin ledger user)
 * memberikan hak CanActAs/CanReadAs atas party EXTERNAL ke dirinya sendiri
 * (pola grantOperatorRightsOnParty yang dipakai dapp custodial hari ini),
 * apakah dia bisa mensubmit transaksi actAs party itu TANPA tanda tangan
 * pemilik kunci?
 *
 *   DITOLAK  → properti keamanan external party terbukti kokoh.
 *   DITERIMA → M2/M3 WAJIB: jangan pernah grant operator rights atas party
 *              external, + revoke rights sebagai hardening.
 *
 * Butuh state party dari spike-external-party.mjs --allocate (file tmp).
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const state = JSON.parse(
  fs.readFileSync(path.join(os.tmpdir(), 'canquest-spike-party.json'), 'utf8'),
);

function loadEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[t.slice(0, i).trim()] = v;
  }
  return out;
}
const env = loadEnv(path.join(__dirname, '..', '.env'));

const LEDGER = env.LEDGER_API_URL.replace(/\/$/, '');
const KC = env.KEYCLOAK_URL;
const ADMIN_USER = env.LEDGER_API_ADMIN_USER;
const OPERATOR = env.CANTON_OPERATOR_PARTY_ID || env.CANTON_VALIDATOR_PARTY_ID;
const TPL = `${env.CANTON_DAML_PACKAGE_NAME || '#canquest-v29'}:Main:WalletRegistrationProposal`;
const partyId = state.partyId;

// DNS pin (override LAN mati)
const DNS_FALLBACK = { 'ledger.canquestlabs.com': '162.250.191.195', 'auth.canquestlabs.com': '172.67.219.57' };
async function resolveA(h) {
  const r = new dnsPromises.Resolver();
  for (const s of ['1.1.1.1', '8.8.8.8']) {
    try {
      r.setServers([s]);
      const a = await r.resolve4(h);
      if (a.length) return a[0];
    } catch {}
  }
  return DNS_FALLBACK[h] || null;
}
async function main() {
  const pins = {};
  for (const h of [new URL(KC).hostname, new URL(LEDGER).hostname]) {
    pins[h] = await resolveA(h);
  }
  const orig = dns.lookup.bind(dns);
  dns.lookup = (hostname, options, callback) => {
    let cb = callback, opts = options;
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    return pins[hostname] ? orig(pins[hostname], opts, cb) : orig(hostname, opts, cb);
  };

  // 1) Token admin
  const tres = await fetch(`${KC}/realms/${env.KEYCLOAK_REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.LEDGER_CLIENT_ID,
      client_secret: env.LEDGER_CLIENT_SECRET,
      scope: 'daml_ledger_api',
    }),
  });
  const token = (await tres.json()).access_token;
  console.log('[1] token admin: OK');

  // 2) GRANT hak operator atas party external ke admin user (pola lama)
  const gres = await fetch(`${LEDGER}/v2/users/${encodeURIComponent(ADMIN_USER)}/rights`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identityProviderId: '',
      userId: ADMIN_USER,
      rights: [
        { kind: { CanActAs: { value: { party: partyId } } } },
        { kind: { CanReadAs: { value: { party: partyId } } } },
      ],
    }),
  });
  console.log(`[2] grant CanActAs/CanReadAs admin atas ${partyId.split('::')[0]} -> HTTP ${gres.status}`);
  if (!gres.ok) {
    console.log('    (grant ditolak — itu juga bentuk perlindungan)');
    console.log('    body:', (await gres.text()).slice(0, 200));
  }

  // 3) Buat proposal baru (actAs operator — jalur custodial yang sah)
  const nowIso = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const pres = await fetch(`${LEDGER}/v2/commands/submit-and-wait-for-transaction-tree`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      commands: [{
        CreateCommand: {
          templateId: TPL,
          createArguments: {
            admin: OPERATOR,
            userAddress: partyId,
            userProfileRef: 'user:spike-strict',
            partyId,
            registeredAt: nowIso,
          },
        },
      }],
      userId: ADMIN_USER,
      commandId: `spike-strict-prop-${crypto.randomUUID()}`,
      actAs: [OPERATOR],
      readAs: [OPERATOR],
    }),
  });
  const ptext = await pres.text();
  let cid = null;
  try {
    const walk = (o) => {
      if (!o || typeof o !== 'object' || cid) return;
      if (typeof o.contractId === 'string' && (o.createdEventId || o.templateId)) { cid = o.contractId; return; }
      for (const k of Object.keys(o)) walk(o[k]);
    };
    walk(JSON.parse(ptext));
  } catch {}
  console.log(`[3] proposal baru -> HTTP ${pres.status} cid=${cid ? cid.slice(0, 20) + '…' : '-'}`);
  if (!cid) {
    console.log('    gagal membuat proposal — hentikan.');
    process.exit(1);
  }

  // 4) SUBMIT CUSTODIAL actAs [operator, externalParty] — HARUS DITOLAK
  const sres = await fetch(`${LEDGER}/v2/commands/submit-and-wait-for-transaction-tree`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      commands: [{
        ExerciseCommand: { templateId: TPL, contractId: cid, choice: 'Accept', choiceArgument: {} },
      }],
      userId: ADMIN_USER,
      commandId: `spike-strict-sec-${crypto.randomUUID()}`,
      actAs: [OPERATOR, partyId],
      readAs: [OPERATOR, partyId],
    }),
  });
  const stext = await sres.text();
  console.log(`[4] submit custodial (dengan rights) -> HTTP ${sres.status}`);
  console.log('    ', stext.slice(0, 300));

  if (sres.ok) {
    console.log('\n!!! DITERIMA — operator BISA actAs party external dengan rights.');
    console.log('    => M2/M3 WAJIB tidak pernah grant operator rights atas party external');
    console.log('       + revoke rights sebagai hardening.');
    process.exit(2);
  } else {
    console.log('\nPASS — DITOLAK meski operator sudah memberi hak CanActAs ke dirinya.');
    console.log('    Properti keamanan external party terbukti kokoh di stack Splice kamu.');
  }
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
