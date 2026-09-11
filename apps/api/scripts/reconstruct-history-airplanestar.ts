#!/usr/bin/env node
/**
 * ONE-SHOT HISTORY RECONSTRUCTION — @airplanestar_ (forensic, single wallet).
 *
 * ATURAN REUSE — komponen produksi yang dipakai langsung:
 *   - Klasifikasi leg/swap/transient : ledger-event-intent (produksi plan A)
 *       readSwapOutLeg, readLedgerIntent, hasSwapMarker, transientContractIds
 *   - Denominasi/instrumen           : interfaceViews Holding (sumber yang
 *       sama dengan readHoldingInterfaceView produksi)
 *   - Penulisan baris history        : UsersService.recordTransaction /
 *       recordTokenTransaction (penulis produksi; konvensi tanda, settledAt)
 *   - Visibilitas Activity           : CC_TRANSACTION_HISTORY_WHERE (produksi)
 *
 * MENGAPA ADAPTER LEG-AGGREGATION DIPERLUKAN (bukan duplikasi):
 *   - BalanceEventHandlerService.processEvent() = pemeta leg produksi, TAPI
 *     tidak bisa di-replay: guard WssBalanceApplied fail-closed membuat
 *     update yang sudah diproses live di-skip total, dan STEP 1 selalu
 *     memutasi saldo (dilarang oleh tugas ini).
 *   - LedgerActivityService.getFeed() = view per-EVENT (terbukti di dry run:
 *     55 fragmen, termasuk pecahan UTXO 0.0010689885 dan arah salah untuk
 *     transfer dua-langkah) — granularitasnya event, bukan leg.
 *   - Tidak ada fungsi produksi yang menghasilkan fakta leg-neto dari
 *     history — itulah sebabnya DB pernah tidak lengkap/berduplikat.
 *   Adapter hanya MENGAGREGASI fakta neto + menerapkan klasifikasi produksi.
 *
 * Mode: (default) DRY RUN — nol mutasi. --apply — repair terbukti.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as fs from 'fs';
import * as path from 'path';

import {
  readLedgerIntent,
  readSwapOutLeg,
  hasSwapMarker,
  transientContractIds,
} from '../src/canton/ledger-event-intent';
import { BalanceEventHandlerService } from '../src/canton/balance-event-handler.service';
import { CC_TRANSACTION_HISTORY_WHERE } from '../src/users/cc-transaction-visibility';
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
const partyArgIdx = process.argv.indexOf('--party');
const partyArg = partyArgIdx >= 0 ? process.argv[partyArgIdx + 1] : undefined;
const TOL = 1e-6;
/** Normalisasi identitas tx era lama (prefix wss: / inbound-sync:) — pola
 *  dedupKey produksi (users.service.ts). */
const normTxId = (v: string | null | undefined): string =>
  (v ?? '')
    .replace(/^(wss:|inbound-sync:[^:]+:)/, '')
    .replace(/^wss:/, '');

const short = (p: string | null | undefined): string =>
  p ? String(p).split('::')[0] : '-';
const WINDOW_MS = 60 * 60_000; // skew nyata fakt vs baris: menit (bukan jam)

if (partyArg && partyArg.trim() !== ALLOWED_PARTY) {
  console.error(`REFUSED: skrip ini HANYA untuk wallet ${ALLOWED_USERNAME}.`);
  process.exit(1);
}

interface Fact {
  kind: 'in' | 'out';
  cid?: string;
  instrument: string;
  amount: number;
  updateId: string;
  ts: Date | null;
  counterparty: string | null;
  isSwap: boolean;
  escrowId?: string | null;
  ledgerTxId: string;
  expectedType: string;
}

const expectedTypeFor = (kind: 'in' | 'out', swap: boolean, cc: boolean): string =>
  kind === 'in'
    ? swap ? 'SWAP_IN' : cc ? 'TRANSFER_IN' : 'TOKEN_TRANSFER_IN'
    : swap ? 'SWAP_OUT' : cc ? 'TRANSFER_OUT' : 'TOKEN_TRANSFER_OUT';

interface Phantom {
  updateId: string;
  instrument: string;
  amount: number;
  ts: Date | null;
}

