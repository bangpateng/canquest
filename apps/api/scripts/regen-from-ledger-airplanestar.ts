#!/usr/bin/env node
/**
 * REGENERATE HISTORY DARI LEDGER — @airplanestar_ (wallet-scoped).
 *
 * Perintah: abaikan isi DB, generate ulang dari ledger, rewrite.
 *
 *  1. HAPUS semua CcTransaction + TokenTransaction wallet target.
 *  2. Fakta dari raw layer (hasil persistensi WSS), ekstraksi via fungsi
 *     produksi: getExtractors() + readSwapOutLeg/readLedgerIntent/
 *     transientContractIds.
 *  3. Tulis via penulis produksi (recordTransaction/recordTokenTransaction)
 *     dengan identitas kanonis = updateId ledger asli.
 *
 * Model fakta (ledger-only, 1 baris = 1 pergerakan nyata):
 *   IN  : holding dibuat untuk party, BUKAN change (tanpa OUT instrumen sama
 *         di update yang sama), BUKAN transien.
 *   OUT : transfer sender=party (marker swap), dedup per escrow → 1 kaki jual
 *         per swap.
 *
 * Mode: (default) DRY RUN. --apply menulis.
 */
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as fs from 'fs';
import * as path from 'path';

import { BalanceEventHandlerService } from '../src/canton/balance-event-handler.service';
import {
  readLedgerIntent,
  readSwapOutLeg,
  transientContractIds,
} from '../src/canton/ledger-event-intent';
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

const ALLOWED_PARTY =
  'canquest-user-7fd3df003453::1220a5e003d34981573be4bc35737d6b78176e7117af28e80c90ec339a0262b92260';
const ALLOWED_USERNAME = 'airplanestar';
const APPLY = process.argv.includes('--apply');

