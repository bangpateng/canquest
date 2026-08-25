/**
 * TEST: Preapproval untuk external party via MULTI-PARTY interactive submission.
 * Pendekatan: prepare dengan actAs [external, provider] via RAW API (bukan SDK
 * yang cuma support single party). Kalau prepare lolos, sign dengan browser key,
 * lalu execute — provider's auth di-add participant otomatis.
 *
 * Ini test M3c-v2: kemungkinan besar tetap gagal (docs bilang single-party only),
 * tapi kalau BERHASIL → preapproval external party jadi mungkin!
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

const __dirname = path.dirname(process.argv[1] ?? '.');
const env = (() => {
  const out = {};
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) {
    console.error('No .env found. Run from apps/api directory.');
    process.exit(1);
  }
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
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

  const { SDK, CustomLogAdapter } = await import('@canton-network/wallet-sdk');
  const LEDGER = env.LEDGER_API_URL.replace(/\/$/, '');
  const SCAN = env.CANTON_SCAN_URL.replace(/\/$/, '');

  const token = (await (await fetch(
    `${env.KEYCLOAK_URL}/realms/${env.KEYCLOAK_REALM}/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=client_credentials&client_id=${env.LEDGER_CLIENT_ID}&client_secret=${env.LEDGER_CLIENT_SECRET}&scope=daml_ledger_api`,
    },
  )).json()).access_token;

  // Walker scan-proxy
  function walk(node, found = [], seen = new Set()) {
    if (!node || typeof node !== 'object' || seen.has(node)) return found;
    seen.add(node);
    if (typeof node.contract_id === 'string' && typeof node.template_id === 'string' && typeof node.created_event_blob === 'string') {
      found.push({ contractId: node.contract_id, templateId: node.template_id, blob: node.created_event_blob, round: node.payload?.round?.number != null ? Number(node.payload.round.number) : undefined, opensAt: typeof node.payload?.opensAt === 'string' ? node.payload.opensAt : undefined });
    }
    for (const k of Object.keys(node)) walk(node[k], found, seen);
    return found;
  }
  const scan = async (seg) => walk(await (await fetch(`${SCAN}/${seg}`, { headers: { Authorization: `Bearer ${token}` } })).json());
  const pickOpen = (list) => {
    const open = list.filter(c => c.templateId.endsWith(':Splice.Round:OpenMiningRound'));
    const usable = open.filter(c => !c.opensAt || Date.parse(c.opensAt) <= Date.now());
    return (usable.length ? usable : open).sort((a, b) => (b.round ?? 0) - (a.round ?? 0))[0];
  };

  const arList = await scan('amulet-rules');
  const ar = arList.find(c => c.templateId.endsWith(':Splice.AmuletRules:AmuletRules')) ?? arList[0];
  const or = pickOpen(await scan('open-and-issuing-mining-rounds'));
  if (!ar || !or) throw new Error('scan-proxy kosong');
  const provider = env.CANTON_VALIDATOR_PARTY_ID;
  console.log(`[1] scan-proxy OK — round=${or.round} provider=${provider.split('::')[0]}`);

  // Provider holdings (fee)
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
  for (const e of acs ?? []) {
    const ev = e?.contractEntry?.JsActiveContract?.createdEvent ?? e;
    if (!String(ev.templateId ?? '').includes('Splice.Amulet:Amulet')) continue;
    holdings.push(ev.contractId);
  }
  console.log(`[2] provider holdings: ${holdings.length} amulet`);
  if (!holdings.length) throw new Error('provider tidak punya amulet');

  const choiceArgument = {
    context: {
      amuletRules: ar.contractId,
      context: { openMiningRound: or.contractId, issuingMiningRounds: [], validatorRights: [] },
    },
    inputs: [{ tag: 'InputAmulet', value: holdings[0] }],
    receiver: PARTY,
    provider,
    expiresAt: new Date(Date.now() + 90 * 24 * 3600e3).toISOString(),
    expectedDso: env.CANTON_DSO_PARTY_ID,
  };

  // ═══ RAW API: prepare dengan actAs ARRAY [external, provider] ═══
  console.log(`[3] PREPARE dengan actAs: [${PARTY.split('::')[0]}, ${provider.split('::')[0]}] (RAW API)...`);

  // Dapatkan synchronizerId dari SDK context
  const sdk = await SDK.create({
    auth: {
      method: 'client_credentials',
      configUrl: `${env.KEYCLOAK_URL}/realms/${env.KEYCLOAK_REALM}/.well-known/openid-configuration`,
      credentials: { clientId: env.LEDGER_CLIENT_ID, clientSecret: env.LEDGER_CLIENT_SECRET, audience: 'https://canton.network.global', scope: 'daml_ledger_api' },
    },
    ledgerClientUrl: env.LEDGER_API_URL,
    logAdapter: new CustomLogAdapter(() => {}),
  });
  const synchronizerId = sdk.ledger.sdkContext.defaultSynchronizerId;
  console.log(`[2.5] synchronizerId: ${synchronizerId}`);

  const prepRes = await fetch(`${LEDGER}/v2/interactive-submission/prepare`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: env.LEDGER_API_ADMIN_USER,
      commandId: `spike-preapproval-multi-${crypto.randomUUID()}`,
      actAs: [PARTY, provider],
      readAs: [PARTY, provider],
      commands: [{
        ExerciseCommand: {
          templateId: ar.templateId,
          contractId: ar.contractId,
          choice: 'AmuletRules_CreateTransferPreapproval',
          choiceArgument,
        },
      }],
      disclosedContracts: [
        { templateId: ar.templateId, contractId: ar.contractId, createdEventBlob: ar.blob },
        { templateId: or.templateId, contractId: or.contractId, createdEventBlob: or.blob },
      ],
      packageIdSelectionPreference: [],
      synchronizerId,
    }),
  });
  const prepText = await prepRes.text();
  console.log(`[3] Prepare HTTP ${prepRes.status}`);

  if (!prepRes.ok) {
    console.log(`    ERROR: ${prepText.slice(0, 400)}`);
    console.log('\n❌ MULTI-PARTY PREPARE GAGAL — limitation konfirmasi: interactive submission single-party only.');
    process.exit(1);
  }

  const prep = JSON.parse(prepText);
  console.log(`[4] PREPARE OK! hash=${prep.preparedTransactionHash?.slice(0, 24)}…`);

  // Sign dengan browser key
  const signature = Buffer.from(
    await ed25519.signAsync(
      new Uint8Array(Buffer.from(prep.preparedTransactionHash, 'base64')),
      SEED,
    ),
  ).toString('base64');
  console.log(`[5] Signature: ${signature.slice(0, 16)}…`);

  // Execute — coba beberapa endpoint variants
  const fingerprint = PARTY.split('::')[1];
  const execBody = JSON.stringify({
    userId: env.LEDGER_API_ADMIN_USER,
    preparedTransaction: prep.preparedTransaction,
    hashingSchemeVersion: prep.hashingSchemeVersion,
    submissionId: `spike-preapproval-multi-exec-${crypto.randomUUID()}`,
    deduplicationPeriod: { Empty: {} },
    partySignatures: {
      signatures: [{
        party: PARTY,
        signatures: [{
          signature,
          signedBy: fingerprint,
          format: 'SIGNATURE_FORMAT_CONCAT',
          signingAlgorithmSpec: 'SIGNING_ALGORITHM_SPEC_ED25519',
        }],
      }],
    },
  });

  let execRes;
  const endpoints = [
    '/v2/interactive-submission/executeAndWait',
  ];
  for (const ep of endpoints) {
    console.log(`[6] Trying ${ep}...`);
    execRes = await fetch(`${LEDGER}${ep}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: execBody,
    });
    console.log(`    HTTP ${execRes.status}`);
    if (execRes.ok || execRes.status !== 404) break;
  }
  const execText = await execRes.text();
  console.log(`[6] Execute HTTP ${execRes.status}: ${execText.slice(0, 300)}`);

  if (execRes.ok) {
    console.log('\n🎉 PASS — MULTI-PARTY INTERACTIVE SUBMISSION BEKERJA!');
    console.log('   Preapproval external party mungkin! Provider auth di-add participant otomatis.');
  } else {
    console.log('\n❌ Execute gagal — lihat error di atas.');
  }
}

main().catch(e => {
  console.error('FATAL:', e?.code ?? '', e?.cause ?? e?.message ?? e);
  process.exit(1);
});
