#!/usr/bin/env node
/**
 * DEDUPE baris TOKEN_TRANSFER_IN ganda di DB.
 *
 * Penyebab: accept offer token dicatat DUA penulis — signing-relay
 * (recordReceiverAccept, ledgerTxId = updateId) dan WSS handler
 * (applyTokenIncrement, ledgerTxId = updateId:<instrument>) — keduanya lolos
 * unique constraint (userId, ledgerTxId) karena ledgerTxId-nya beda suffix.
 * Feed sudah collapse via cantonUpdateId (user lihat satu baris), tapi DB
 * menyimpan ganda.
 *
 * Kriteria penghapusan (ketat): grup = (userId, cantonUpdateId) sama,
 * type TOKEN_TRANSFER_IN, jumlah baris > 1. Yang dipertahankan: baris dengan
 * description terisi (lebih informatif utk display); sisanya dihapus.
 * id backup dicetak sebelum hapus.
 *
 * Mode: default DRY RUN, --apply menulis.
 * Jalankan: cd apps/api && npx ts-node --transpile-only scripts/dedupe-token-receive.ts [--apply]
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

async function main(): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg(
      new Pool({ connectionString: process.env.DATABASE_URL, max: 5 }),
    ),
  });

  // Grup ganda: (userId, cantonUpdateId) dengan >1 baris TOKEN_TRANSFER_IN.
  const groups = (await prisma.$queryRawUnsafe<
    Array<{ userId: string; cantonUpdateId: string; n: bigint }>
  >(
    `SELECT "userId", "cantonUpdateId", COUNT(*)::bigint AS n
       FROM "TokenTransaction"
      WHERE type = 'TOKEN_TRANSFER_IN' AND "cantonUpdateId" IS NOT NULL
      GROUP BY "userId", "cantonUpdateId"
     HAVING COUNT(*) > 1`,
  )) as Array<{ userId: string; cantonUpdateId: string; n: bigint }>;

  console.log(
    `=== DEDUPE TOKEN_TRANSFER_IN GANDA (${APPLY ? 'APPLY' : 'DRY RUN'}) — ${groups.length} grup ===\n`,
  );

  let removed = 0;
  for (const g of groups) {
    const rows = await prisma.tokenTransaction.findMany({
      where: { userId: g.userId, cantonUpdateId: g.cantonUpdateId },
      orderBy: [{ description: 'desc' }, { createdAt: 'asc' }], // 'Receive' menang di atas ''
    });
    const [keep, ...dupes] = rows;
    console.log(
      `grup user=${g.userId.slice(0, 8)}… upd=${g.cantonUpdateId.slice(0, 18)}… rows=${rows.length}`,
    );
    console.log(
      `  keep: id=${keep.id} desc="${keep.description}" ltx=${String(keep.ledgerTxId).slice(0, 30)}`,
    );
    for (const d of dupes) {
      console.log(
        `  DEL  : id=${d.id} desc="${d.description}" ltx=${String(d.ledgerTxId).slice(0, 30)}`,
      );
      if (!APPLY) continue;
      await prisma.tokenTransaction.delete({ where: { id: d.id } });
      removed += 1;
    }
  }

  console.log(
    APPLY
      ? `\nSELESAI — ${removed} baris duplikat dihapus.`
      : '\nDRY RUN — tambahkan --apply untuk menghapus.',
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('fatal', err);
  process.exit(1);
});
