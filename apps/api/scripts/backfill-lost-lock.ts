#!/usr/bin/env node
/**
 * BACKFILL baris CC_LOCK yang HILANG karena rebutan slot unik
 * (userId, ledgerTxId) dengan baris CHANGE milik pengirim sendiri.
 *
 * Latar (forensik 2026-09-12): bug yang sama seperti Send (lihat
 * backfill-lost-send.ts). Saat user LOCK CC, satu update on-chain juga membuat
 * Amulet change (kembalian) milik pengirim. WSS handler menulis change itu
 * sebagai TRANSFER_IN "Receive" dengan ledgerTxId = updateId — slot yang sama
 * dengan baris CC_LOCK milik signing-relay. Saat change menang balapan, baris
 * CC_LOCK kena P2002 dan hilang permanen dari history (lock-nya sendiri tetap
 * sah di CcLock + on-chain).
 *
 * Terbukti produksi: akun airplanestar — 2 dari 3 lock tidak punya baris
 * CC_LOCK, sedangkan baris "Receive" 0.1 CC muncul di waktu yang sama.
 *
 * Kriteria (semua harus lolos — tanpa tebakan):
 *   1. Ada CcLock milik user (sumber kebenaran lock, ditulis flow lock_cc), dan
 *   2. Tidak ada baris CC_LOCK dengan referenceId = CcLock.id, dan
 *   3. Ada exercise AmuletRules_Transfer/... dengan sender = party user di update
 *      yang memuat created LockedAmulet (lockedAmuletCid cocok), ATAU
 *   4. Slot (userId, updateId) ditempati baris TRANSFER_IN change.
 *
 * Tindakan (--apply):
 *   - Hapus baris change yang menempati slot (bukan history lock).
 *   - Tulis baris CC_LOCK via PENULIS PRODUKSI users.recordTransaction.
 * Saldo TIDAK disentuh — murni perbaikan history.
 *
 * Jalankan: cd apps/api && npx ts-node --transpile-only scripts/backfill-lost-lock.ts [--apply]
 */
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as fs from 'fs';
import * as path from 'path';

import { UsersService } from '../src/users/users.service';
import { PointsService } from '../src/users/points.service';
import { RealtimeService } from '../src/realtime/realtime.service';

function loadEnv(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
loadEnv(path.resolve(__dirname, '..', '.env'));

const APPLY = process.argv.includes('--apply');
const USERNAME = process.argv.find((a) => a.startsWith('--user='))?.slice(7) ?? 'airplanestar';

async function main(): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg(
      new Pool({ connectionString: process.env.DATABASE_URL, max: 5 }),
    ),
  });
  const users = new UsersService(
    prisma as never,
    new PointsService(prisma as never),
    new RealtimeService(),
  );

  const user = await prisma.user.findFirst({
    where: { username: USERNAME },
    select: { id: true, username: true, cantonPartyId: true },
  });
  if (!user) {
    console.error(`User @${USERNAME} tidak ketemu.`);
    process.exit(1);
  }

  console.log(
    `=== BACKFILL LOST CC_LOCK — @${user.username} (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`,
  );

  const locks = await prisma.ccLock.findMany({
    where: { userId: user.id },
    orderBy: { lockedAt: 'asc' },
  });

  let fixed = 0;
  for (const lock of locks) {
    // (2) Baris CC_LOCK sudah ada? → tidak ada yang perlu ditambal.
    const existing = await prisma.ccTransaction.findFirst({
      where: { userId: user.id, type: 'CC_LOCK', referenceId: lock.id },
      select: { id: true },
    });
    if (existing) {
      console.log(`OK   lock ${lock.id} ${lock.amountCc} CC: baris CC_LOCK sudah ada`);
      continue;
    }

    // (3) Cari update lock dari LockedAmulet cid — fakta ledger, bukan tebakan.
    //     created LockedAmulet dengan contractId = lockedAmuletCid menentukan
    //     update mana yang menciptakan lock ini.
    let lockUpdateId: string | null = null;
    if (lock.lockedAmuletCid) {
      const ev = await prisma.ledgerEvent.findFirst({
        where: {
          contractId: lock.lockedAmuletCid,
          eventType: 'created',
          templateId: { contains: 'Splice.Amulet:LockedAmulet' },
        },
        select: { updateId: true },
      });
      lockUpdateId = ev?.updateId ?? null;
    }

    if (!lockUpdateId) {
      console.log(
        `SKIP lock ${lock.id} ${lock.amountCc} CC: update ledger lock tidak ketemu (lockedAmuletCid=${lock.lockedAmuletCid?.slice(0, 16) ?? 'null'})`,
      );
      continue;
    }

    // (4) Slot ditempati siapa?
    const occupier = await prisma.ccTransaction.findFirst({
      where: { userId: user.id, cantonUpdateId: lockUpdateId },
      select: { id: true, type: true, description: true, amountMicroCc: true, createdAt: true },
    });

    console.log(
      `TAMBAL lock ${lock.id} ${lock.amountCc} CC (updateId=${lockUpdateId.slice(0, 18)}...)`,
    );
    console.log(
      `   slot ditempati: ${occupier ? `${occupier.type} ${Number(occupier.amountMicroCc) / 1e6} CC "${occupier.description}"` : '(kosong)'}`,
    );

    if (!APPLY) continue;

    // Waktu event: dari baris yang menempati slot (paling akurat), fallback lockedAt.
    const eventAt = occupier?.createdAt ?? lock.lockedAt;

    if (occupier) {
      console.log(
        `   ~ backup baris yang dihapus: id=${occupier.id} type=${occupier.type} amountMicroCc=${occupier.amountMicroCc} desc="${occupier.description}" created=${occupier.createdAt.toISOString()}`,
      );
      await prisma.ccTransaction.delete({ where: { id: occupier.id } });
      console.log(`   − baris ${occupier.type} "${occupier.description}" dihapus (slot dibebaskan)`);
    }

    const created = await users.recordTransaction({
      userId: user.id,
      amountCc: Number(lock.amountCc),
      type: 'CC_LOCK',
      description: 'Lock',
      referenceId: lock.id,
      ledgerTxId: lockUpdateId,
      cantonUpdateId: lockUpdateId,
      status: 'COMPLETED',
    });
    await prisma.ccTransaction.update({
      where: { id: created.id },
      data: { createdAt: eventAt },
    });
    console.log(`   ✓ baris CC_LOCK ditulis (createdAt=${eventAt.toISOString()}).`);
    fixed += 1;
  }

  console.log(
    APPLY
      ? `\nSELESAI — ${fixed} baris CC_LOCK ditambal.`
      : '\nDRY RUN — tambahkan --apply untuk menulis.',
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('fatal', err);
  process.exit(1);
});
