#!/usr/bin/env node
/**
 * M3 — validasi jalur signing-relay yang dipakai SigningRelayService:
 * prepare → (signature eksternal ala browser) → ledger.fromSignature() →
 * ledger.execute() — BUKAN prepared.sign() yang diuji M0.
 *
 * Flow uji: alokasi external party baru → operator create
 * WalletRegistrationProposal → prepare Accept (partyId=external) →
 * signature noble 32-byte → fromSignature + execute → updateId.
 * Nol nilai yang berpindah.
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

const LEDGER = env.LEDGER_API_URL.replace(/\/$/, '');
const toB64 = (b) => Buffer.from(b).toString('base64');
const fromB64 = (s) => new Uint8Array(Buffer.from(s, 'base64'));
const toHex = (b) => Buffer.from(b).toString('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let cachedToken = null;
async function token0() {
  if (cachedToken) return cachedToken;
  const tres = await fetch(`${env.KEYCLOAK_URL}/realms/${env.KEYCLOAK_REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: env.LEDGER_CLIENT_ID,
      client_secret: env.LEDGER_CLIENT_SECRET,
      scope: 'daml_ledger_api',
    }),
  });
  cachedToken = (await tres.json()).access_token;
  return cachedToken;
}

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
  const pins = {};
  for (const h of [new URL(env.KEYCLOAK_URL).hostname, new URL(LEDGER).hostname]) {
    const ip = await resolveA(h);
    if (ip) pins[h] = ip;
  }
  const orig = dns.lookup.bind(dns);
  dns.lookup = (hostname, options, callback) => {
    let cb = callback, opts = options;
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    return pins[hostname] ? orig(pins[hostname], opts, cb) : orig(hostname, opts, cb);
  };

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

  // 1) Party external baru (via signature noble — pola M2 tervalidasi)
  const seed = ed25519.utils.randomSecretKey();
  const pub = await ed25519.getPublicKeyAsync(seed);
  const hint = `canquest-user-${toHex(crypto.getRandomValues(new Uint8Array(4)))}`;
  const prepParty = sdk.party.external.create(toB64(pub), { partyHint: hint });
  const topo = await prepParty.topology();
  const partySig = toB64(await ed25519.signAsync(fromB64(topo.multiHash), seed));
  const { partyId } = await prepParty.execute(partySig, { grantUserRights: false });
  console.log(`[1] party external: ${partyId.split('::')[0]}`);

  // 1b) GRANT rights admin atas party — hipotesis: interactive execute butuh
  // userId submitter berhak (CanActAs) meski tanda tangan party sudah valid.
  // (M0-strict: rights TIDAK memungkinkan submit tanpa tanda tangan user.)
  const gres = await fetch(`${LEDGER}/v2/users/${encodeURIComponent(env.LEDGER_API_ADMIN_USER)}/rights`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token0()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      identityProviderId: '',
      userId: env.LEDGER_API_ADMIN_USER,
      rights: [
        { kind: { CanActAs: { value: { party: partyId } } } },
        { kind: { CanReadAs: { value: { party: partyId } } } },
      ],
    }),
  });
  console.log(`[1b] grant rights admin -> HTTP ${gres.status}`);
  await sleep(3000); // beri waktu propagasi topology party

  // 2) Token admin + proposal (leg operator, custodial — seperti backend)
  const tres = await fetch(`${env.KEYCLOAK_URL}/realms/${env.KEYCLOAK_REALM}/protocol/openid-connect/token`, {
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

  const TPL = `${env.CANTON_DAML_PACKAGE_NAME || '#canquest-v29'}:Main:WalletRegistrationProposal`;
  const nowIso = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const pres = await fetch(`${LEDGER}/v2/commands/submit-and-wait-for-transaction-tree`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      commands: [{
        CreateCommand: {
          templateId: TPL,
          createArguments: {
            admin: env.CANTON_OPERATOR_PARTY_ID,
            userAddress: partyId,
            userProfileRef: 'user:spike-m3',
            partyId,
            registeredAt: nowIso,
          },
        },
      }],
      userId: env.LEDGER_API_ADMIN_USER,
      commandId: `spike-m3-prop-${crypto.randomUUID()}`,
      actAs: [env.CANTON_OPERATOR_PARTY_ID],
      readAs: [env.CANTON_OPERATOR_PARTY_ID],
    }),
  });
  let cid = null;
  const walk = (o) => {
    if (!o || typeof o !== 'object' || cid) return;
    if (typeof o.contractId === 'string' && (o.createdEventId || o.templateId)) { cid = o.contractId; return; }
    for (const k of Object.keys(o)) walk(o[k]);
  };
  walk(JSON.parse(await pres.text()));
  console.log(`[2] proposal: ${cid ? cid.slice(0, 20) + '…' : 'GAGAL'}`);
  if (!cid) process.exit(1);

  // 3) PREPARE via sdk.ledger.prepare — persis SigningRelayService
  const commandId = `spike-m3-accept-${crypto.randomUUID()}`;
  const prepared = sdk.ledger.prepare({
    partyId,
    commands: [{
      ExerciseCommand: { templateId: TPL, contractId: cid, choice: 'Accept', choiceArgument: {} },
    }],
    commandId,
  });
  const resp = await prepared.preparedPromise; // ← yang disimpan service di pending-map
  console.log(`[3] prepare OK — hash=${resp.preparedTransactionHash.slice(0, 20)}…`);

  // 4) SIGN ala browser (noble, 32-byte seed)
  const signature = toB64(await ed25519.signAsync(fromB64(resp.preparedTransactionHash), seed));
  console.log(`[4] signature: ${signature.slice(0, 16)}…`);

  // 5) fromSignature + execute — jalur yang dipakai service (BUKAN prepared.sign)
  const signed = sdk.ledger.fromSignature(resp, signature);
  const exec = await sdk.ledger.execute(signed, { partyId, submissionId: commandId });
  console.log(`[5] execute: ${JSON.stringify(exec).slice(0, 200)}`);

  const pass = !!exec && (exec.updateId || exec.completionOffset !== undefined);
  console.log(pass ? '\nPASS — jalur fromSignature+execute valid untuk SigningRelayService.' : '\nFAIL');
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
