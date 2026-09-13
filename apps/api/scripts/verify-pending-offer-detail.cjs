#!/usr/bin/env node
/**
 * VERIFIKASI read-only — jalankan TransactionDetailService (hasil build `dist/`)
 * terhadap DB + LEDGER NYATA, untuk membuktikan pemisahan "offer pending" dari
 * "TX final".
 *
 * Yang diperiksa:
 *   1. Baris final hasil accept → detail menunjuk update ACCEPT, bukan update
 *      create-offer. Sebelum perbaikan, link explorer baris ini terus membuka
 *      kontrak offer yang terbaca "pending acceptance" selamanya.
 *   2. Baris pending → detail menempelkan info offer dari ledger + peran user.
 *      Jalur inilah yang membuat UI merender detail ledger offer (bukan receipt).
 *   3. Orphan PENDING tanpa CID — baris yang tidak bisa di-flip otomatis oleh
 *      reconciler/lifecycle. Angka > 0 = perlu perhatian terpisah.
 *
 * TIDAK menulis apa pun ke DB maupun ledger. Jalankan dari apps/api:
 *   node scripts/verify-pending-offer-detail.cjs
 */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname + '/..';

for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)) {
  const t = line.trim();
  if (!t || t.startsWith('#')) continue;
  const i = t.indexOf('=');
  if (i < 1) continue;
  const k = t.slice(0, i).trim();
  let v = t.slice(i + 1).trim();
  if (/^".*"$/.test(v)) v = v.slice(1, -1);
  if (!(k in process.env)) process.env[k] = v;
}

const { PrismaClient } = require('@prisma/client');
const { ConfigService } = require('@nestjs/config');
const { TransactionDetailService } = require(path.join(ROOT, 'dist/canton/transaction-detail.service.js'));
const { CantonLedgerService } = require(path.join(ROOT, 'dist/canton/canton-ledger.service.js'));
const { KeycloakTokenService } = require(path.join(ROOT, 'dist/auth/keycloak-token.service.js'));

const prisma = new PrismaClient();
const config = new ConfigService(process.env);
const ledger = new CantonLedgerService(config, new KeycloakTokenService(config));
// Stub: UsersService hanya dipakai resolveTransferCounterparty pada baris
// transfer — cukup diteruskan agar tidak menyeret dependency graph penuh.
const svc = new TransactionDetailService(prisma, ledger, {
  resolveTransferCounterparty: async (ref) => ref ?? null,
}, config);

const pad = (s, n) => String(s).padEnd(n);

async function checkFinalRows() {
  console.log('=== 1. Baris FINAL (accept) harus menunjuk update ACCEPT ===');
  const [cc, tok] = await Promise.all([
    prisma.ccTransaction.findFirst({
      where: { status: 'COMPLETED', transferInstructionCid: { not: null }, cantonUpdateId: { not: null } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.tokenTransaction.findFirst({
      where: { status: 'COMPLETED', transferInstructionCid: { not: null }, cantonUpdateId: { not: null } },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  for (const [label, row, id] of [['cc', cc, cc && `cc-${cc.id}`], ['tok', tok, tok && `tok-${tok.id}`]]) {
    if (!row) { console.log(`  ${label}: (tidak ada baris final ber-cid)`); continue; }
    const d = await svc.getDetailForUser(row.userId, id);
    console.log(`  ${label} ${row.id}`);
    console.log(`    ${pad('status', 16)} ${d.status}`);
    console.log(`    ${pad('offer', 16)} ${d.offer ? 'ADA' : 'null (benar)'}`);
    console.log(`    ${pad('eventId=accept', 16)} ${d.eventId === row.cantonUpdateId ? 'YA (benar)' : 'TIDAK (BUG)'}`);
    console.log(`    ${pad('explorer', 16)} ${d.cantonScanUrl ?? '(none)'}`);
  }
}

async function checkPendingRows() {
  console.log('\n=== 2. Baris PENDING harus menempelkan info offer (live ledger) ===');
  const [ccRows, tokRows] = await Promise.all([
    prisma.ccTransaction.findMany({ where: { status: 'PENDING' }, take: 5 }),
    prisma.tokenTransaction.findMany({ where: { status: 'PENDING' }, take: 5 }),
  ]);
  if (ccRows.length + tokRows.length === 0) {
    console.log('  (tidak ada baris PENDING saat ini — jalur ini teruji unit test)');
  }
  for (const [kind, rows] of [['cc', ccRows], ['tok', tokRows]]) {
    for (const r of rows) {
      const d = await svc.getDetailForUser(r.userId, `${kind}-${r.id}`);
      const live = d.offer ? `ADA (${d.offer.instrumentId} ${d.offer.amount}, ${d.offerRole})` : 'null (offer sudah dikonsumsi → TX biasa)';
      console.log(`  ${kind} ${r.id}: ${live}`);
    }
  }
}

async function summaryOrphans() {
  console.log('\n=== 3. Orphan PENDING (CID null = tidak bisa auto-flip) ===');
  const [ccOrphan, tokOrphan] = await Promise.all([
    prisma.ccTransaction.count({ where: { status: 'PENDING', transferInstructionCid: null } }),
    prisma.tokenTransaction.count({ where: { status: 'PENDING', transferInstructionCid: null } }),
  ]);
  console.log(`  cc: ${ccOrphan}   token: ${tokOrphan}`);
}

async function main() {
  await checkFinalRows();
  await checkPendingRows();
  await summaryOrphans();
}

main()
  .catch((e) => { console.error('GAGAL:', e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
