#!/usr/bin/env node
/**
 * M3b — VALIDASI BERDAN send_cc non-custodial di MainNet.
 * Party spike: canquest-user-60a011db (kunci di state file tmp, user kirim 2 CC).
 *
 * Langkah:
 *   1. Cek holdings spike party (2 CC harus terlihat).
 *   2. Build command CIP-56 transfer 1 CC → wallet REWARD platform
 *      (dana kembali ke platform, bukan hilang).
 *   3. interactive PREPARE (jalur persis SigningRelayService).
 *   4. SIGN dengan seed browser-style (noble) → fromSignature → EXECUTE.
 *   5. Cek holdings ulang (harus turun ~1 CC).
 *
 * Tanpa leg fee — satu command cukup untuk memvalidasi jalur dana.
 */
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import crypto from 'node:crypto';
import { webcrypto } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

// PENTING: @noble/ed25519 & wallet-sdk di-import DINAMIS setelah patch DNS —
// import statis memuat net/undici sebelum dns.lookup dipatch (undici lalu
// memakai DNS OS → proxy LAN mati → timeout).

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
const state = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'canquest-spike-party.json'), 'utf8'));

const LEDGER = env.LEDGER_API_URL.replace(/\/$/, '');
const PARTY = state.partyId;
const SEED = Buffer.from(state.privateKeyB64, 'base64').subarray(0, 32);
const RECEIVER = env.CANTON_REWARD_PARTY_ID || env.CANTON_VALIDATOR_PARTY_ID;
const AMOUNT = 1;

const toB64 = (b) => Buffer.from(b).toString('base64');
const fromB64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));

const DNS_FALLBACK = {
  'ledger.canquestlabs.com': '162.250.191.195',
  'auth.canquestlabs.com': '172.67.219.57',
  'validator.canquestlabs.com': '172.67.219.57',
};

async function resolveA(h) {
  const r = new dnsPromises.Resolver();
  for (const s of ['1.1.1.1', '8.8.8.8']) {
    try { r.setServers([s]); const a = await r.resolve4(h); if (a.length) return a[0]; } catch {}
  }
  return DNS_FALLBACK[h] ?? null;
}

