#!/usr/bin/env node
/**
 * M3c — VALIDASI PREPARE-ONLY preapproval_enable utk user external (MainNet).
 *
 * Pertanyaan empiris: bisakah interactive submission (tanda tangan external
 * receiver + co-otorisasi provider internal oleh participant) MELEWATI
 * prepare atas AmuletRules_CreateTransferPreapproval (actAs [receiver, provider])?
 *
 * PREPARE SAJA — tidak dieksekusi → burn fee provider TIDAK terjadi.
 */
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

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
const state = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'canquest-spike-party.json'), 'utf8'));
const PARTY = state.partyId;

const DNS_FALLBACK = { 'ledger.canquestlabs.com': '162.250.191.195', 'auth.canquestlabs.com': '172.67.219.57', 'validator.canquestlabs.com': '172.67.219.57' };

async function main() {
  const r = new dnsPromises.Resolver();
  const pins = {};
  for (const h of ['ledger.canquestlabs.com', 'auth.canquestlabs.com', 'validator.canquestlabs.com']) {
    try { r.setServers(['1.1.1.1']); pins[h] = (await r.resolve4(h))[0]; } catch { pins[h] = DNS_FALLBACK[h]; }
    console.log(`[dns] ${h} -> ${pins[h]}`);
  }
  const orig = dns.lookup.bind(dns);
  dns.lookup = (hostname, options, callback) => {
    let cb = callback, opts = options;
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    return pins[hostname] ? orig(pins[hostname], opts, cb) : orig(hostname, opts, cb);
  };

  const { SDK, CustomLogAdapter } = await import('@canton-network/wallet-sdk');
  const LEDGER = env.LEDGER_API_URL.replace(/\/$/, '');
  const SCAN = env.CANTON_SCAN_URL.replace(/\/$/, '');

  const token = (await (await fetch(`${env.KEYCLOAK_URL}/realms/${env.KEYCLOAK_REALM}/protocol/openid-connect/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=client_credentials&client_id=${env.LEDGER_CLIENT_ID}&client_secret=${env.LEDGER_CLIENT_SECRET}&scope=daml_ledger_api`,
  })).json()).access_token;

  // Walker scan-proxy (mirror produksi)
  function walkContracts(node, found = [], seen = new Set()) {
    if (!node || typeof node !== 'object' || seen.has(node)) return found;
    seen.add(node);
    const o = node;
    if (typeof o.contract_id === 'string' && typeof o.template_id === 'string' && typeof o.created_event_blob === 'string') {
      found.push({ contractId: o.contract_id, templateId: o.template_id, blob: o.created_event_blob, round: o.payload?.round?.number != null ? Number(o.payload.round.number) : undefined, opensAt: typeof o.payload?.opensAt === 'string' ? o.payload.opensAt : undefined });
    }
    for (const k of Object.keys(o)) walkContracts(o[k], found, seen);
    return found;
  }
  const scan = async (seg) => walkContracts(await (await fetch(`${SCAN}/${seg}`, { headers: { Authorization: `Bearer ${token}` } })).json());
  const pickOpen = (list) => {
    const open = list.filter((c) => c.templateId.endsWith(':Splice.Round:OpenMiningRound'));
    const usable = open.filter((c) => !c.opensAt || Date.parse(c.opensAt) <= Date.now());
    return (usable.length ? usable : open).sort((a, b) => (b.round ?? 0) - (a.round ?? 0))[0];
  };

  const arList = await scan('amulet-rules');
  const ar = arList.find((c) => c.templateId.endsWith(':Splice.AmuletRules:AmuletRules')) ?? arList[0];
  const or = pickOpen(await scan('open-and-issuing-mining-rounds'));
  if (!ar || !or) throw new Error('scan-proxy kosong');
  console.log(`[1] scan-proxy OK — round=${or.round}`);

  // Input amulet PROVIDER (fee dibayar provider)
  const provider = env.CANTON_VALIDATOR_PARTY_ID;
  const offset = (await (await fetch(`${LEDGER}/v2/state/ledger-end`, { headers: { Authorization: `Bearer ${token}` } })).json()).offset;
  const acs = await (await fetch(`${LEDGER}/v2/state/active-contracts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventFormat: { filtersByParty: { [provider]: { cumulative: [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }] } }, verbose: true },
      activeAtOffset: offset,
    }),
  })).json();
  const holdings = [];
  for (const entry of acs ?? []) {
    const ev = entry?.contractEntry?.JsActiveContract?.createdEvent ?? entry;
    if (!String(ev.templateId ?? '').includes('Splice.Amulet:Amulet')) continue;
    holdings.push({
      contractId: ev.contractId,
      initialAmount: ev.createArgument?.amount?.initialAmount ?? '0',
      ratePerRound: ev.createArgument?.amount?.ratePerRound ?? '0',
      createdAtRound: ev.createArgument?.createdAtRound ?? 0,
    });
  }
  const scored = holdings
    .map((h) => ({ h, eff: Math.max(0, (parseFloat(h.initialAmount) || 0) - Math.max(0, (or.round ?? 0) - (h.createdAtRound || 0)) * (parseFloat(h.ratePerRound) || 0)) }))
    .sort((a, b) => b.eff - a.eff);
  console.log(`[2] provider holdings: ${holdings.length} amulet, best eff ~${scored[0]?.eff?.toFixed(2) ?? '?'} CC`);
  if (!scored[0] || scored[0].eff < 2) throw new Error('provider amulet kurang utk fee');

  const choiceArgument = {
    context: {
      amuletRules: ar.contractId,
      context: { openMiningRound: or.contractId, issuingMiningRounds: [], validatorRights: [] },
    },
    inputs: [{ tag: 'InputAmulet', value: scored[0].h.contractId }],
    receiver: PARTY,
    provider,
    expiresAt: new Date(Date.now() + 90 * 24 * 3600_000).toISOString(),
    expectedDso: env.CANTON_DSO_PARTY_ID,
  };

  // PREPARE-ONLY via SDK
  const sdk = await SDK.create({
    auth: {
      method: 'client_credentials',
      configUrl: `${env.KEYCLOAK_URL}/realms/${env.KEYCLOAK_REALM}/.well-known/openid-configuration`,
      credentials: { clientId: env.LEDGER_CLIENT_ID, clientSecret: env.LEDGER_CLIENT_SECRET, audience: 'https://canton.network.global', scope: 'daml_ledger_api' },
    },
    ledgerClientUrl: env.LEDGER_API_URL,
    logAdapter: new CustomLogAdapter(() => {}),
  });
  const crypto = await import('node:crypto');
  const prepared = sdk.ledger.prepare({
    partyId: PARTY,
    commands: [{
      ExerciseCommand: { templateId: ar.templateId, contractId: ar.contractId, choice: 'AmuletRules_CreateTransferPreapproval', choiceArgument },
    }],
    commandId: `spike-preapproval-${crypto.randomUUID()}`,
    disclosedContracts: [
      { templateId: ar.templateId, contractId: ar.contractId, createdEventBlob: ar.blob },
      { templateId: or.templateId, contractId: or.contractId, createdEventBlob: or.blob },
    ],
  });
  const resp = await prepared.preparedPromise;
  console.log(`[3] PREPARE OK — hash=${resp.preparedTransactionHash.slice(0, 24)}… (TIDAK dieksekusi — fee tidak dibakar)`);
  console.log('\nPASS — mixed-auth preapproval (external receiver + provider internal) LULUS prepare. Eksekusi nyata menunggu persetujuan (burn ~1.5 CC dana provider).');
  process.exit(0);
}

main().catch((e) => {
  console.error('FATAL:', e?.code ?? '', e?.cause ?? e?.message ?? e);
  console.error('\nKalau error otorisasi/party → mixed-auth TIDAK didukung participant utk preapproval; rekomendasi OFF permanen + offer-accept.');
  process.exit(1);
});
