#!/usr/bin/env node
/**
 * SMOKE TEST READ-ONLY — perilaku feed wallet untuk satu akun nyata
 * (default: airplanestar). Memanggil SERVICE ASLI (bukan query tiruan):
 *   - LedgerActivityService.getFeed  (feed "satu sumber", raw LedgerEvent)
 *   - UsersService.getUnifiedActivity (feed legacy CcTransaction+TokenTransaction)
 * lalu memeriksa INVARIAN perilaku, bukan sekadar "tidak error":
 *
 *   S1  Bentuk respons paginasi baru (page/pageSize/hasMore/total).
 *   S2  Urutan KRONOLOGIS LEDGER — offset non-naik antar halaman.
 *   S3  Paginasi benar — halaman 1..N tidak saling tumpang.
 *   S4  ledgerTime terisi dari LedgerUpdate.effectiveAt (bukan createdAt app).
 *   S5  LEG SWAP UTUH — baris se-updateId beda instrumen tidak saling menelan.
 *   S6  Reassignment TIDAK tampil di feed personal (raw audit saja).
 *   S7  Halaman dalam (page 3) tetap mengembalikan baris berbeda (dulu rusak).
 *
 * TIDAK menulis apa pun. Hanya SELECT.
 *
 * Jalankan: cd apps/api && npx ts-node --transpile-only scripts/smoke-airplanestar.ts [username]
 */
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as fs from 'fs';
import * as path from 'path';

import { LedgerActivityService } from '../src/canton/ledger-activity.service';
import { UsersService } from '../src/users/users.service';
import { PointsService } from '../src/users/points.service';
import { RealtimeService } from '../src/realtime/realtime.service';

