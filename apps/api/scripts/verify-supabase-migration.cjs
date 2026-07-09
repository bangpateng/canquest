/**
 * Verifikasi integritas data setelah migrasi DB lokal → Supabase.
 *
 * Bandingkan count baris + sum agregat di tabel kritis antara dua sumber:
 *  1. Sumber A: read dari DATABASE_URL lokal lama (sebelum cutover).
 *  2. Sumber B: read dari DATABASE_URL Supabase (setelah restore).
 *
 * Karena script ini berjalan di SATU proses, untuk membandingkan dua DB kita
 * pakai env berbeda via dua PrismaClient instance yang connect ke URL berbeda.
 *
 * Cara pakai:
 *   LOCAL_DATABASE_URL="postgresql://...lokal..." \
 *   SUPABASE_DATABASE_URL="postgresql://...supabase..." \
 *   node apps/api/scripts/verify-supabase-migration.cjs
 *
 * Output: tabel perbandingan per metric + PASS/FAIL.
 * Exit code 0 = semua match, 1 = ada mismatch.
 */
const { PrismaClient } = require('@prisma/client');

const LOCAL_URL = process.env.LOCAL_DATABASE_URL;
const SUPA_URL = process.env.SUPABASE_DATABASE_URL;

function fail(msg) {
  console.error(`[FATAL] ${msg}`);
  process.exit(1);
}

if (!LOCAL_URL || !SUPA_URL) {
  fail(
    'Set LOCAL_DATABASE_URL dan SUPABASE_DATABASE_URL di env sebelum menjalankan.',
  );
}

const local = new PrismaClient({
  datasources: { db: { url: LOCAL_URL } },
});
const supa = new PrismaClient({
  datasources: { db: { url: SUPA_URL } },
});

// Metric yang dibandingkan: [label, prismaDelegate, agregasi]
// Count = total baris. Sum = sum kolom numerik tertentu.
const TABLES = [
  'user',
  'ccBalance',
  'ccTransaction',
  'questCompletion',
  'questSubmission',
  'earnEntry',
  'winnerDraw',
  'referralReward',
  'ccLock',
  'inviteCodePool',
  'walletAllocationLog',
];

async function count(db, table) {
  return db[table].count();
}

async function sumEarnPoints(db) {
  const r = await db.user.aggregate({ _sum: { earnPoints: true } });
  return r._sum.earnPoints ?? 0;
}

async function sumCcBalance(db) {
  const r = await db.ccBalance.aggregate({ _sum: { balanceMicroCc: true } });
  // BigInt → Number untuk perbandingan (aman untuk saldo < 2^53).
  return Number(r._sum.balanceMicroCc ?? 0n);
}

async function countLinkedUsers(db) {
  return db.user.count({ where: { authUserId: { not: null } } });
}

async function main() {
  console.log('[verify] membandingkan LOCAL vs SUPABASE ...\n');

  let allMatch = true;
  const rows = [];

  for (const table of TABLES) {
    const [cLocal, cSupa] = await Promise.all([count(local, table), count(supa, table)]);
    const match = cLocal === cSupa;
    if (!match) allMatch = false;
    rows.push({
      table,
      local: cLocal,
      supabase: cSupa,
      diff: cSupa - cLocal,
      status: match ? 'OK' : 'MISMATCH',
    });
  }

  // Agregat numerik.
  const [lpLocal, lpSupa] = await Promise.all([sumEarnPoints(local), sumEarnPoints(supa)]);
  const lpMatch = lpLocal === lpSupa;
  if (!lpMatch) allMatch = false;
  rows.push({
    table: 'User (sum earnPoints)',
    local: lpLocal,
    supabase: lpSupa,
    diff: lpSupa - lpLocal,
    status: lpMatch ? 'OK' : 'MISMATCH',
  });

  const [ccLocal, ccSupa] = await Promise.all([sumCcBalance(local), sumCcBalance(supa)]);
  const ccMatch = ccLocal === ccSupa;
  if (!ccMatch) allMatch = false;
  rows.push({
    table: 'CcBalance (sum microCC)',
    local: ccLocal,
    supabase: ccSupa,
    diff: ccSupa - ccLocal,
    status: ccMatch ? 'OK' : 'MISMATCH',
  });

  // Cek user yang sudah di-link ke auth.users (post-migrasi auth).
  const [linkedLocal, linkedSupa] = await Promise.all([
    countLinkedUsers(local),
    countLinkedUsers(supa),
  ]);
  rows.push({
    table: 'User (authUserId != null)',
    local: linkedLocal,
    supabase: linkedSupa,
    diff: linkedSupa - linkedLocal,
    status: 'INFO', // akan beda: supabase seharusnya punya lebih banyak setelah migrasi auth
  });

  // Cetak tabel.
  const w = {
    table: Math.max(8, ...rows.map((r) => r.table.length)),
    local: 10,
    supabase: 10,
    diff: 8,
    status: 9,
  };
  const fmt = (r) =>
    r.table.padEnd(w.table) +
    String(r.local).padStart(w.local) +
    String(r.supabase).padStart(w.supabase) +
    String(r.diff).padStart(w.diff) +
    r.status.padStart(w.status);

  console.log(
    'TABLE'.padEnd(w.table) +
      'LOCAL'.padStart(w.local) +
      'SUPABASE'.padStart(w.supabase) +
      'DIFF'.padStart(w.diff) +
      'STATUS'.padStart(w.status),
  );
  console.log('-'.repeat(w.table + w.local + w.supabase + w.diff + w.status));
  for (const r of rows) console.log(fmt(r));

  console.log('\n[verify] ' + (allMatch ? 'PASS — semua metric match.' : 'FAIL — ada mismatch (lihat di atas).'));
  process.exitCode = allMatch ? 0 : 1;
}

main()
  .catch((err) => {
    console.error('[verify] ERROR:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await local.$disconnect();
    await supa.$disconnect();
  });
