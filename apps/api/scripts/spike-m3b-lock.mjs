#!/usr/bin/env node
/**
 * M3b — VALIDASI BERDAN lock_cc + unlock_cc non-custodial di MainNet.
 * Party spike (saldo ~1 CC): kunci 0.5 CC self-held (term 2m) → tunggu jatuh
 * tempo → unlock. Jalur = persis SigningRelayService buildLockCc/buildUnlockCc
 * (AmuletRules_Transfer self-lock + LockedAmulet_OwnerExpireLockV2, satu
 * tanda tangan user per aksi).
 *
 * Runtime ~3 menit (term terpendek 120 detik).
 */
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
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
const AMOUNT = 0.5;
const LOCK_SECONDS = 120;

const DNS_FALLBACK = { 'ledger.canquestlabs.com': '162.250.191.195', 'auth.canquestlabs.com': '172.67.219.57', 'validator.canquestlabs.com': '172.67.219.57' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
  const SCAN = env.CANTON_SCAN_URL.replace(/\/$/, '');

  const sdk = await SDK.create({
    auth: {
      method: 'client_credentials',
      configUrl: `${env.KEYCLOAK_URL}/realms/${env.KEYCLOAK_REALM}/.well-known/openid-configuration`,
      credentials: { clientId: env.LEDGER_CLIENT_ID, clientSecret: env.LEDGER_CLIENT_SECRET, audience: 'https://canton.network.global', scope: 'daml_ledger_api' },
    },
    ledgerClientUrl: env.LEDGER_API_URL,
    logAdapter: new CustomLogAdapter(() => {}),
  });

  const token = (await (await fetch(`${env.KEYCLOAK_URL}/realms/${env.KEYCLOAK_REALM}/protocol/openid-connect/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=client_credentials&client_id=${env.LEDGER_CLIENT_ID}&client_secret=${env.LEDGER_CLIENT_SECRET}&scope=daml_ledger_api`,
  })).json()).access_token;

  async function acs() {
    const offset = (await (await fetch(`${LEDGER}/v2/state/ledger-end`, { headers: { Authorization: `Bearer ${token}` } })).json()).offset;
    const res = await fetch(`${LEDGER}/v2/state/active-contracts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventFormat: { filtersByParty: { [PARTY]: { cumulative: [{ identifierFilter: { WildcardFilter: { value: { includeCreatedEventBlob: false } } } }] } }, verbose: true },
        activeAtOffset: offset,
      }),
    });
    return (await res.json()) ?? [];
  }

  async function signAndExecute(commands, commandId, disclosed) {
    const prepared = sdk.ledger.prepare({ partyId: PARTY, commands, commandId, disclosedContracts: disclosed });
    const resp = await prepared.preparedPromise;
    const signature = toB64(await ed25519.signAsync(fromB64(resp.preparedTransactionHash), SEED));
    const signed = sdk.ledger.fromSignature(resp, signature);
    return sdk.ledger.execute(signed, { partyId: PARTY, submissionId: commandId });
  }

  // Walker mirror fetchScanProxyContract: cari {contract_id, template_id,
  // created_event_blob} bersarang (field snake_case) di respons scan-proxy.
  function walkContracts(node, found = [], seen = new Set()) {
    if (!node || typeof node !== 'object' || seen.has(node)) return found;
    seen.add(node);
    const o = node;
    if (typeof o.contract_id === 'string' && typeof o.template_id === 'string' && typeof o.created_event_blob === 'string') {
      found.push({
        contractId: o.contract_id,
        templateId: o.template_id,
        blob: o.created_event_blob,
        round: o.payload?.round?.number != null ? Number(o.payload.round.number) : undefined,
        opensAt: typeof o.payload?.opensAt === 'string' ? o.payload.opensAt : undefined,
      });
    }
    for (const k of Object.keys(o)) walkContracts(o[k], found, seen);
    return found;
  }

  async function scanContract(seg) {
    const res = await fetch(`${SCAN}/${seg}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) throw new Error(`scan-proxy /${seg} ${res.status}: ${(await res.text()).slice(0, 150)}`);
    return walkContracts(await res.json());
  }

  // ════ 1. LOCK 0.5 CC (self-held) ════
  const arList = await scanContract('amulet-rules');
  const orAll = await scanContract('open-and-issuing-mining-rounds');
  // Mirror produksi: OpenMiningRound eksak, sudah dibuka, round number TERTINGGI.
  function pickOpenRound(list) {
    const open = list.filter((c) => c.templateId.endsWith(':Splice.Round:OpenMiningRound'));
    if (!open.length) return null;
    const usable = open.filter((c) => !c.opensAt || Date.parse(c.opensAt) <= nowMs);
    return (usable.length ? usable : open).sort((a, b) => (b.round ?? 0) - (a.round ?? 0))[0];
  }
  const nowMs = Date.now();
  const ar =
    arList.find((c) => c.templateId.endsWith(':Splice.AmuletRules:AmuletRules')) ?? arList[0];
  const or = pickOpenRound(orAll);
  if (!ar || !or) throw new Error(`scan-proxy kosong (ar=${arList.length} or=${orAll.length})`);
  console.log(`[1] scan-proxy OK — amuletRules=${ar.contractId.slice(0, 14)}… openRound=${or.round} (kandidat or=${orAll.length})`);

  const contracts = await acs();
  const holdings = [];
  for (const entry of contracts) {
    const ev = entry?.contractEntry?.JsActiveContract?.createdEvent ?? entry;
    if (!String(ev.templateId ?? '').includes('Splice.Amulet:Amulet')) continue;
    const a = ev.createArgument ?? {};
    holdings.push({
      contractId: ev.contractId,
      initialAmount: a.amount?.initialAmount ?? '0',
      createdAtRound: a.createdAtRound ?? a.amount?.createdAtRound ?? 0,
      ratePerRound: a.amount?.ratePerRound ?? a.ratePerRound ?? '0',
    });
  }
  const totalInit = holdings.reduce((s, h) => s + (parseFloat(h.initialAmount) || 0), 0);
  console.log(`[2] holdings: ${totalInit.toFixed(4)} CC (${holdings.length} amulet)`);
  if (totalInit < AMOUNT) throw new Error('saldo kurang');

  const round = or.round ?? 0;
  const scored = holdings
    .map((h) => {
      const decay = Math.max(0, round - (h.createdAtRound || 0)) * (parseFloat(h.ratePerRound) || 0);
      return { h, eff: Math.max(0, (parseFloat(h.initialAmount) || 0) - decay) };
    })
    .sort((a, b) => b.eff - a.eff);
  const inputs = [];
  let acc = 0;
  for (const s of scored) { inputs.push({ tag: 'InputAmulet', value: s.h.contractId }); acc += s.eff; if (acc >= AMOUNT) break; }

  const expiresAt = new Date(Date.now() + LOCK_SECONDS * 1000).toISOString();
  const choiceArgument = {
    transfer: {
      sender: PARTY,
      provider: PARTY, // SELF-HELD — kunci external
      inputs,
      outputs: [{ receiver: PARTY, receiverFeeRatio: '0.0', amount: AMOUNT.toString(), lock: { holders: [PARTY], expiresAt, optContext: null } }],
      beneficiaries: null,
    },
    context: { openMiningRound: or.contractId, issuingMiningRounds: [], validatorRights: [], featuredAppRight: null },
    expectedDso: env.CANTON_DSO_PARTY_ID,
  };
  const disclosed = [
    { templateId: ar.templateId, contractId: ar.contractId, createdEventBlob: ar.blob },
    { templateId: or.templateId, contractId: or.contractId, createdEventBlob: or.blob },
  ];

  console.log(`[3] LOCK prepare+sign+execute (${AMOUNT} CC, ${LOCK_SECONDS}s, self-held)…`);
  const lockExec = await signAndExecute([{
    ExerciseCommand: { templateId: ar.templateId, contractId: ar.contractId, choice: 'AmuletRules_Transfer', choiceArgument },
  }], `spike-lock-${crypto.randomUUID()}`, disclosed);
  console.log(`[4] LOCK OK — updateId=${lockExec?.updateId?.slice(0, 22)}…`);

  // Verifikasi LockedAmulet ada
  const afterLock = await acs();
  const locked = [];
  for (const entry of afterLock) {
    const ev = entry?.contractEntry?.JsActiveContract?.createdEvent ?? entry;
    if (!String(ev.templateId ?? '').includes('LockedAmulet')) continue;
    locked.push({ contractId: ev.contractId, templateId: ev.templateId, expiresAt: ev.createArgument?.lock?.expiresAt ?? ev.createArgument?.expiresAt ?? null });
  }
  console.log(`[5] LockedAmulet aktif: ${locked.length} (cid=${locked[0]?.contractId?.slice(0, 18)}… expires=${locked[0]?.expiresAt ?? '?'})`);
  if (!locked.length) throw new Error('LockedAmulet tidak ditemukan');

  // ════ 2. TUNGGU JATUH TEMPO ════
  console.log(`[6] menunggu ${LOCK_SECONDS + 8}s sampai jatuh tempo…`);
  await sleep((LOCK_SECONDS + 8) * 1000);

  // ════ 3. UNLOCK ════
  const or2List = await scanContract('open-and-issuing-mining-rounds');
  const or2 = pickOpenRound(or2List);
  if (!or2) throw new Error('scan-proxy unlock: OpenMiningRound tidak ditemukan');
  console.log('[7] UNLOCK prepare+sign+execute…');
  const unlockExec = await signAndExecute([{
    ExerciseCommand: { templateId: locked[0].templateId, contractId: locked[0].contractId, choice: 'LockedAmulet_OwnerExpireLockV2', choiceArgument: {} },
  }], `spike-unlock-${crypto.randomUUID()}`, [
    { templateId: or2.templateId, contractId: or2.contractId, createdEventBlob: or2.blob },
  ]);
  console.log(`[8] UNLOCK OK — updateId=${unlockExec?.updateId?.slice(0, 22)}…`);

  // Verifikasi akhir
  await sleep(4000);
  const final = await acs();
  let lockedLeft = 0, liquid = 0;
  for (const entry of final) {
    const ev = entry?.contractEntry?.JsActiveContract?.createdEvent ?? entry;
    const tpl = String(ev.templateId ?? '');
    if (tpl.includes('LockedAmulet')) lockedLeft++;
    if (tpl.includes('Splice.Amulet:Amulet')) liquid += parseFloat(ev.createArgument?.amount?.initialAmount ?? '0') || 0;
  }
  console.log(`[9] akhir: LockedAmulet=${lockedLeft}, likuid=${liquid.toFixed(4)} CC`);

  const pass = locked.length === 1 && lockedLeft === 0;
  console.log(pass ? '\nPASS — lock & unlock non-custodial terbukti dengan dana nyata.' : '\nPERIKSA — lihat langkah di atas.');
  process.exit(pass ? 0 : 1);
}

main().catch((e) => {
  console.error('FATAL:', e?.code ?? '', e?.cause ?? e?.message ?? e);
  process.exit(1);
});
