#!/usr/bin/env node
/**
 * REGENERATE kaki-keluar swap token dari RAW LAYER (bukan migrasi baris).
 *
 * Latar: 3 kaki jual TOKEN_TO_CC pra-perbaikan (pra-b518ceb) tertulis di tabel
 * CC dengan denominsi CC ("−1.76 CC" padahal jual USDCx). Kaki benar TIDAK
 * perlu dikarang — envelope WSS-nya tersimpan di raw layer (LedgerUpdate), dan
 * penulis produksi (BalanceEventHandler.writeSwapOutLegs → readSwapOutLeg)
 * membaca persis dari sana.
 *
 * Cara kerja (sama dengan jalur live, hanya sumbernya envelope tersimpan):
 *   1. Cari update yang membawa penanda swap (reason "OneSwap esc_…").
 *   2. readSwapOutLeg → leg OUT (sender/amount/receiver/instrument/admin).
 *   3. Lewati kaki CC (sudah benar lewat baris oneswap:*:in lama) — hanya
 *      kaki TOKEN yang diregenerasi.
 *   4. Tulis lewat penulis produksi. Idempoten: ledgerTxId
 *      `swap:<escrowId>:out:<inst>` + @@unique([userId, ledgerTxId]) — dua
 *      update per swap (instruction + execute) mendedup jadi satu baris.
 *   5. createdAt diset = effectiveAt update ledger (waktu on-chain sesungguhnya).
 *
 * TIDAK menghapus / mengubah baris lama apa pun. Baris salah disembunyikan
 * lewat filter tampilan (cc-transaction-visibility.ts) — data tetap ada.
 *
 * Jalankan: cd apps/api && npx ts-node --transpile-only scripts/replay-swap-out-legs.ts
 */
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as fs from 'fs';
import * as path from 'path';

import { readSwapOutLeg } from '../src/canton/ledger-event-intent';
import { normalizeStoredEnvelope } from '../src/canton/ledger-envelope';
import { BalanceEventHandlerService } from '../src/canton/balance-event-handler.service';
import { UsersService } from '../src/users/users.service';
import { PointsService } from '../src/users/points.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import type { CantonUpdateEvent } from '../src/canton/canton-updates.service';

function loadEnv(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
loadEnv(path.resolve(__dirname, '..', '.env'));

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
  const handler = new BalanceEventHandlerService(
    prisma as never,
    new RealtimeService(),
    users,
  );

  // 1. Kandidat: update yang membawa penanda swap (reason "OneSwap esc_…").
  const rows = await prisma.$queryRawUnsafe<Array<{ uid: string }>>(
    `SELECT "updateId" AS uid FROM "LedgerUpdate"
     WHERE envelope::text LIKE '%OneSwap esc_%'
     ORDER BY "effectiveAt" ASC`,
  );
  console.log(`update ber-penanda swap di raw layer: ${rows.length}`);

  const written: Array<{ escrowId: string; amount: string; instrument: string; updateId: string }> = [];
  const skippedExisting: string[] = [];
  const seenEscrow = new Set<string>();

  for (const r of rows) {
    const full = await prisma.ledgerUpdate.findUnique({
      where: { updateId: r.uid },
      select: { envelope: true, effectiveAt: true },
    });
    if (!full) continue;
    // Normalisasi dua bentuk envelope tersimpan (flat raw-ingest vs. `events[]`
    // backfill) — tanpa ini swap di baris backfill terlihat kosong.
    const rawEnv = full.envelope as Record<string, unknown>;
    const env = normalizeStoredEnvelope(full.envelope);
    const ev: CantonUpdateEvent = {
      offset: 0,
      offsetKnown: true,
      updateId: (rawEnv.updateId as string) ?? r.uid,
      commandId: (rawEnv.commandId as string) ?? null,
      effectiveAt: (rawEnv.effectiveAt as string) ?? null,
      workflowId: (rawEnv.workflowId as string) ?? null,
      parties: [],
      created: env.created as never,
      archived: env.archived as never,
      exercised: env.exercised as never,
    };

    const leg = readSwapOutLeg(ev);
    if (!leg) continue;
    // Hanya kaki TOKEN yang diregenerasi — kaki CC sudah benar sejak lama
    // (baris oneswap:*:in di CcTransaction, tetap tampil).
    if ((leg.instrument ?? 'CC').toUpperCase() === 'CC') continue;

    // Dedup lintas dua update per swap: escrowId sama = swap sama.
    if (leg.escrowId && seenEscrow.has(leg.escrowId)) continue;
    if (leg.escrowId) seenEscrow.add(leg.escrowId);

    const ledgerTxId = `swap:${leg.escrowId ?? ev.updateId}:out:${(leg.instrument ?? '').toLowerCase()}`;
    // Leg sudah ada? Cek DUA identitas: skema baru (swap:<esc>:out:inst) dan
    // marker legacy controller (oneswap:<esc>:in — ditulis pasca-b518ceb,
    // contoh esc_708e). Kalau salah satu ada, kaki sudah tercatat → skip.
    const legacyTxId = leg.escrowId ? `oneswap:${leg.escrowId}:in` : null;
    const existing = await prisma.tokenTransaction.findFirst({
      where: { ledgerTxId: legacyTxId ? { in: [ledgerTxId, legacyTxId] } : ledgerTxId },
      select: { id: true },
    });
    if (existing) {
      skippedExisting.push(legacyTxId ?? ledgerTxId);
      continue;
    }

    const before = await prisma.tokenTransaction.count({
      where: { ledgerTxId },
    });
    await (handler as unknown as { writeSwapOutLegs(ev: CantonUpdateEvent): Promise<void> }).writeSwapOutLegs(ev);
    const after = await prisma.tokenTransaction.count({
      where: { ledgerTxId },
    });

    if (after > before) {
      written.push({
        escrowId: leg.escrowId ?? '-',
        amount: leg.amount,
        instrument: leg.instrument ?? '?',
        updateId: ev.updateId,
      });
      // Waktu history = waktu on-chain (effectiveAt update deposit).
      const created = await prisma.tokenTransaction.findFirst({
        where: { ledgerTxId },
        select: { id: true },
      });
      if (created && full.effectiveAt) {
        await prisma.tokenTransaction.update({
          where: { id: created.id },
          data: { createdAt: full.effectiveAt },
        });
      }
    }
  }

  console.log(`\nbaris SWAP_OUT token DITULIS : ${written.length}`);
  for (const w of written) {
    console.log(`  + ${w.amount} ${w.instrument} (escrow ${w.escrowId}, updateId ${w.updateId.slice(0, 16)}…)`);
  }
  console.log(`sudah ada sebelumnya (skip)   : ${skippedExisting.length}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('\nREGEN ERROR:', err instanceof Error ? err.message : err);
  process.exit(1);
});
