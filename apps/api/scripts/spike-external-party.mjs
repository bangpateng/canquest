#!/usr/bin/env node
/**
 * M0 spike — external party + interactive submission di MainNet CanQuest.
 *
 * Protokol hati-hati (disetujui user):
 *   default            → READ-ONLY: koneksi SDK + generate keypair lokal
 *                        + preview topology (endpoint generate, TIDAK commit).
 *   --allocate         → SATU alokasi external party yang disengaja (commit).
 *   --status           → cek party tersimpan via /v2/parties (read-only).
 *   --roundtrip        → uji sign-by-user end-to-end TANPA nilai:
 *                        operator create WalletRegistrationProposal (custodial,
 *                        seperti backend hari ini) → user external party
 *                        menandatangani Accept via interactive submission.
 *   --probe-security   → uji properti keamanan: submit custodial actAs external
 *                        party (pola backend hari ini) HARUS ditolak participant.
 *
 * DNS: LAN PC ini meng-override *.canquestlabs.com ke proxy mati (10.90.19.188),
 * jadi kita patch dns.lookup per-proses: resolve via DNS publik (1.1.1.1) dan
 * petakan hostname → IP publik. SNI/Host tetap hostname asli.
 *
 * Secret dibaca dari apps/api/.env — TIDAK PERNAH dicetak.
 * File state spike (berisi private key!) disimpan di os.tmpdir() DI LUAR repo.
 *
 * Jalankan dari apps/api: node scripts/spike-external-party.mjs [--allocate] ...
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { SDK, CustomLogAdapter } from '@canton-network/wallet-sdk';

// Logger redaksi: logger default SDK mencetak response token (access token!)
// ke console. Adapter ini hanya meneruskan warn/error dan membuang ctx.response.
const quietAdapter = new CustomLogAdapter((level, ctx, message) => {
  if (level !== 'warn' && level !== 'error') return;
  const safe = { ...ctx };
  delete safe.response;
  console.log(`[sdk:${level}] ${message ?? ''} ${JSON.stringify(safe).slice(0, 160)}`);
});

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));
const STATE_FILE = path.join(os.tmpdir(), 'canquest-spike-party.json');

// ── .env loader ────────────────────────────────────────────────────────────
function loadEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}
const env = loadEnv(path.join(__dirname, '..', '.env'));

const LEDGER_URL = env.LEDGER_API_URL;
const KEYCLOAK_URL = env.KEYCLOAK_URL;
const KEYCLOAK_REALM = env.KEYCLOAK_REALM;
const OPERATOR = env.CANTON_OPERATOR_PARTY_ID || env.CANTON_VALIDATOR_PARTY_ID;
const ADMIN_USER = env.LEDGER_API_ADMIN_USER || 'ledger-api-user';
const TPL_PROPOSAL = `${env.CANTON_DAML_PACKAGE_NAME || '#canquest-v29'}:Main:WalletRegistrationProposal`;

if (!LEDGER_URL || !KEYCLOAK_URL || !OPERATOR) {
  console.error('FATAL: LEDGER_API_URL / KEYCLOAK_URL / CANTON_OPERATOR_PARTY_ID tidak ada di .env');
  process.exit(1);
}

// ── DNS patch (bypass override LAN yang mati) ─────────────────────────────
const DNS_FALLBACK = {
  'ledger.canquestlabs.com': '162.250.191.195',
  'auth.canquestlabs.com': '172.67.219.57',
  'validator.canquestlabs.com': '172.67.219.57',
};
const DNS_OVERRIDES = {};

async function resolvePublicA(hostname) {
  const resolver = new dnsPromises.Resolver();
  for (const server of ['1.1.1.1', '8.8.8.8']) {
    try {
      resolver.setServers([server]);
      const addrs = await resolver.resolve4(hostname);
      if (addrs.length) return addrs[0];
    } catch {
      /* server berikutnya */
    }
  }
  return DNS_FALLBACK[hostname] || null;
}

