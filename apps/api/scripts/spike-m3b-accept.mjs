#!/usr/bin/env node
/**
 * M3b — VALIDASI BERDAN accept_offer non-custodial di MainNet.
 * Offer pending: karel → canquest-user-60a011db (2 CC).
 * Alur = persis SigningRelayService.buildOfferAction('accept'):
 *   choice-context via Scan-proxy → interactive prepare → sign seed → execute.
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
const SEED = Buffer.from(state.privateKeyB64, 'base64').subarray(0, 32);
const CID = process.argv[2];

if (!CID) {
  console.error('Pakai: node spike-m3b-accept.mjs <transferInstructionCid>');
  process.exit(1);
}

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
  const ed25519 = await import('@noble/ed25519');
  const toB64 = (b) => Buffer.from(b).toString('base64');
  const fromB64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
  const LEDGER = env.LEDGER_API_URL.replace(/\/$/, '');

  // Token
  const tres = await fetch(`${env.KEYCLOAK_URL}/realms/${env.KEYCLOAK_REALM}/protocol/openid-connect/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=client_credentials&client_id=${env.LEDGER_CLIENT_ID}&client_secret=${env.LEDGER_CLIENT_SECRET}&scope=daml_ledger_api`,
  });
  const token = (await tres.json()).access_token;

  // 1) Choice context (CC path — Scan-proxy)
  const scanBase = `${env.CANTON_SCAN_URL}`;
  const ctxUrl = `${scanBase}/registry/transfer-instruction/v1/${encodeURIComponent(CID)}/choice-contexts/accept`;
  const ctxRes = await fetch(ctxUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ meta: {}, excludeDebugFields: false }),
  });
  if (!ctxRes.ok) throw new Error(`choice-context ${ctxRes.status}: ${(await ctxRes.text()).slice(0, 200)}`);
  const ctx = await ctxRes.json();
  console.log(`[1] choice-context OK — disclosed=${(ctx.disclosedContracts ?? []).length}`);

  // 2) PREPARE — persis buildOfferAction
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
  const commandId = `spike-m3b-accept-${crypto.randomUUID()}`;
  const prepared = sdk.ledger.prepare({
    partyId: PARTY,
    commands: [{
      ExerciseCommand: {
        templateId: '#splice-api-token-transfer-instruction-v1:Splice.Api.Token.TransferInstructionV1:TransferInstruction',
        contractId: CID,
        choice: 'TransferInstruction_Accept',
        choiceArgument: { extraArgs: { context: ctx.choiceContextData ?? ctx, meta: { values: {} } } },
      },
    }],
    commandId,
    disclosedContracts: ctx.disclosedContracts,
  });
  const resp = await prepared.preparedPromise;
  console.log(`[2] PREPARE OK — hash=${resp.preparedTransactionHash.slice(0, 24)}…`);

  // 3) SIGN (seed browser-style) + EXECUTE
  const signature = toB64(await ed25519.signAsync(fromB64(resp.preparedTransactionHash), SEED));
  console.log(`[3] signature: ${signature.slice(0, 16)}…`);
  const signed = sdk.ledger.fromSignature(resp, signature);
  const exec = await sdk.ledger.execute(signed, { partyId: PARTY, submissionId: commandId });
  console.log(`[4] EXECUTE OK — updateId=${exec?.updateId?.slice(0, 24)}… offset=${exec?.completionOffset}`);
  console.log('\nPASS — accept_offer non-custodal terbukti dengan dana nyata (2 CC masuk ke party spike).');
  process.exit(0);
}

main().catch((e) => {
  console.error('FATAL:', e?.code ?? '', e?.cause ?? e?.message ?? e);
  process.exit(1);
});
