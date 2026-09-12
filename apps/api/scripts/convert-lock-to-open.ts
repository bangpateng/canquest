#!/usr/bin/env node
/**
 * KONVERSI lock lama → MODE OPEN (2026-09-12).
 *
 * Pilihan durasi 2/5/10 menit DIHAPUS dari fitur lock wallet. Semua lock yang
 * MASIH terkunci dikonversi ke mode open:
 *   termKey    : 'open'
 *   lockSeconds: 0 (sentinel — tier quest menghitung elapsed, bukan durasi)
 *   expiresAt  : lockedAt + 120s  (masa tunggu unlock minimum 2 menit)
 *
 * Aturan ketat (tanpa tebakan):
 *   - HANYA status 'LOCKED' — baris UNLOCKED (history) tidak disentuh.
 *   - HANYA lock tabungan — termKey 'v30-*' (campaign) TIDAK disentuh.
 *   - On-chain: expiredAt lama memang sudah lewat utk mayoritas lock, sehingga
 *     choice unlock (OwnerExpireLockV2) tersedia; dana tetap terkunci sampai
 *     user sendiri yang meng-exercise.
 *
 * Mode: default DRY RUN, --apply menulis.
 * Jalankan: cd apps/api && npx ts-node --transpile-only scripts/convert-lock-to-open.ts [--apply]
 */
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as fs from 'fs';
import * as path from 'path';

function loadEnv(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
loadEnv(path.resolve(__dirname, '..', '.env'));

const APPLY = process.argv.includes('--apply');
/** Masa tunggu unlock minimum (detik) — samakan dgn OPEN_LOCK_SECONDS. */
const OPEN_LOCK_SECONDS = 120;
const OPEN_TERM_KEY = 'open';

async function main(): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg(
      new Pool({ connectionString: process.env.DATABASE_URL, max: 5 }),
    ),
  });

  const targets = await prisma.ccLock.findMany({
    where: {
      status: 'LOCKED',
      termKey: { not: { startsWith: 'v30-' } },
      // Sudah mode open? skip.
      NOT: { termKey: OPEN_TERM_KEY },
    },
    orderBy: { lockedAt: 'asc' },
  });

  console.log(
    `=== KONVERSI LOCK → MODE OPEN (${APPLY ? 'APPLY' : 'DRY RUN'}) — ${targets.length} lock ===\n`,
  );

  let changed = 0;
  for (const l of targets) {
    const newExpires = new Date(l.lockedAt.getTime() + OPEN_LOCK_SECONDS * 1000);
    console.log(
      `  ${l.id} ${l.amountCc} CC term=${l.termKey} (${l.lockSeconds}s) locked=${l.lockedAt.toISOString()}` +
        `\n    → term=open lockSeconds=0 expiresAt=${newExpires.toISOString()}`,
    );
    if (!APPLY) continue;
    await prisma.ccLock.update({
      where: { id: l.id },
      data: {
        termKey: OPEN_TERM_KEY,
        lockSeconds: 0,
        expiresAt: newExpires,
      },
    });
    changed += 1;
  }

  console.log(
    APPLY
      ? `\nSELESAI — ${changed} lock dikonversi ke mode open.`
      : '\nDRY RUN — tambahkan --apply untuk menulis.',
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('fatal', err);
  process.exit(1);
});