async function httpsToken() {
  let lastErr = null;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(
        `${env.KEYCLOAK_URL}/realms/${env.KEYCLOAK_REALM}/protocol/openid-connect/token`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: `grant_type=client_credentials&client_id=${env.LEDGER_CLIENT_ID}&client_secret=${env.LEDGER_CLIENT_SECRET}&scope=daml_ledger_api`,
        },
      );
      const json = await res.json();
      if (json.access_token) return json.access_token;
      lastErr = new Error(`token HTTP ${res.status}`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

async function holdings(token) {
  const endRes = await fetch(`${LEDGER}/v2/state/ledger-end`, { headers: { Authorization: `Bearer ${token}` } });
  const end = await endRes.json();
  const offset = end.offset ?? 0;
  if (!offset) throw new Error('ledger-end offset 0');
  const res = await fetch(`${LEDGER}/v2/state/active-contracts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      eventFormat: {
        filtersByParty: { [PARTY]: { cumulative: [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }] } },
        verbose: true,
      },
      activeAtOffset: offset,
    }),
  });
  if (!res.ok) throw new Error(`ACS ${res.status}: ${(await res.text()).slice(0, 150)}`);
  const contracts = await res.json();
  let total = 0;
  const cids = [];
  for (const entry of contracts ?? []) {
    const wrapper = entry ?? {};
    const jsActive = wrapper.contractEntry?.JsActiveContract;
    const ev = jsActive?.createdEvent ?? wrapper;
    if (!String(ev.templateId ?? '').includes('Splice.Amulet:Amulet')) continue;
    if (ev.createArgument?.owner && ev.createArgument.owner !== PARTY) continue;
    const amt = parseFloat(
      ev.createArgument?.amount?.initialAmount ?? ev.createArgument?.amount?.amount ?? '0',
    );
    total += amt;
    cids.push(ev.contractId);
  }
  return { total, cids };
}

async function main() {
  // DNS pin
  const pins = {};
  for (const h of [new URL(env.KEYCLOAK_URL).hostname, new URL(LEDGER).hostname, new URL(env.CANTON_SCAN_URL).hostname]) {
    const ip = await resolveA(h);
    if (ip) pins[h] = ip;
    console.log(`[dns] ${h} -> ${ip ?? 'TANPA PIN (bahaya)'}`);
  }
  const orig = dns.lookup.bind(dns);
  dns.lookup = (hostname, options, callback) => {
    let cb = callback, opts = options;
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    return pins[hostname] ? orig(pins[hostname], opts, cb) : orig(hostname, opts, cb);
  };

  const token = await httpsToken();
  console.log(`party : ${PARTY.split('::')[0]}`);
  console.log(`tujuan: ${RECEIVER.split('::')[0]} (wallet reward platform)`);
  console.log(`jumlah: ${AMOUNT} CC\n`);

  // 1) Holdings sebelum
  const before = await holdings(token);
  console.log(`[1] holdings SEBELUM: ${before.total.toFixed(4)} CC (${before.cids.length} amulet)`);
  if (before.total < AMOUNT) {
    console.log('    Dana 2 CC belum terlihat — tunggu sync masuk dulu (cc masuk via amulet). STOP.');
    process.exit(1);
  }

  // 2) Build choiceArguments (mirror buildCip56TransferCommand)
  const now = new Date();
  const dso = env.CANTON_DSO_PARTY_ID;
  const choiceArguments = {
    expectedAdmin: dso,
    transfer: {
      sender: PARTY,
      receiver: RECEIVER,
      amount: AMOUNT.toFixed(10),
      instrumentId: { admin: dso, id: 'Amulet' },
      lock: null,
      requestedAt: now.toISOString(),
      executeBefore: new Date(now.getTime() + 24 * 3600_000).toISOString(),
      inputHoldingCids: before.cids,
      meta: { values: { 'splice.lfdecentralizedtrust.org/reason': 'M3b funded validation' } },
    },
    extraArgs: { context: { values: {} }, meta: { values: {} } },
  };

  // 3) Registry (CC path = Scan-proxy)
  const regUrl = `${env.CANTON_SCAN_URL}/registry/transfer-instruction/v1/transfer-factory`;
  const regRes = await fetch(regUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ choiceArguments, excludeDebugFields: true }),
  });
  if (!regRes.ok) throw new Error(`registry ${regRes.status}: ${(await regRes.text()).slice(0, 200)}`);
  const reg = await regRes.json();
  const ctxWrap = reg.choiceContext ?? {};
  const regContext = ctxWrap.choiceContextData ?? { values: {} };
  const regDisclosed = ctxWrap.disclosedContracts ?? [];
  console.log(`[2] registry OK — kind=${reg.transferKind ?? '?'} factory=${String(reg.factoryId ?? '').slice(0, 16)}… disclosed=${regDisclosed.length}`);
  // Mirror callTransferFactoryRegistry: context = choiceContext.choiceContextData.
  choiceArguments.extraArgs.context = regContext;

  // 4) PREPARE via SDK — jalur persis SigningRelayService (import dinamis!)
  const { SDK, CustomLogAdapter } = await import('@canton-network/wallet-sdk');
  const ed25519 = await import('@noble/ed25519');
  const sdk = await SDK.create({
    auth: {
      method: 'client_credentials',
      configUrl: `${env.KEYCLOAK_URL}/realms/${env.KEYCLOAK_REALM}/.well-known/openid-configuration`,
      credentials: { clientId: env.LEDGER_CLIENT_ID, clientSecret: env.LEDGER_CLIENT_SECRET, audience: 'https://canton.network.global', scope: 'daml_ledger_api' },
    },
    ledgerClientUrl: env.LEDGER_API_URL,
    logAdapter: new CustomLogAdapter(() => {}),
  });
  const commandId = `spike-m3b-send-${crypto.randomUUID()}`;
  const prepared = sdk.ledger.prepare({
    partyId: PARTY,
    commands: [{
      ExerciseCommand: {
        templateId: '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferFactory',
        contractId: reg.factoryId,
        choice: 'TransferFactory_Transfer',
        choiceArgument: choiceArguments,
      },
    }],
    commandId,
    disclosedContracts: regDisclosed,
  });
  const resp = await prepared.preparedPromise;
  console.log(`[3] PREPARE OK — hash=${resp.preparedTransactionHash.slice(0, 24)}… scheme=${resp.hashingSchemeVersion}`);

  // 5) SIGN browser-style → EXECUTE
  const signature = toB64(await ed25519.signAsync(fromB64(resp.preparedTransactionHash), SEED));
  console.log(`[4] signature (noble seed): ${signature.slice(0, 16)}…`);
  const signed = sdk.ledger.fromSignature(resp, signature);
  const exec = await sdk.ledger.execute(signed, { partyId: PARTY, submissionId: commandId });
  console.log(`[5] EXECUTE OK — updateId=${exec?.updateId?.slice(0, 24)}… offset=${exec?.completionOffset}`);

  // 6) Holdings sesudah
  await new Promise((r) => setTimeout(r, 4000));
  const after = await holdings(token);
  console.log(`[6] holdings SESUDAH: ${after.total.toFixed(4)} CC (delta ${(after.total - before.total).toFixed(4)})`);

  const pass = !!exec?.updateId && after.total < before.total;
  console.log(pass ? '\nPASS — send_cc non-custodial terbukti END-TO-END dengan dana nyata.' : '\nPERIKSA — lihat langkah di atas.');
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL:', e?.code ?? '', e?.cause ?? e?.message ?? e);
  process.exit(1);
});