async function installDnsOverrides() {
  const hosts = [...new Set([new URL(KEYCLOAK_URL).hostname, new URL(LEDGER_URL).hostname])];
  for (const h of hosts) {
    const ip = await resolvePublicA(h);
    if (ip) {
      DNS_OVERRIDES[h] = ip;
      console.log(`[dns] ${h} -> ${ip} (pin per-proses)`);
    } else {
      console.log(`[dns] ${h} -> resolve gagal, tanpa pin`);
    }
  }
  const origLookup = dns.lookup.bind(dns);
  dns.lookup = (hostname, options, callback) => {
    let cb = callback;
    let opts = options;
    if (typeof opts === 'function') {
      cb = opts;
      opts = {};
    }
    const target = DNS_OVERRIDES[hostname];
    if (!target) return origLookup(hostname, opts, cb);
    return origLookup(target, opts, cb);
  };
}

// ── util ───────────────────────────────────────────────────────────────────
const b64ToHex = (b64) => Buffer.from(b64, 'base64').toString('hex');
const hexToB64 = (hex) => Buffer.from(hex, 'hex').toString('base64');

function loadState() {
  if (!fs.existsSync(STATE_FILE)) return null;
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}
function saveState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), { mode: 0o600 });
  console.log(`[state] tersimpan di ${STATE_FILE} (DI LUAR repo, berisi private key!)`);
}

async function adminToken() {
  const url = `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: env.LEDGER_CLIENT_ID,
    client_secret: env.LEDGER_CLIENT_SECRET,
    scope: env.LEDGER_API_AUTH_SCOPE || 'daml_ledger_api',
  }).toString();
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`token HTTP ${res.status}`);
  const json = await res.json();
  return json.access_token;
}

async function legacySubmit(token, commands, actAs, commandId, waitMode = 'submit-and-wait') {
  const res = await fetch(`${LEDGER_URL.replace(/\/$/, '')}/v2/commands/${waitMode}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ commands, userId: ADMIN_USER, commandId, actAs, readAs: actAs }),
    signal: AbortSignal.timeout(30000),
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

function firstCreatedContractId(json) {
  const stack = [json];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object') continue;
    if (typeof cur.contractId === 'string' && cur.createdEventId) return cur.contractId;
    if (typeof cur.contractId === 'string' && cur.templateId) return cur.contractId;
    for (const k of Object.keys(cur)) stack.push(cur[k]);
  }
  return null;
}