interface Fact {
  kind: 'in' | 'out';
  instrument: string;
  admin: string;
  amount: string; // desimal
  updateId: string;
  ledgerTxId: string;
  ts: Date | null;
  counterparty: string | null;
  isSwap: boolean;
  isChange: boolean;
  type: string;
}

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
  const ex = new BalanceEventHandlerService(
    prisma as never,
    new RealtimeService(),
    users,
  ).getExtractors();

  const user = await prisma.user.findFirst({
    where: { cantonPartyId: ALLOWED_PARTY },
    select: { id: true, username: true },
  });
  if (!user || user.username !== ALLOWED_USERNAME) {
    console.error('REFUSED: bukan wallet target.');
    process.exit(1);
  }
  const uid = user.id;
  console.log(`=== REGENERATE FROM LEDGER — @${user.username} ===`);
  console.log(`mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  // ── Fakta dari raw layer ──────────────────────────────────────────────────
  const ids = (
    await prisma.ledgerEvent.findMany({
      where: { witnessParties: { has: ALLOWED_PARTY } },
      select: { updateId: true },
      distinct: ['updateId'],
    })
  ).map((e) => e.updateId);
  const updates = await prisma.ledgerUpdate.findMany({
    where: { updateId: { in: ids } },
    select: { updateId: true, envelope: true, effectiveAt: true },
    orderBy: { effectiveAt: 'asc' },
  });
  console.log(`update ledger (party witness): ${updates.length}`);

  const facts: Fact[] = [];
  const seenOut = new Set<string>();
  const seenIn = new Set<string>();

  for (const up of updates) {
    const env = up.envelope as Record<string, unknown>;
    const ev = {
      offset: 0,
      offsetKnown: true,
      updateId: up.updateId,
      parties: [ALLOWED_PARTY],
      created: (env.created as never) ?? [],
      archived: (env.archived as never) ?? [],
      exercised: (env.exercised as never) ?? [],
    } as unknown as Parameters<typeof readLedgerIntent>[0];
    const transient = transientContractIds(ev);
    const intent = readLedgerIntent(ev);
    const updateIsSwap = facts.length >= 0 && /OneSwap esc_/.test(intent.reasons.join(' '));

    // Instrumen yang keluar di update ini (untuk deteksi change).
    const leg = readSwapOutLeg(ev);
    const outInstrument =
      leg && leg.sender === ALLOWED_PARTY
        ? (leg.instrument ?? 'CC').toUpperCase()
        : null;

    // OUT: satu kaki jual per swap (dedup per escrow).
    if (leg && leg.sender === ALLOWED_PARTY) {
      const isCc = (leg.instrument ?? 'CC').toUpperCase() === 'CC';
      const key = `out|${leg.escrowId ?? `${leg.instrument}|${leg.amount}`}`;
      if (!seenOut.has(key)) {
        seenOut.add(key);
        facts.push({
          kind: 'out',
          instrument: leg.instrument ?? 'CC',
          admin: leg.instrumentAdmin ?? '',
          amount: leg.amount,
          updateId: up.updateId,
          ledgerTxId: isCc
            ? `${up.updateId}:out`
            : `${up.updateId}:out:${(leg.instrument ?? '').toLowerCase()}`,
          ts: up.effectiveAt,
          counterparty: leg.receiver,
          isSwap: true,
          isChange: false,
          type: 'SWAP_OUT',
        });
      }
    }

    // IN: holding dibuat untuk party.
    for (const c of (env.created as Array<Record<string, unknown>>) ?? []) {
      const cid = String(c.contractId ?? '');
      const tpl = String(c.templateId ?? '');
      const args = (c.createArgument ?? {}) as Record<string, unknown>;
      const isAmulet = tpl.includes(':Splice.Amulet:Amulet');
      const isToken = ex.isTokenHoldingTemplate(tpl);
      if (!isAmulet && !isToken) continue;
      if (ex.extractTokenOwnerParty(args) !== ALLOWED_PARTY) continue;
      const amount = ex.extractTokenAmount(args);
      if (!amount || !(Number(amount) > 0)) continue;
      let instrument = 'CC';
      let admin = '';
      if (isToken) {
        const inst = ex.extractTokenInstrument(args);
        if (!inst.instrumentId) continue;
        instrument = inst.instrumentId;
        admin = inst.instrumentAdmin || '';
      }
      // Transien (create+consume di update sama) → bukan fakta.
      if (transient.has(cid)) continue;
      // CHANGE: instrumen sama dengan yang keluar di update ini → kembalian.
      // Pada update SWAP: dibuang (app menampilkan swap = 2 leg). Pada update
      // non-swap (self-transfer): DIPERTAHANKAN sebagai baris "Change".
      const isChange = outInstrument === instrument.toUpperCase();
      if (isChange && updateIsSwap) continue;

      const isCc = instrument.toUpperCase() === 'CC';
      const ledgerTxId = isCc
        ? up.updateId
        : `${up.updateId}:${instrument.toLowerCase()}`;
      const key = `in|${ledgerTxId}`;
      if (seenIn.has(key)) continue;
      seenIn.add(key);
      const sender = intent.sender;
      facts.push({
        kind: 'in',
        instrument,
        admin,
        amount,
        updateId: up.updateId,
        ledgerTxId,
        ts: up.effectiveAt,
        counterparty: sender && sender !== ALLOWED_PARTY ? sender : null,
        isSwap: false,
        isChange,
        type: isCc ? 'TRANSFER_IN' : 'TOKEN_TRANSFER_IN',
      });
    }
  }

  console.log(
    `fakta: ${facts.length} (out=${facts.filter((f) => f.kind === 'out').length}, in=${facts.filter((f) => f.kind === 'in').length})\n`,
  );
  for (const f of facts) {
    console.log(
      `  ${f.ts?.toISOString().slice(5, 16) ?? '?'} ${f.type.padEnd(18)} ${f.kind === 'out' ? '-' : '+'}${f.amount} ${f.instrument} led=${f.ledgerTxId.slice(0, 34)}`,
    );
  }

  if (!APPLY) {
    console.log('\nDRY RUN — tambahkan --apply.');
    await prisma.$disconnect();
    return;
  }

  // ── APPLY: hapus semua baris wallet ini, lalu tulis fakta kanonis ─────────
  console.log('\n── APPLY ──');
  const dCc = await prisma.ccTransaction.deleteMany({ where: { userId: uid } });
  const dTk = await prisma.tokenTransaction.deleteMany({ where: { userId: uid } });
  console.log(`dihapus: CC=${dCc.count} TOKEN=${dTk.count}`);

  let written = 0;
  for (const f of facts) {
    const n = Number(f.amount);
    const signed = f.kind === 'in' ? n : -n;
    // Skema label app (keputusan produk): Swap (hanya kaki keluar),
    // Receive, Change, Send.
    const desc = f.isSwap
      ? 'Swap'
      : f.isChange
        ? 'Change'
        : f.kind === 'in'
          ? 'Receive'
          : 'Send';
    if (f.instrument.toUpperCase() === 'CC') {
      await users.recordTransaction({
        userId: uid,
        amountCc: signed,
        type: f.type as never,
        description: desc,
        referenceId: f.counterparty,
        ledgerTxId: f.ledgerTxId,
        cantonUpdateId: f.updateId,
        status: 'COMPLETED',
        silent: true,
      });
      const r = await prisma.ccTransaction.findFirst({
        where: { userId: uid, ledgerTxId: f.ledgerTxId },
        select: { id: true },
      });
      if (r && f.ts)
        await prisma.ccTransaction.update({
          where: { id: r.id },
          data: { createdAt: f.ts, settledAt: f.ts },
        });
    } else {
      await users.recordTokenTransaction({
        userId: uid,
        instrumentId: f.instrument,
        instrumentAdmin: f.admin,
        amount: f.amount,
        type: f.type as never,
        description: desc,
        referenceId: f.counterparty,
        ledgerTxId: f.ledgerTxId,
        cantonUpdateId: f.updateId,
        status: 'COMPLETED',
        silent: true,
      });
      const r = await prisma.tokenTransaction.findFirst({
        where: { userId: uid, ledgerTxId: f.ledgerTxId },
        select: { id: true },
      });
      if (r && f.ts)
        await prisma.tokenTransaction.update({
          where: { id: r.id },
          data: { createdAt: f.ts },
        });
    }
    written += 1;
  }
  console.log(`ditulis ${written} baris kanonis.`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('\nREGEN ERROR:', err instanceof Error ? err.message : err);
  process.exit(1);
});