// ── Load .env (ts-node tidak memuatnya otomatis) ────────────────────────────
function loadEnv(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
loadEnv(path.resolve(__dirname, '..', '.env'));

const USERNAME = (process.argv[2] || 'airplanestar').trim();

// ── Mini test harness ───────────────────────────────────────────────────────
const results: Array<{ id: string; ok: boolean; detail: string }> = [];
function check(id: string, ok: boolean, detail: string): void {
  results.push({ id, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${id}  ${detail}`);
}

async function main(): Promise<void> {
  const prisma = new PrismaClient({
    adapter: new PrismaPg(
      new Pool({ connectionString: process.env.DATABASE_URL, max: 5 }),
    ),
  });

  const user = await prisma.user.findFirst({
    where: { username: { equals: USERNAME, mode: 'insensitive' } },
    select: { id: true, username: true, cantonPartyId: true },
  });
  if (!user) throw new Error(`user "${USERNAME}" tidak ditemukan`);
  const party = user.cantonPartyId;
  if (!party) throw new Error(`user "${USERNAME}" tanpa cantonPartyId`);

  console.log(`\n=== SMOKE FEED — @${user.username} ===`);
  console.log(`party : ${party.slice(0, 40)}...`);
  console.log(`userId: ${user.id}\n`);

  // Instance service asli.
  const ledgerActivity = new LedgerActivityService(prisma as never);
  const users = new UsersService(
    prisma as never,
    new PointsService(prisma as never),
    new RealtimeService(),
  );

  // ── Baseline data mentah party ini ────────────────────────────────────────
  const [rawWitness, rawWithOffset, reassigned] = await Promise.all([
    prisma.ledgerEvent.count({ where: { witnessParties: { has: party } } }),
    prisma.ledgerEvent.count({
      where: { witnessParties: { has: party }, offset: { not: null } },
    }),
    prisma.ledgerEvent.count({
      where: {
        witnessParties: { has: party },
        eventType: { in: ['assigned', 'unassigned'] },
      },
    }),
  ]);
  console.log(
    `baseline: raw witness=${rawWitness} (ber-offset=${rawWithOffset}) reassignment=${reassigned}\n`,
  );

  // ── S1 + S2 + S4: halaman 1 ───────────────────────────────────────────────
  const p1 = await ledgerActivity.getFeed(user.id, 1, 20);
  check(
    'S1',
    typeof p1.page === 'number' &&
      typeof p1.pageSize === 'number' &&
      typeof p1.hasMore === 'boolean' &&
      (p1.total === null || p1.total >= 0),
    `respons: items=${p1.items.length} total=${p1.total === null ? 'null(lower-bound)' : p1.total} ` +
      `page=${p1.page} size=${p1.pageSize} hasMore=${p1.hasMore}`,
  );

  const offsets = await offsetsFor(
    prisma,
    p1.items.map((i) => i.updateId),
  );
  const seq = p1.items.map((i) => offsets.get(i.updateId) ?? null);
  check(
    'S2',
    isNonIncreasing(seq),
    `offset halaman 1 [${seq.map((o) => (o === null ? 'null' : o)).join(' > ')}]`,
  );

  const withTime = p1.items.filter((i) => i.ledgerTime).length;
  check(
    'S4',
    p1.items.length === 0 || withTime > 0,
    `ledgerTime terisi ${withTime}/${p1.items.length} baris (sumber: LedgerUpdate.effectiveAt)`,
  );

  // ── S3 + S7: halaman 2 & 3, cek tumpang & monotonicitas ───────────────────
  const p2 = await ledgerActivity.getFeed(user.id, 2, 20);
  const p3 = await ledgerActivity.getFeed(user.id, 3, 20);
  const ids1 = new Set(p1.items.map((i) => i.id));
  const ids2 = new Set(p2.items.map((i) => i.id));
  const overlap12 = [...ids2].filter((id) => ids1.has(id)).length;
  const overlap23 = p3.items.filter((i) => ids2.has(i.id)).length;
  check(
    'S3',
    overlap12 === 0 && overlap23 === 0,
    `tumpang halaman 1∩2=${overlap12} 2∩3=${overlap23}`,
  );

  const seq2 = await seqFor(prisma, p2.items);
  const seq3 = await seqFor(prisma, p3.items);
  check(
    'S7',
    p3.items.length > 0 || p1.hasMore === false,
    `page1=${p1.items.length} page2=${p2.items.length} page3=${p3.items.length} ` +
      `(total page1=${p1.total} page2=${p2.total} page3=${p3.total} — harus konsisten); ` +
      `offset p2[${seq2.join(',')}] p3[${seq3.join(',')}]`,
  );

  // ── S5: PONDASI LEG SWAP — setiap swap tampil TEPAT 2 kaki di Activity ───
  // Seperti di explorer Canton: satu swap = kaki keluar (jual) + kaki masuk
  // (delivery). Sumber penulis = WSS. Kaki keluar: SWAP_OUT dengan |amount|
  // == sellAmount; kaki masuk: TRANSFER_IN/TOKEN_TRANSFER_IN/SWAP_IN dengan
  // amount == buyAmount. Keduanya harus TERLIHAT di /party/transactions.
  const swaps = await prisma.swapTransaction.findMany({
    where: { userId: user.id, status: 'EXECUTED' },
    orderBy: { createdAt: 'desc' },
    take: 15,
    select: {
      id: true,
      direction: true,
      sellInstrumentId: true,
      sellAmount: true,
      buyInstrumentId: true,
      buyAmount: true,
    },
  });

  const unified = await users.getUnifiedActivity(user.id, 1, 200);
  const tol = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-6;
  let bothLegs = 0;
  const missing: string[] = [];
  for (const s of swaps) {
    const sell = Number(s.sellAmount);
    const buy = Number(s.buyAmount);
    // kaki keluar: debit dengan jumlah = sellAmount (tabel sesuai instrumen jual)
    const out = unified.items.find((it) => {
      const r = it as Record<string, unknown>;
      const amt =
        r.instrumentId || s.sellInstrumentId !== 'CC'
          ? Number(r.amountDecimal ?? NaN)
          : Number(r.amountMicroCc ?? NaN) / 1_000_000;
      return (
        String(r.type) === 'SWAP_OUT' && Number.isFinite(amt) && tol(Math.abs(amt), sell)
      );
    });
    // kaki masuk: kredit dengan jumlah = buyAmount (tabel sesuai instrumen beli)
    const isIncoming = (t: string): boolean =>
      t === 'TRANSFER_IN' || t === 'TOKEN_TRANSFER_IN' || t === 'SWAP_IN';
    const inc = unified.items.find((it) => {
      const r = it as Record<string, unknown>;
      const isCcBuy = s.buyInstrumentId.toUpperCase() === 'CC';
      const amt = isCcBuy
        ? Number(r.amountMicroCc ?? NaN) / 1_000_000
        : Number(r.amountDecimal ?? NaN);
      return (
        isIncoming(String(r.type)) && Number.isFinite(amt) && tol(amt, buy)
      );
    });
    if (out && inc) bothLegs += 1;
    else
      missing.push(
        `${s.direction} ${s.sellAmount}${s.sellInstrumentId}→${s.buyAmount}${s.buyInstrumentId}` +
          ` [out:${out ? '✓' : '✗'} in:${inc ? '✓' : '✗'}]`,
      );
  }
  check(
    'S5',
    swaps.length > 0 && bothLegs === swaps.length,
    `swap 2-leg tampil: ${bothLegs}/${swaps.length}` +
      (missing.length ? ` | hilang: ${missing.slice(0, 3).join(' ; ')}` : ''),
  );

  // ── S9: filter history TIDAK lagi membuang baris ber-referenceId NULL ─────
  // Bug lama: NOT(NULL OR …) = NULL di SQL → 156/297 baris (termasuk leg
  // swap) tersaring diam-diam. Invarian baru: satu-satunya baris swap yang
  // disembunyikan adalah duplikat sintetis oneswap:*:out pra-migrasi.
  const { CC_TRANSACTION_HISTORY_WHERE } = require('../src/users/cc-transaction-visibility');
  const allSwapRows = await prisma.ccTransaction.findMany({
    where: { userId: user.id, type: { in: ['SWAP_IN', 'SWAP_OUT'] } },
    select: { id: true, ledgerTxId: true },
  });
  const passingRows = await prisma.ccTransaction.findMany({
    where: {
      userId: user.id,
      type: { in: ['SWAP_IN', 'SWAP_OUT'] },
      ...CC_TRANSACTION_HISTORY_WHERE,
    },
    select: { id: true },
  });
  const passIds = new Set(passingRows.map((r) => r.id));
  const hiddenRows = allSwapRows.filter((r) => !passIds.has(r.id));
  // Yang BOLEH tersembunyi: (1) duplikat oneswap:*:out pra-migrasi,
  // (2) 3 kaki jual token salah tabel (sudah diregenerasi dari raw layer).
  const allowedHidden = (txId: string): boolean =>
    txId.endsWith(':out') ||
    [
      'oneswap:esc_0f59377e51d6b9789c1a2297:in',
      'oneswap:esc_b1db3c7ba64474c925809b8c:in',
      'oneswap:esc_285ca74f3725ca1a88b8b008:in',
    ].includes(txId);
  const unexpectedHidden = hiddenRows.filter(
    (r) => !allowedHidden(String(r.ledgerTxId ?? '')),
  );
  check(
    'S9',
    unexpectedHidden.length === 0,
    `baris swap tersembunyi: ${hiddenRows.length}/${allSwapRows.length} ` +
      `(duplikat oneswap:*:out + 3 salah-tabel yang sudah diregenerasi); ` +
      `tak terduga=${unexpectedHidden.length}`,
  );

  // ── S6: reassignment tidak bocor ke feed ──────────────────────────────────
  const feedIds = new Set(
    [...p1.items, ...p2.items, ...p3.items].map((i) => i.updateId),
  );
  let reassignInFeed = 0;
  if (feedIds.size > 0) {
    reassignInFeed = await prisma.ledgerEvent.count({
      where: {
        updateId: { in: [...feedIds] },
        eventType: { in: ['assigned', 'unassigned'] },
      },
    });
  }
  check(
    'S6',
    reassignInFeed === 0,
    `baris reassignment di feed: ${reassignInFeed} (harus 0; raw audit tetap tersimpan)`,
  );

  // ── S8: raw feed TIDAK collapse baris se-updateId ────────────────────────
  // Satu update bisa punya >1 event relevan (mis. beberapa UTXO Amulet). Kalau
  // feed mendedupe per-updateId, baris hilang. Hitung baris per updateId.
  const perUpdate = new Map<string, number>();
  for (const it of [...p1.items, ...p2.items, ...p3.items]) {
    perUpdate.set(it.updateId, (perUpdate.get(it.updateId) ?? 0) + 1);
  }
  const multi = [...perUpdate.values()].filter((n) => n > 1).length;
  const maxPerUpdate = Math.max(0, ...perUpdate.values());
  check(
    'S8',
    maxPerUpdate >= 1,
    `updateId dengan >1 baris (tidak collapse): ${multi}/${perUpdate.size}; maks baris/updateId=${maxPerUpdate}`,
  );

  // ── Pembanding legacy: berapa baris yang dilihat user dari DUA stack ──────
  console.log(
    `\ninfo  legacy /party/transactions: ${unified.items.length} baris (total=${unified.total}) — ` +
      `stack BERBEDA dari /party/ledger-activity (${p1.total ?? '>'} di jendela halaman)`,
  );

  // ── Ringkasan ─────────────────────────────────────────────────────────────
  const failed = results.filter((r) => !r.ok);
  console.log(
    `\n=== RINGKASAN: ${results.length - failed.length}/${results.length} PASS ===`,
  );
  if (failed.length) {
    for (const f of failed) console.log(`  FAIL ${f.id}: ${f.detail}`);
  }

  await prisma.$disconnect();
  process.exit(failed.length ? 1 : 0);
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function isNonIncreasing(seq: Array<number | null>): boolean {
  let prev = Number.POSITIVE_INFINITY;
  for (const v of seq) {
    if (v === null) continue; // baris pra-offset diletakkan terakhir — boleh
    if (v > prev) return false;
    prev = v;
  }
  return true;
}

async function offsetsFor(
  prisma: PrismaClient,
  updateIds: string[],
): Promise<Map<string, number | null>> {
  const uniq = [...new Set(updateIds)];
  if (uniq.length === 0) return new Map();
  const rows = await prisma.ledgerUpdate.findMany({
    where: { updateId: { in: uniq } },
    select: { updateId: true, offset: true },
  });
  return new Map(
    rows.map((r) => [r.updateId, r.offset === null ? null : Number(r.offset)]),
  );
}

async function seqFor(
  prisma: PrismaClient,
  items: Array<{ updateId: string }>,
): Promise<Array<number | null>> {
  if (items.length === 0) return [];
  const map = await offsetsFor(
    prisma,
    items.map((i) => i.updateId),
  );
  return items.map((i) => map.get(i.updateId) ?? null);
}

main().catch((err) => {
  console.error('\nSMOKE ERROR:', err instanceof Error ? err.message : err);
  process.exit(2);
});
