/**
 * PROBE (read-only): saldo CC + kontrak aktif party spike.
 * Dipakai untuk verifikasi E2E non-custodial — tidak mengirim apa pun.
 */
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
  'ledger.canquestlabs.com': '162.250.191.195',
  'auth.canquestlabs.com': '172.67.219.57',
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

const stateFile = process.argv[2] ?? 'canquest-spike-party.json';
const state = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), stateFile), 'utf8'));
const PARTY = state.partyId;
const LEDGER = env.LEDGER_API_URL.replace(/\/$/, '');

const token = (await (await fetch(
  `${env.KEYCLOAK_URL}/realms/${env.KEYCLOAK_REALM}/protocol/openid-connect/token`,
  { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=client_credentials&client_id=${env.LEDGER_CLIENT_ID}&client_secret=${env.LEDGER_CLIENT_SECRET}&scope=daml_ledger_api` },
)).json()).access_token;

const end = await (await fetch(`${LEDGER}/v2/state/ledger-end`, { headers: { Authorization: `Bearer ${token}` } })).json();
const res = await fetch(`${LEDGER}/v2/state/active-contracts`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    eventFormat: {
      filtersByParty: { [PARTY]: { cumulative: [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }] } },
      verbose: true,
    },
    activeAtOffset: end.offset,
  }),
});
const contracts = await res.json();
let total = 0;
const kinds = {};
for (const entry of contracts ?? []) {
  const ev = entry?.contractEntry?.JsActiveContract?.createdEvent ?? entry;
  const tid = String(ev.templateId ?? '?');
  const kind = tid.split(':').pop();
  kinds[kind] = (kinds[kind] ?? 0) + 1;
  if (tid.includes('Splice.Amulet:Amulet') && ev.createArgument?.owner === PARTY) {
    total += parseFloat(ev.createArgument?.amount?.initialAmount ?? ev.createArgument?.amount?.amount ?? '0');
  }
}
console.log('Party:', PARTY.split('::')[0]);
console.log('Saldo CC:', total.toFixed(4));
console.log('Kontrak aktif:', JSON.stringify(kinds));
