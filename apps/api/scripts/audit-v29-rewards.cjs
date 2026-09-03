#!/usr/bin/env node
/**
 * AUDIT v29 — cari QuestClaimReceipt rewardSent=true yang transfer reward-nya
 * tidak pernah Completed (bug diam v29: Settle membuang hasil
 * TransferFactory_Transfer dengan `_ <- exercise`, jadi receipt bisa mengklaim
 * reward terkirim padahal menggantung / gagal).
 *
 * Sumber: packages/daml-v30/ROADMAP.md §"Kalau v29 sudah dipakai user di MainNet"
 *         ("Jalankan audit ini lebih dulu dari semua yang di atas.")
 *
 * READ-ONLY. Tidak mensubmit command apa pun ke ledger.
 *
 * Cara kerja (dua lapis):
 *   Lapis 1 (DB + ledger): WinnerDraw.distributed=true → ledgerTxId →
 *     GET /v2/updates/{updateId} → transaction tree → cari exercise node
 *     TransferFactory_Transfer → inspeksi exerciseResult (Completed/Pending/Failed).
 *   Lapis 2 (ACS): active QuestClaimReceipt on-chain (semua paket v28/v29)
 *     → laporkan yang reward diklaim terkirim, cross-check dgn Lapis 1/DB.
 *
 * Usage:
 *   node scripts/audit-v29-rewards.cjs            # lapis 1 + 2
 *   node scripts/audit-v29-rewards.cjs --acs-only # hanya scan ACS
 *
 * Exit code 0 = tidak ditemukan anomali (atau hanya MANUAL_REVIEW),
 *           1 = ditemukan receipt dgn reward TIDAK Completed, 2 = error env.
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 1) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadEnv();

const baseUrl = (
  process.env.LEDGER_API_URL ||
  process.env.CANTON_JSON_API_URL ||
  'http://127.0.0.1:7575'
).replace(/\/$/, '');
const ledgerUser = process.env.LEDGER_API_ADMIN_USER || '';
const readAsParty = process.env.CANTON_VALIDATOR_PARTY_ID || '';
// Paket yang pernah dipakai (template Main:QuestClaimReceipt). Nama dgn '#'.
const auditPackages = (process.env.AUDIT_PACKAGES || '#canquest-v29,#canquest-v28')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

async function getKeycloakToken() {
  const kcUrl = (process.env.KEYCLOAK_URL || '').replace(/\/$/, '');
  const realm = process.env.KEYCLOAK_REALM || 'canton';
  const clientId = process.env.LEDGER_CLIENT_ID;
  const clientSecret = process.env.LEDGER_CLIENT_SECRET;
  if (!kcUrl || !clientId || !clientSecret) {
    throw new Error('KEYCLOAK_URL / LEDGER_CLIENT_ID / LEDGER_CLIENT_SECRET belum diset di apps/api/.env');
  }
  const res = await fetch(`${kcUrl}/realms/${realm}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
      scope: process.env.LEDGER_API_AUTH_SCOPE || 'daml_ledger_api',
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Keycloak token gagal (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return (await res.json()).access_token;
}

/** Klasifikasi hasil exercise TransferFactory_Transfer dari exerciseResult node. */
function classifyTransferResult(exerciseResult) {
  if (exerciseResult == null) return 'NO_RESULT';
  const s = JSON.stringify(exerciseResult);
  if (/"TransferInstructionResult_Completed"|"Completed"/.test(s)) return 'Completed';
  if (/"TransferInstructionResult_Pending"|[{,]?"Pending"/.test(s)) return 'Pending';
  if (/"TransferInstructionResult_Failed"|[{,]?"Failed"/.test(s)) return 'Failed';
  // V1 (v28): hasil = TransferInstructionResult_Output / instrumen offer —
  // anggap 'Offer/Unknown' bila tidak match pola di atas.
  return 'Unknown';
}

/** Walk semua event transaction tree, kumpulkan exercise TransferFactory_Transfer. */
function collectTransferNodes(tree) {
  const events = tree?.eventsById ?? {};
  const found = [];
  for (const [nodeId, ev] of Object.entries(events)) {
    if (
      ev &&
      typeof ev === 'object' &&
      ev.eventType === 'Exercised' &&
      typeof ev.choice === 'string' &&
      ev.choice === 'TransferFactory_Transfer'
    ) {
      found.push({
        nodeId,
        templateId: ev.templateId ?? '?',
        actor: Array.isArray(ev.actingParties) ? ev.actingParties.join(',') : String(ev.actingParties ?? '?'),
        result: classifyTransferResult(ev.exerciseResult),
        raw: JSON.stringify(ev.exerciseResult ?? null).slice(0, 220),
      });
    }
  }
  return found;
}

async function fetchUpdateTree(token, updateId, format = 'transaction-tree') {
  const url = `${baseUrl}/v2/updates/${encodeURIComponent(updateId)}?format=${format}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, status: res.status, text: text.slice(0, 200) };
  try {
    return { ok: true, tree: JSON.parse(text) };
  } catch {
    return { ok: false, status: res.status, text: 'unparseable JSON' };
  }
}

async function auditDbWinnerDraws(token) {
  console.log('\n══ Lapis 1 — WinnerDraw.distributed=true vs transaction tree ══');
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const { rows } = await db.query(
    `SELECT w.id, w."questId", w."userId", u.email, w."ccAmount", w."rewardToken",
            w.distributed, w."ledgerTxId", w."claimFeeLedgerTxId",
            w."claimSessionContractId", w."distributedAt", q."ledgerPackage"
       FROM "WinnerDraw" w
       JOIN "User" u ON u.id = w."userId"
       JOIN "Quest" q ON q.id = w."questId"
      WHERE w.distributed = true
      ORDER BY w."distributedAt" ASC`,
  );
  await db.end();
  console.log(`WinnerDraw distributed=true: ${rows.length} baris`);

  const anomalies = [];
  const manual = [];
  const seenTx = new Map();
  let checked = 0;

  for (const row of rows) {
    const txId = row.ledgerTxId || row.claimFeeLedgerTxId;
    if (!txId) {
      manual.push({ ...row, reason: 'tidak ada ledgerTxId/claimFeeLedgerTxId' });
      continue;
    }
    let tree;
    if (seenTx.has(txId)) tree = seenTx.get(txId);
    else {
      const r = await fetchUpdateTree(token, txId);
      if (!r.ok) {
        manual.push({ ...row, reason: `fetch update ${txId.slice(0, 18)}… HTTP ${r.status}: ${r.text}` });
        continue;
      }
      tree = r.tree;
      seenTx.set(txId, tree);
    }
    checked++;
    const transfers = collectTransferNodes(tree);
    if (transfers.length === 0) {
      // Settle tanpa transfer reward (claim kode, reward=0) — wajar bila rewardToken CC=0
      manual.push({ ...row, reason: 'tidak ada node TransferFactory_Transfer di tree (klaim kode?)' });
      continue;
    }
    // Reward leg = transfer dengan actor/amount terbesar menuju user; sederhananya:
    // klaim reward "terkirim" hanya bila SEMUA transfer Completed ATAU minimal satu
    // transfer non-fee (bukan ke fee party) Completed. Konservatif: tandai bila ada
    // yang Pending/Failed dan ccAmount>0.
    const bad = transfers.filter((t) => t.result === 'Pending' || t.result === 'Failed');
    if (bad.length > 0 && Number(row.ccAmount) > 0) {
      anomalies.push({ ...row, transfers });
    }
  }

  console.log(`Tree diperiksa: ${checked} | anomaly: ${anomalies.length} | manual-review: ${manual.length}`);
  for (const a of anomalies) {
    console.log(`\n🚨 ANOMALY draw=${a.id} user=${a.email} quest=${a.questId} cc=${a.ccAmount} ${a.rewardToken}`);
    for (const t of a.transfers) {
      console.log(`    transfer actor=${t.actor.split('::')[0]} result=${t.result} raw=${t.raw}`);
    }
  }
  if (manual.length > 0 && process.env.AUDIT_VERBOSE === 'true') {
    for (const m of manual) {
      console.log(`⚠️  MANUAL draw=${m.id} user=${m.email}: ${m.reason}`);
    }
  }
  return { anomalies: anomalies.length, manual: manual.length };
}

async function auditAcsReceipts(token) {
  console.log('\n══ Lapis 2 — Active QuestClaimReceipt on-chain (ACS) ══');
  let totalReceipts = 0;
  let rewardSentTrue = 0;
  const flagged = [];
  for (const pkg of auditPackages) {
    const templateId = `${pkg}:Main:QuestClaimReceipt`;
    // Format eventFormat v2 (mirror findLockedAmulets dapp) — TemplateFilter
    // per-party; readAs party utk visibilitas.
    const body = {
      eventFormat: {
        filtersByParty: {
          [readAsParty]: {
            cumulative: [
              { identifierFilter: { TemplateFilter: { value: { templateId } } } },
            ],
          },
        },
        verbose: true,
      },
    };
    const res = await fetch(`${baseUrl}/v2/state/active-contracts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(readAsParty ? body : body),
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    if (!res.ok) {
      console.log(`  ${templateId}: HTTP ${res.status} — ${text.slice(0, 140)}`);
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      console.log(`  ${templateId}: body bukan JSON (stream?) — lewati lapis ini`);
      continue;
    }
    const results = Array.isArray(parsed) ? parsed : (parsed.results ?? []);
    totalReceipts += results.length;
    for (const e of results) {
      const ce = e?.contractEntry?.JsActiveContract?.createdEvent ?? e;
      const p = ce?.createArgument ?? {};
      const rewardSent = p.rewardSent === true;
      if (rewardSent) {
        rewardSentTrue++;
        flagged.push({
          contractId: ce.contractId,
          campaignId: p.campaignId,
          user: typeof p.user === 'string' ? p.user.split('::')[0] : p.user,
          status: p.status,
        });
      }
    }
    console.log(`  ${templateId}: ${results.length} receipt aktif`);
  }
  console.log(`Total receipt aktif: ${totalReceipts}, rewardSent=true: ${rewardSentTrue}`);
  if (flagged.length > 0) {
    console.log('Receipt rewardSent=true (cek manual vs lapis 1 — yang tidak Completed = anomaly):');
    for (const f of flagged) {
      console.log(`  • ${f.contractId} campaign=${f.campaignId} user=${f.user} status=${JSON.stringify(f.status)}`);
    }
  }
  return { totalReceipts, rewardSentTrue };
}

async function main() {
  const acsOnly = process.argv.includes('--acs-only');
  console.log(`Audit v29 silent-reward — LEDGER=${baseUrl} user=${ledgerUser || '(default)'}`);
  console.log(`Paket diaudit: ${auditPackages.join(', ')}`);

  const token = await getKeycloakToken();
  console.log('✓ Token Keycloak OK');

  let anomalyCount = 0;
  if (!acsOnly) {
    if (!process.env.DATABASE_URL) {
      console.error('❌ DATABASE_URL tidak diset — lapis 1 butuh akses DB. Pakai --acs-only bila tanpa DB.');
      process.exit(2);
    }
    const r = await auditDbWinnerDraws(token);
    anomalyCount = r.anomalies;
  }
  await auditAcsReceipts(token);

  console.log('\n══ KESIMPULAN ══');
  if (anomalyCount > 0) {
    console.log(`🚨 ${anomalyCount} receipt mengklaim reward terkirim tapi transfernya Pending/Failed.`);
    console.log('   Tindak lanjut: hubungi user terdampak, kirim manual via offer/preapproval,');
    console.log('   atau konfirmasi user sudah menerima lewat menu offer.');
    process.exit(1);
  }
  console.log('✓ Tidak ditemukan anomaly otomatis. Baris MANUAL (bila ada) perlu pengecekan manual —');
  console.log('  jalankan ulang dgn AUDIT_VERBOSE=true utk detail. Baris manual umumnya klaim kode');
  console.log('  (tanpa transfer reward) — itu bukan bug.');
}

main().catch((e) => {
  console.error('❌ Audit gagal:', e.message);
  process.exit(2);
});
