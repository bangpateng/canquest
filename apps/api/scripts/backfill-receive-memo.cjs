#!/usr/bin/env node
/**
 * BACKFILL (dry-run default) — memo penerima yang hilang pada baris leg-in
 * lama. Sebelum WSS membaca reason on-chain, baris TRANSFER_IN /
 * TOKEN_TRANSFER_IN ditulis dengan description generik ("Receive"/"") padahal
 * memo pengirim TERSEDIA di raw layer (reason update accept).
 *
 * Aturan (semua dari ledger — `readLedgerIntent` + `pickIncomingMemo` dist):
 *   - baris TRANSFER_IN / TOKEN_TRANSFER_IN, description kosong ATAU 'Receive'
 *     (label generik penulis lama);
 *   - cantonUpdateId ada di raw layer;
 *   - pickIncomingMemo(reasons, receiver hint/username) menghasilkan memo.
 * Hanya description yang di-update — amount/ref/type tidak disentuh.
 *
 * Jalankan dari apps/api:
 *   node scripts/backfill-receive-memo.cjs            # dry-run
 *   node scripts/backfill-receive-memo.cjs --apply    # tulis
 */
const fs = require('fs');
const path = require('path');
const ROOT = __dirname + '/..';
const NM = '/var/www/canquest/node_modules';

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

const { PrismaClient } = require(path.join(NM, '@prisma/client'));
const { Pool } = require(path.join(NM, 'pg'));
const { PrismaPg } = require(path.join(NM, '@prisma/adapter-pg'));
const { normalizeStoredEnvelope } = require(path.join(ROOT, 'dist/canton/ledger-envelope.js'));
const { readLedgerIntent, pickIncomingMemo } = require(path.join(ROOT, 'dist/canton/ledger-event-intent.js'));

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL, max: 5 })),
});

(async () => {
  const users = await prisma.user.findMany({
    where: { cantonPartyId: { not: null } },
    select: { id: true, username: true, cantonPartyId: true },
  });
  const userById = new Map(users.map((u) => [u.id, u]));

  const candidates = await prisma.ccTransaction.findMany({
    where: { type: 'TRANSFER_IN', description: { in: ['', 'Receive'] }, cantonUpdateId: { not: null } },
    select: { id: true, userId: true, cantonUpdateId: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });

  console.log(`kandidat CC TRANSFER_IN (desc generik/kosong): ${candidates.length}`);
  const plan = [];
  let skippedNoEnvelope = 0;
  let skippedNoMemo = 0;

  for (const row of candidates) {
    const up = await prisma.ledgerUpdate.findUnique({
      where: { updateId: row.cantonUpdateId },
      select: { envelope: true },
    });
    if (!up) { skippedNoEnvelope++; continue; }
    const env = normalizeStoredEnvelope(up.envelope);
    const user = userById.get(row.userId);
    const intent = readLedgerIntent({
      offset: 0,
      offsetKnown: true,
      updateId: row.cantonUpdateId,
      parties: user ? [user.cantonPartyId] : [],
      created: env.created,
      archived: env.archived,
      exercised: env.exercised,
    });
    const memo = user
      ? pickIncomingMemo({
          reasons: intent.reasons,
          receiverPartyHint: user.cantonPartyId?.split('::')[0] || null,
          receiverUsername: user.username,
        })
      : null;
    if (!memo) { skippedNoMemo++; continue; }
    plan.push({ row, memo });
  }

  // Token — sama, description generik.
  const tokCandidates = await prisma.tokenTransaction.findMany({
    where: { type: 'TOKEN_TRANSFER_IN', description: { in: ['', 'Receive', 'Token received'] }, cantonUpdateId: { not: null } },
    select: { id: true, userId: true, cantonUpdateId: true, createdAt: true },
    orderBy: { createdAt: 'desc' },
  });
  console.log(`kandidat TOKEN_TRANSFER_IN: ${tokCandidates.length}`);
  for (const row of tokCandidates) {
    const up = await prisma.ledgerUpdate.findUnique({
      where: { updateId: row.cantonUpdateId },
      select: { envelope: true },
    });
    if (!up) { skippedNoEnvelope++; continue; }
    const env = normalizeStoredEnvelope(up.envelope);
    const user = userById.get(row.userId);
    const intent = readLedgerIntent({
      offset: 0,
      offsetKnown: true,
      updateId: row.cantonUpdateId,
      parties: user ? [user.cantonPartyId] : [],
      created: env.created,
      archived: env.archived,
      exercised: env.exercised,
    });
    const memo = user
      ? pickIncomingMemo({
          reasons: intent.reasons,
          receiverPartyHint: user.cantonPartyId?.split('::')[0] || null,
          receiverUsername: user.username,
        })
      : null;
    if (!memo) { skippedNoMemo++; continue; }
    plan.push({ row, memo, table: 'token' });
  }

  console.log(`\nRENCANA (${APPLY ? 'APPLY' : 'DRY-RUN'}): ${plan.length} baris dapat memo | skip: envelope hilang=${skippedNoEnvelope}, tanpa memo=${skippedNoMemo}\n`);
  for (const p of plan) {
    console.log(
      `  ${p.row.createdAt.toISOString()} ${(p.table === 'token' ? 'TOKEN_TRANSFER_IN' : 'TRANSFER_IN')} user=${(userById.get(p.row.userId)?.username ?? p.row.userId).slice(0, 14)} → memo=${JSON.stringify(p.memo)}`,
    );
  }

  if (!APPLY) {
    console.log('\nDRY-RUN — tidak ada yang ditulis. Jalankan dengan --apply.');
    return;
  }

  let ok = 0;
  for (const p of plan) {
    if (p.table === 'token') {
      await prisma.tokenTransaction.update({ where: { id: p.row.id }, data: { description: p.memo } });
    } else {
      await prisma.ccTransaction.update({ where: { id: p.row.id }, data: { description: p.memo } });
    }
    ok++;
  }
  console.log(`\nSELESAI: ${ok} baris di-update.`);
})().finally(() => prisma.$disconnect());