const results = [];
const track = (step, ok, detail = '') => {
  results.push({ step, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? ` — ${detail}` : ''}`);
};

// ── langkah-langkah ────────────────────────────────────────────────────────
async function stepConnect(sdk) {
  const end = await sdk.ledger.ledgerEnd();
  track('sdk-connect', Number.isFinite(end), `ledgerEnd=${end}`);
}

async function stepTopology(sdk) {
  const kp = sdk.keys.generate();
  const fingerprint = await sdk.keys.fingerprint(kp.publicKey);
  const hint = `canquest-user-${crypto.randomBytes(4).toString('hex')}`;
  const previewPartyId = `${hint}::${fingerprint}`;
  console.log(`[keys] partyHint=${hint}`);
  console.log(`[keys] fingerprint=${fingerprint}`);
  console.log(`[keys] preview partyId=${previewPartyId}`);
  console.log(`[keys] privateKey (raw hex 64 char, format backup nuxaris):`);
  console.log(`        ${b64ToHex(kp.privateKey)}`);
  console.log(`[keys] PERINGATAN: di atas adalah kunci spike sekali pakai — jangan dipakai untuk dana.`);

  const prepared = sdk.party.external.create(kp.publicKey, { partyHint: hint });
  const topo = await prepared.topology(); // generate-only, TIDAK commit
  console.log(`[topology] partyId=${topo.partyId} multiHash=${String(topo.multiHash).slice(0, 32)}…`);
  track('topology-generate', topo.partyId === previewPartyId || !!topo.partyId, `partyId=${topo.partyId}`);
  return { kp, hint, fingerprint, prepared };
}

async function stepAllocate(sdk, ctx, state) {
  if (state?.partyId) {
    console.log(`[allocate] party sudah ada: ${state.partyId} — lewati.`);
    return state;
  }
  const signed = ctx.prepared.sign(ctx.kp.privateKey);
  const res = await signed.execute();
  console.log(`[allocate] OK partyId=${res.partyId} fingerprint=${res.publicKeyFingerprint}`);
  const newState = {
    partyId: res.partyId,
    hint: ctx.hint,
    fingerprint: res.publicKeyFingerprint,
    publicKeyB64: ctx.kp.publicKey,
    privateKeyB64: ctx.kp.privateKey,
    privateKeyHex: b64ToHex(ctx.kp.privateKey),
    allocatedAt: new Date().toISOString(),
  };
  saveState(newState);
  track('allocate-external-party', !!res.partyId, res.partyId);
  return newState;
}

async function stepStatus(state) {
  if (!state?.partyId) return track('status', false, 'belum ada party (jalankan --allocate dulu)');
  const token = await adminToken();
  const res = await fetch(
    `${LEDGER_URL.replace(/\/$/, '')}/v2/parties/${encodeURIComponent(state.partyId)}`,
    { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) },
  );
  console.log(`[status] /v2/parties/${state.partyId.split('::')[0]}… -> HTTP ${res.status}`);
  track('party-registered', res.status === 200, `HTTP ${res.status}`);
}

async function createProposalFor(token, partyId) {
  const nowIso = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const commandId = `spike-prop-${crypto.randomUUID()}`;
  const res = await legacySubmit(
    token,
    [
      {
        CreateCommand: {
          templateId: TPL_PROPOSAL,
          createArguments: {
            admin: OPERATOR,
            userAddress: partyId,
            userProfileRef: 'user:spike',
            partyId,
            registeredAt: nowIso,
          },
        },
      },
    ],
    [OPERATOR],
    commandId,
    'submit-and-wait-for-transaction-tree',
  );
  const cid = res.ok ? firstCreatedContractId(JSON.parse(res.text)) : null;
  console.log(`[proposal] create HTTP ${res.status} contractId=${cid ?? '-'}`);
  if (!res.ok) console.log(`[proposal] error: ${res.text.slice(0, 300)}`);
  return cid;
}

async function stepRoundtrip(sdk, state) {
  if (!state?.partyId) return track('roundtrip', false, 'belum ada party (jalankan --allocate dulu)');
  const token = await adminToken();

  // 1) Operator create proposal — persis pola backend hari ini (custodial).
  const cid = await createProposalFor(token, state.partyId);
  if (!cid) return track('roundtrip-proposal', false, 'create proposal gagal');
  track('roundtrip-proposal', true, cid.slice(0, 24) + '…');

  // 2) PREPARE interactive submission: Accept di-sign oleh USER.
  const commandId = `spike-accept-${crypto.randomUUID()}`;
  const prepared = sdk.ledger.prepare({
    partyId: state.partyId,
    commands: [
      {
        ExerciseCommand: {
          templateId: TPL_PROPOSAL,
          contractId: cid,
          choice: 'Accept',
          choiceArgument: {},
        },
      },
    ],
    commandId,
  });
  const json = await prepared.toJSON();
  console.log(
    `[prepare] hash=${json.response.preparedTransactionHash.slice(0, 32)}… scheme=${json.response.hashingSchemeVersion}`,
  );
  track('roundtrip-prepare', !!json.response.preparedTransactionHash);

  // 3) SIGN dengan private key user + EXECUTE.
  const signed = prepared.sign(state.privateKeyB64);
  const exec = await sdk.ledger.execute(signed, { partyId: state.partyId, submissionId: commandId });
  console.log(`[execute] hasil: ${JSON.stringify(exec).slice(0, 240)}`);
  track('roundtrip-execute', !!exec, 'lihat hasil di atas');
}

async function stepProbeSecurity(state) {
  if (!state?.partyId) return track('probe-security', false, 'belum ada party (jalankan --allocate dulu)');
  const token = await adminToken();
  const cid = await createProposalFor(token, state.partyId);
  if (!cid) return track('probe-security', false, 'create proposal gagal');

  // Submit custodial ala backend hari ini: actAs [operator, externalParty].
  const res = await legacySubmit(
    token,
    [
      {
        ExerciseCommand: {
          templateId: TPL_PROPOSAL,
          contractId: cid,
          choice: 'Accept',
          choiceArgument: {},
        },
      },
    ],
    [OPERATOR, state.partyId],
    `spike-sec-${crypto.randomUUID()}`,
    'submit-and-wait-for-transaction-tree',
  );
  const text = res.text.slice(0, 400);
  console.log(`[security] submit custodial actAs external party -> HTTP ${res.status}`);
  console.log(`[security] ${text}`);
  if (!res.ok) {
    const t = text.toLowerCase();
    const signatureGate =
      t.includes('signature') || t.includes('external') || t.includes('not hosted') || t.includes('unauthorized');
    track(
      'probe-security',
      true,
      signatureGate
        ? 'DITOLAK di gerbang tanda tangan external party — properti keamanan TERKONFIRMASI'
        : `ditolak, tapi alasan belum jelas — periksa pesan di atas`,
    );
  } else {
    track(
      'probe-security',
      false,
      'DITERIMA tanpa tanda tangan user! Operator masih bisa actAs party external → rights operator WAJIB di-revoke per-party (lihat rencana M2/M3).',
    );
  }
}

// ── main ───────────────────────────────────────────────────────────────────
async function main() {
  console.log(`== CanQuest M0 spike — external party ==`);
  console.log(`ledger=${LEDGER_URL}`);
  console.log(`operator=${OPERATOR?.split('::')[0]}…  template=${TPL_PROPOSAL}`);
  console.log(`mode flags: ${[...args].join(' ') || '(read-only)'}\n`);

  await installDnsOverrides();

  let sdk;
  try {
    sdk = await SDK.create({
      auth: {
        method: 'client_credentials',
        configUrl: `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/.well-known/openid-configuration`,
        credentials: {
          clientId: env.LEDGER_CLIENT_ID,
          clientSecret: env.LEDGER_CLIENT_SECRET,
          audience: env.CANTON_LEDGER_API_AUDIENCE || 'https://canton.network.global',
          scope: env.LEDGER_API_AUTH_SCOPE || 'daml_ledger_api',
        },
      },
      ledgerClientUrl: LEDGER_URL,
      logAdapter: quietAdapter,
    });
    await stepConnect(sdk);
  } catch (e) {
    track('sdk-connect', false, e.message);
    console.log('\nKoneksi ledger gagal — pastikan whitelist IP / tunnel sudah aktif.');
    summarize();
    process.exit(1);
  }

  const existing = loadState();
  let ctx = null;
  let state = existing;

  if (args.has('--allocate') || args.has('--roundtrip') || args.has('--probe-security')) {
    if (state?.partyId && state.privateKeyB64) {
      console.log(`[spike] pakai party Existing dari state: ${state.partyId}`);
    } else {
      ctx = await stepTopology(sdk);
    }
  } else {
    ctx = await stepTopology(sdk); // read-only preview
  }

  if (args.has('--allocate')) state = await stepAllocate(sdk, ctx, state);
  if (args.has('--status')) await stepStatus(state);
  if (args.has('--roundtrip')) await stepRoundtrip(sdk, state);
  if (args.has('--probe-security')) await stepProbeSecurity(state);

  summarize();
}

function summarize() {
  console.log('\n== RINGKASAN ==');
  for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.step}${r.detail ? ` — ${r.detail}` : ''}`);
  const failed = results.filter((r) => !r.ok).length;
  console.log(failed === 0 ? '\nSemua langkah hijau.' : `\n${failed} langkah gagal — lihat FAIL di atas.`);
}

main().catch((e) => {
  console.error('FATAL:', e?.stack || e);
  process.exit(1);
});