/** Fakta leg-neto dari SATU envelope — klasifikasi via fungsi produksi. */
function factsFromEnvelope(
  env: Record<string, unknown>,
  updateId: string,
  effectiveAt: Date | null,
  party: string,
  ex: ReturnType<BalanceEventHandlerService['getExtractors']>,
): { facts: Fact[]; phantoms: Phantom[] } {
  const ev = {
    offset: 0,
    offsetKnown: true,
    updateId,
    parties: [party],
    created: (env.created as never) ?? [],
    archived: (env.archived as never) ?? [],
    exercised: (env.exercised as never) ?? [],
  } as unknown as Parameters<typeof readLedgerIntent>[0];

  const transient = transientContractIds(ev);
  const intent = readLedgerIntent(ev);
  const created = (env.created as Array<Record<string, unknown>>) ?? [];
  const facts: Fact[] = [];
  const phantoms: Phantom[] = [];

  // ── fakta IN: Amulet/Holding dibuat untuk party, bukan transien ───────────
  for (const c of created) {
    const cid = String(c.contractId ?? '');
    const tpl = String(c.templateId ?? '');
    const args = (c.createArgument ?? {}) as Record<string, unknown>;

    // Deteksi holding + denominasi + jumlah = EKSTRAKTOR PRODUKSI
    // (isTokenHoldingTemplate / extractTokenOwnerParty / extractTokenInstrument /
    //  extractTokenAmount — sama dengan yang dipakai WSS live).
    const isAmulet = tpl.includes(':Splice.Amulet:Amulet');
    const isTokenHolding = ex.isTokenHoldingTemplate(tpl);
    if (!isAmulet && !isTokenHolding) continue;

    const owner = ex.extractTokenOwnerParty(args);
    if (owner !== party) continue;

    const amount = Number(ex.extractTokenAmount(args));
    if (!Number.isFinite(amount) || amount <= 0) continue;

    let instrument = 'CC';
    let instrumentAdmin: string | null = null;
    if (!isAmulet) {
      const inst = ex.extractTokenInstrument(args);
      if (!inst.instrumentId) continue; // tanpa identitas → skip, bukan ditebak
      instrument = inst.instrumentId;
      instrumentAdmin = inst.instrumentAdmin || null;
    }

    if (transient.has(cid)) {
      // Holding yang dibuat lalu dikonsumsi di update yang sama = net-zero.
      // Fakta ini TIDAK boleh jadi baris history — dicatat sebagai phantom
      // untuk mendeteksi baris lama yang keliru menulisnya.
      phantoms.push({
        updateId,
        instrument,
        amount,
        ts: effectiveAt,
      });
      continue;
    }

    // Klasifikasi factual: holding dibuat = dana MASUK (TRANSFER_IN/
    // TOKEN_TRANSFER_IN). Label SWAP_IN hanya untuk leg delivery — yang
    // sudah ditulis WSS; fragmen change/intermediate tidak boleh
    // diberi label swap (menyesatkan).
    void hasSwapMarker;
    const sender = intent.sender;
    facts.push({
      kind: 'in',
      cid,
      instrument,
      amount,
      updateId,
      ts: effectiveAt,
      counterparty: sender && sender !== party ? sender : null,
      isSwap: false,
      ledgerTxId: isAmulet
        ? updateId
        : `${updateId}:${instrument.toLowerCase()}`,
      expectedType: expectedTypeFor('in', false, isAmulet),
    });
  }

  // ── fakta dari transfer ( exercised dengan transfer args ) ────────────────
  // ARAH = ledger-native: sender == party → OUT; receiver == party → IN.
  // (pola parser resmi V1; menyelesaikan two-step: user men-submit
  //  instruction [sender=party] dan menerima delivery [receiver=party]).
  for (const exv of (ev.exercised as Array<Record<string, unknown>>) ?? []) {
    const tpl = String(exv.templateId ?? '');
    const ca = (exv.choiceArgument ?? {}) as Record<string, unknown>;
    const t = ca.transfer as Record<string, unknown> | undefined;
    if (!t || typeof t !== 'object') continue;
    const sender = typeof t.sender === 'string' ? t.sender : null;
    const receiver = typeof t.receiver === 'string' ? t.receiver : null;
    const amtRaw = typeof t.amount === 'string' ? t.amount : null;
    if (!amtRaw) continue;
    const amount = Number(amtRaw);
    if (!Number.isFinite(amount) || amount <= 0) continue;

    const isAmuletSide =
      tpl.includes('Splice.Amulet') || tpl.includes('AmuletRules');
    let instrument: string;
    let instrumentAdmin: string | null = null;
    if (isAmuletSide) {
      instrument = 'CC';
    } else {
      // instrumentId (CIP-56 InstrumentId {admin,id}) — ekstraktor produksi
      // menangani semua varian shape-nya.
      const instE = ex.extractTokenInstrument(t);
      if (!instE.instrumentId) continue; // tanpa identitas → skip, bukan ditebak
      instrument = instE.instrumentId;
      instrumentAdmin = instE.instrumentAdmin || null;
    }

    const meta =
      t.meta && typeof t.meta === 'object'
        ? ((t.meta as { values?: Record<string, unknown> }).values ?? {})
        : {};
    const reason =
      typeof meta['splice.lfdecentralizedtrust.org/reason'] === 'string'
        ? (meta['splice.lfdecentralizedtrust.org/reason'] as string)
        : null;
    const isSwap = /OneSwap esc_[0-9a-fA-F]+/.test(reason);
    // ARAH KETAT: fakta wallet HANYA bila party adalah peserta transfer.
    // sender == party → OUT; receiver == party → IN; transfer pihak ketiga
    // (fee orang lain, dsb — party cuma witness) → BUKAN fakta wallet ini.
    if (sender !== party && receiver !== party) continue;
    const kind: 'in' | 'out' = sender === party ? 'out' : 'in';
    const isCc = instrument.toUpperCase() === 'CC';
    const counterparty = kind === 'out' ? receiver : sender;

    facts.push({
      kind,
      instrument,
      amount,
      updateId,
      ts: effectiveAt,
      counterparty: counterparty && counterparty !== party ? counterparty : null,
      isSwap,
      escrowId: isSwap ? (/(esc_[0-9a-fA-F]+)/.exec(reason)?.[1] ?? null) : null,
      ledgerTxId: isCc
        ? kind === 'out'
          ? `${updateId}:out`
          : updateId
        : kind === 'out'
          ? `${updateId}:out:${instrument.toLowerCase()}`
          : `${updateId}:${instrument.toLowerCase()}`,
      expectedType: expectedTypeFor(kind, isSwap, isCc),
    });
  }

  return { facts, phantoms };
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
  // Penulis + ekstraktor history PRODUKSI (dipakai juga oleh WSS live)
  const handler = new BalanceEventHandlerService(
    prisma as never,
    new RealtimeService(),
    users,
  );
  const ex = handler.getExtractors();

  const user = await prisma.user.findFirst({
    where: { cantonPartyId: ALLOWED_PARTY },
    select: { id: true, username: true },
  });
  if (!user || user.username !== ALLOWED_USERNAME) {
    console.error('REFUSED: party bukan wallet target.');
    process.exit(1);
  }
  const uid = user.id;
  console.log(`=== RECONSTRUCT HISTORY — @${user.username} (${uid}) ===`);
  console.log(`mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  // ── 1. Fakta on-chain dari raw layer ──────────────────────────────────────
  const evIds = await prisma.ledgerEvent.findMany({
    where: { witnessParties: { has: ALLOWED_PARTY } },
    select: { updateId: true },
    distinct: ['updateId'],
  });
  const updates = await prisma.ledgerUpdate.findMany({
    where: { updateId: { in: evIds.map((e) => e.updateId) } },
    select: { updateId: true, envelope: true, effectiveAt: true },
    orderBy: { effectiveAt: 'asc' },
  });

  const facts: Fact[] = [];
  const phantoms: Phantom[] = [];
  for (const up of updates) {
    const env = up.envelope as Record<string, unknown>;
    const r = factsFromEnvelope(env, up.updateId, up.effectiveAt, ALLOWED_PARTY, ex);
    facts.push(...r.facts);
    phantoms.push(...r.phantoms);
  }
  // Dedupe fakta: gerakan sama bisa muncul 2× dalam satu update
  // (created holding + transfer receiver) → satu fakta.
  const seenFact = new Set<string>();
  const factsUnique: Fact[] = [];
  for (const f of facts) {
    const k = `${f.kind}|${f.updateId}|${f.instrument}|${f.amount}`;
    if (seenFact.has(k)) continue;
    seenFact.add(k);
    factsUnique.push(f);
  }
  facts.length = 0;
  facts.push(...factsUnique);
  // Dedupe OUT: instruction + execute mengumumkan transfer sama → satu fakta,
  // identitas = updateId TERAWAL (saat nilai benar-benar keluar).
  const seenOut = new Map<string, Fact>();
  const factsDeduped: Fact[] = [];
  for (const f of facts) {
    if (f.kind !== 'out') {
      factsDeduped.push(f);
      continue;
    }
    // Kunci dedupe = IDENTITAS SWAP (escrowId dari marker ledger) — BUKAN
    // amount+counterparty: dua swap berbeda bisa menjual jumlah persis sama
    // ke escrow yang sama (kasus nyata: 13 CC dua kali, esc_ab54 vs esc_c6f5).
    const key = `out|${f.instrument}|${f.escrowId ?? `${f.amount}|${f.counterparty ?? ''}`}`;
    const prev = seenOut.get(key);
    if (prev) {
      prev.note = `${prev.note ?? ''} + kontinuasi ${f.updateId.slice(0, 12)}…`.trim();
      continue;
    }
    seenOut.set(key, f);
    factsDeduped.push(f);
  }
  console.log(
    `fakta on-chain: ${factsDeduped.length} (in=${factsDeduped.filter((f) => f.kind === 'in').length}, out=${factsDeduped.filter((f) => f.kind === 'out').length}) | phantom candidate: ${phantoms.length}\n`,
  );

  console.log('\n── FAKTA (urut waktu) ──');
  for (const f of factsDeduped) {
    console.log(
      `  ${f.ts?.toISOString().slice(0, 16) ?? '?'} ${f.kind.toUpperCase().padEnd(3)} ${f.amount} ${f.instrument} swap=${f.isSwap ? 'Y' : 'n'} updateId=${f.updateId.slice(0, 14)}… cp=${short(f.counterparty)}`,
    );
  }

  // ── 2. Baris DB wallet ini ────────────────────────────────────────────────
  const ccRows = await prisma.ccTransaction.findMany({ where: { userId: uid } });
  const tkRows = await prisma.tokenTransaction.findMany({ where: { userId: uid } });
  const visibleCc = new Set(
    (
      await prisma.ccTransaction.findMany({
        where: { userId: uid, ...CC_TRANSACTION_HISTORY_WHERE },
        select: { id: true },
      })
    ).map((r) => r.id),
  );
  interface Row {
    table: 'cc' | 'token';
    id: string;
    ledgerTxId: string | null;
    cantonUpdateId: string | null;
    type: string;
    amount: number;
    instrument: string;
    createdAt: Date;
    description: string;
    visible: boolean;
  }
  const rows: Row[] = [
    ...ccRows.map((r) => ({
      table: 'cc' as const,
      id: r.id,
      ledgerTxId: r.ledgerTxId,
      cantonUpdateId: r.cantonUpdateId,
      type: r.type,
      amount: Number(r.amountMicroCc) / 1_000_000,
      instrument: 'CC',
      createdAt: r.createdAt,
      description: r.description,
      visible: visibleCc.has(r.id),
    })),
    ...tkRows.map((r) => ({
      table: 'token' as const,
      id: r.id,
      ledgerTxId: r.ledgerTxId,
      cantonUpdateId: r.cantonUpdateId,
      type: r.type,
      amount: Number(r.amount),
      instrument: r.instrumentId,
      createdAt: r.createdAt,
      description: r.description ?? '',
      visible: true,
    })),
  ];
  console.log(`DB rows: CcTransaction=${ccRows.length} (tampil ${visibleCc.size}) + TokenTransaction=${tkRows.length} = ${rows.length}\n`);

  // ── 3. Pencocokan fakta → baris ───────────────────────────────────────────
  const unmatched = new Set(rows.map((r) => r.id));
  const rowByFact = new Map<Fact, Row>();
  const duplicates: Array<{ fact: Fact; row: Row; why: string }> = [];
  const classDiffs: Array<{ fact: Fact; row: Row }> = [];

  const matchPool = (f: Fact): Row[] =>
    rows.filter(
      (r) =>
        unmatched.has(r.id) &&
        r.instrument.toUpperCase() === f.instrument.toUpperCase() &&
        Math.sign(r.amount) === (f.kind === 'in' ? 1 : -1) &&
        Math.abs(Math.abs(r.amount) - f.amount) <= TOL &&
        f.ts !== null &&
        Math.abs(r.createdAt.getTime() - f.ts.getTime()) <= WINDOW_MS,
    );
  // Urutan preferensi: exact cantonUpdateId → escrow terpinah (referenceId)
  // → terbaru. Pinning escrow penting: dua swap berbeda bisa menjual jumlah
  // persis sama di hari yang sama (kasus nyata: 13 CC dua kali).

  for (const f of factsDeduped) {
    // ATURAN 1 (terkuat): identitas kanonis — baris yang ledgerTxId-nya
    // persis kunci fakta. Baris era lama bisa punya ledgerTxId = updateId
    // asli tanpa cantonUpdateId → tetap terhitung cover.
    // Normalisasi prefix era lama (`wss:` / `inbound-sync:<x>:`) — pola yang
    // sama dengan dedupKey produksi (users.service.ts).

    const byIdentity = rows.find(
      (r) =>
        unmatched.has(r.id) &&
        (r.ledgerTxId === f.ledgerTxId ||
          normTxId(r.ledgerTxId) === normTxId(f.ledgerTxId)),
    );
    if (byIdentity) {
      unmatched.delete(byIdentity.id);
      rowByFact.set(f, byIdentity);
      if (byIdentity.type !== f.expectedType)
        classDiffs.push({ fact: f, row: byIdentity });
      continue;
    }
    const pool = matchPool(f);
    if (pool.length === 0) continue;
    const exact = pool.find((r) => r.cantonUpdateId === f.updateId);
    const escrowPinned =
      !exact && f.counterparty
        ? pool.find(
            (r) => r.referenceId === f.counterparty || r.referenceId === f.counterparty.split('::')[0],
          )
        : undefined;
    const chosen =
      exact ?? escrowPinned ?? pool.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    unmatched.delete(chosen.id);
    rowByFact.set(f, chosen);
    if (chosen.type !== f.expectedType) classDiffs.push({ fact: f, row: chosen });
    for (const dup of pool.filter((r) => r.id !== chosen.id)) {
      duplicates.push({
        fact: f,
        row: dup,
        why:
          dup.createdAt.getTime() < f.ts!.getTime() - 60_000
            ? 'baris era offer (premature — dana belum masuk saat itu)'
            : 'duplikat delivery (penulis ganda era lama)',
      });
    }
  }
  const missing = factsDeduped.filter((f) => !rowByFact.has(f));

  // Baris tersisa: phantom (bukti transient) atau unexplained
  const isPhantomRow = (r: Row): boolean =>
    // Phantom = KREDIT palsu (holding transien di-credit penulis lama).
    // Baris debit (kaki jual) tidak mungkin phantom.
    r.amount > 0 &&
    phantoms.some(
      (pc) =>
        pc.instrument === r.instrument &&
        Math.abs(pc.amount - Math.abs(r.amount)) <= TOL &&
        pc.ts !== null &&
        Math.abs(pc.ts.getTime() - r.createdAt.getTime()) <= WINDOW_MS,
    );
  const phantomRows: Row[] = [];
  const unexplained: Row[] = [];
  for (const id of unmatched) {
    const r = rows.find((x) => x.id === id)!;
    if (isPhantomRow(r)) phantomRows.push(r);
    else unexplained.push(r);
  }

  // ── 4. LAPORAN ────────────────────────────────────────────────────────────
  console.log('──────────────── REKONSILIASI ────────────────');
  console.log(`ONCHAIN FACTS                : ${factsDeduped.length}`);
  console.log(`DB ROWS                      : ${rows.length}`);
  console.log(`MISSING                      : ${missing.length}`);
  console.log(`PHANTOM (net-zero, bukti transient) : ${phantomRows.length}`);
  console.log(`DUPLICATE (penulis ganda)    : ${duplicates.length}`);
  console.log(`UNEXPLAINED                  : ${unexplained.length}`);
  console.log(`CLASSIFICATION DIFFERENCES   : ${classDiffs.length}\n`);

  for (const f of missing) {
    console.log(
      `MISSING ${f.ts?.toISOString().slice(0, 16) ?? '?'} ${f.kind} ${f.amount} ${f.instrument} updateId=${f.updateId.slice(0, 16)}… expected=${f.expectedType}`,
    );
  }
  for (const p of phantomRows) {
    console.log(
      `PHANTOM ${p.createdAt.toISOString().slice(0, 16)} ${p.table}/${p.type} ${p.amount} ${p.instrument} led=${String(p.ledgerTxId ?? '').slice(0, 28)} — holding transien (net-zero)`,
    );
  }
  for (const d of duplicates) {
    console.log(
      `DUP     ${d.row.createdAt.toISOString().slice(0, 16)} ${d.row.table}/${d.row.type} ${d.row.amount} ${d.row.instrument} led=${String(d.row.ledgerTxId ?? '').slice(0, 26)} — ${d.why} (fakta ${d.fact.updateId.slice(0, 12)}…)`,
    );
  }
  for (const u of unexplained) {
    console.log(
      `UNEXPL  ${u.createdAt.toISOString().slice(0, 16)} ${u.table}/${u.type} ${u.amount} ${u.instrument} led=${String(u.ledgerTxId ?? '').slice(0, 26)} — perlu tinjauan manual`,
    );
  }
  for (const d of classDiffs) {
    console.log(
      `CLASSDIFF ${d.row.type} (DB) vs ${d.fact.expectedType} (ledger) — ${d.row.amount} ${d.row.instrument} — label bisnis app lebih spesifik; tidak diubah`,
    );
  }

  // ── 5. APPLY ──────────────────────────────────────────────────────────────
  let inserted = 0;
  let removed = 0;
  let skippedIntermediate = 0;
  if (APPLY) {
    console.log('\n──────────────── APPLY ────────────────');
    for (const f of missing) {
      const isCc = f.instrument.toUpperCase() === 'CC';
      // Gate eksistensi ternormalisasi: baris legacy dengan updateId sama
      // (meski ledgerTxId-nya berprefix wss:/jumlah agregasi lama) sudah
      // merepresentasikan update ini → memaksa insert = near-duplikat.
      const fKey = normTxId(f.ledgerTxId);
      const conflict = isCc
        ? await prisma.ccTransaction.findFirst({
            where: { userId: uid, ledgerTxId: { not: null } },
          })
        : null;
      void conflict;
      const ccClash = isCc
        ? (
            await prisma.ccTransaction.findMany({
              where: { userId: uid },
              select: { id: true, ledgerTxId: true },
            })
          ).some((r) => normTxId(r.ledgerTxId) === fKey)
        : (
            await prisma.tokenTransaction.findMany({
              where: { userId: uid },
              select: { id: true, ledgerTxId: true },
            })
          ).some((r) => normTxId(r.ledgerTxId) === fKey);
      if (ccClash) {
        skippedIntermediate += 1;
        console.log(
          `  ~ dilewati: baris legacy dengan updateId sama sudah ada (${f.ledgerTxId.slice(0, 20)}…) — insert akan near-duplikat`,
        );
        continue;
      }
      // Gate intermediate: bila holding ini dikonsumsi di update LAIN
      // (bukan tempat ia dibuat), ia adalah UTXO perantara swap/instruction
      // — net-zero antar-update, bukan dana masuk. Jangan insert.
      if (f.kind === 'in' && f.cid) {
        const consumed = await prisma.ledgerEvent.count({
          where: {
            contractId: f.cid,
            updateId: { not: f.updateId },
            OR: [{ eventType: 'archived' }, { choice: 'Archive' }],
          },
        });
        if (consumed > 0) {
          skippedIntermediate += 1;
          console.log(
            `  ~ intermediate UTXO dilewati: ${f.amount} ${f.instrument} (updateId=${f.updateId.slice(0, 14)}…) — dikonsumsi di update lain (net-zero)`,
          );
          continue;
        }
      }
      const signed = f.kind === 'in' ? f.amount : -f.amount;
      const desc = f.isSwap
        ? `${f.kind === 'in' ? 'Swap received' : 'Swap sent'} ${f.amount} ${f.instrument} (OneSwap)`
        : `${f.kind === 'in' ? 'Received' : 'Sent'} ${f.amount} ${f.instrument} (on-chain)`;
      if (isCc) {
        await users.recordTransaction({
          userId: uid,
          amountCc: signed,
          type: f.expectedType as never,
          description: desc,
          referenceId: f.counterparty,
          ledgerTxId: f.ledgerTxId,
          cantonUpdateId: f.updateId,
          status: 'COMPLETED',
          silent: true,
        });
      } else {
        await users.recordTokenTransaction({
          userId: uid,
          instrumentId: f.instrument,
          instrumentAdmin: '',
          amount: signed,
          type: f.expectedType as never,
          description: desc,
          referenceId: f.counterparty,
          ledgerTxId: f.ledgerTxId,
          cantonUpdateId: f.updateId,
          status: 'COMPLETED',
          silent: true,
        });
      }
      inserted += 1;
      console.log(`  + ${f.expectedType} ${signed} ${f.instrument} led=${f.ledgerTxId.slice(0, 36)}`);
    }
    for (const p of phantomRows.filter((x) => x.visible)) {
      if (p.table === 'cc') {
        await prisma.ccTransaction.delete({ where: { id: p.id } });
      } else {
        await prisma.tokenTransaction.delete({ where: { id: p.id } });
      }
      removed += 1;
      console.log(`  − phantom dihapus: ${p.type} ${p.amount} ${p.instrument} led=${String(p.ledgerTxId ?? '').slice(0, 26)}`);
    }
    // Baris hasil rekonstruksi sebelumnya yang TIDAK match fakta manapun =
    // salah arah (mis. fee pihak ketiga yang di-insert sebagai "Received")
    // → dihapus. Hanya baris ber-desc "(on-chain)" milik wallet ini.
    for (const r of rows) {
      if (!/\(on-chain\)$/.test(r.description)) continue;
      const hasFact = factsDeduped.some(
        (f) =>
          f.instrument.toUpperCase() === r.instrument.toUpperCase() &&
          Math.sign(f.amount) === Math.sign(r.amount) &&
          Math.abs(Math.abs(f.amount) - Math.abs(r.amount)) <= TOL &&
          f.ts !== null &&
          Math.abs(r.createdAt.getTime() - f.ts.getTime()) <= WINDOW_MS,
      );
      if (hasFact) continue;
      if (r.table === 'cc') {
        await prisma.ccTransaction.delete({ where: { id: r.id } });
      } else {
        await prisma.tokenTransaction.delete({ where: { id: r.id } });
      }
      removed += 1;
      console.log(`  − salah-arah dihapus: ${r.type} ${r.amount} ${r.instrument} "${r.description.slice(0, 40)}" led=${String(r.ledgerTxId ?? '').slice(0, 20)}…`);
    }
    for (const d of duplicates.filter((x) => x.row.visible)) {
      if (d.row.table === 'cc') {
        await prisma.ccTransaction.delete({ where: { id: d.row.id } });
      } else {
        await prisma.tokenTransaction.delete({ where: { id: d.row.id } });
      }
      removed += 1;
      console.log(`  − duplikat dihapus: ${d.row.type} ${d.row.amount} ${d.row.instrument} led=${String(d.row.ledgerTxId ?? '').slice(0, 26)} (${d.why})`);
    }
    console.log(`\ninserted=${inserted} removed=${removed} (phantom ${phantomRows.length} + duplikat ${duplicates.length}) skipped-intermediate=${skippedIntermediate}`);
  } else {
    console.log('\nDRY RUN — tidak ada mutasi. Tambahkan --apply untuk menulis.');
  }

  // ── 6. Re-run setelah apply ───────────────────────────────────────────────
  if (APPLY) {
    const ccAfter = await prisma.ccTransaction.findMany({ where: { userId: uid } });
    const tkAfter = await prisma.tokenTransaction.findMany({ where: { userId: uid } });
    console.log('\n──────────────── AFTER APPLY ────────────────');
    console.log(`ONCHAIN FACTS              : ${factsDeduped.length}`);
    console.log(`DB BEFORE                  : ${rows.length}`);
    console.log(`MISSING BEFORE             : ${missing.length}`);
    console.log(`REPAIRED (inserted)        : ${inserted}`);
    console.log(`SKIPPED (intermediate UTXO): ${skippedIntermediate}`);
    console.log(`REPAIRED (removed phantom+dup) : ${removed}`);
    console.log(`DB AFTER                   : ${ccAfter.length + tkAfter.length}`);
    console.log(
      `REMAINING UNEXPLAINED      : ${unexplained.length} — baris legacy yang tidak bisa direkonstruksi aman (lihat daftar UNEXPL di atas)`,
    );
    console.log(
      `REMAINING CLASS DIFF       : ${classDiffs.length} — label bisnis app lebih spesifik, dipertahankan`,
    );

    const unified = await users.getUnifiedActivity(uid, 1, 200);
    console.log(`\nActivity UI (getUnifiedActivity): ${unified.items.length} baris tampil`);
  }

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('\nRECONSTRUCT ERROR:', err instanceof Error ? err.message : err);
  process.exit(1);
});
