#!/usr/bin/env node
/**
 * SIMULASI (read-only) — jalankan aturan dedup BARU terhadap RIWAYAT on-chain
 * yang sudah tersimpan di raw layer, untuk menjawab dua pertanyaan:
 *
 *   1. MISS? Apakah ada fakta ledger (holding token masuk milik user) yang
 *      TIDAK punya baris history padahal seharusnya punya?
 *   2. DOBEL? Apakah ada dua baris history untuk fakta yang sama?
 *
 * Yang diperiksa:
 *   a. Setiap baris TOKEN_TRANSFER_IN di DB punya padanan fakta di raw layer
 *      (update + user + instrumen + jumlah sama) → tidak ada baris hantu.
 *   b. Setiap fakta masuk milik user punya baris → tidak ada yang hilang,
 *      kecuali kasus yang MEMANG sengaja dilewati (update hanya membuat offer
 *      tanpa Accept — aturan ACCEPT-1-HISTORY).
 *   c. KUNCI KLAIM yang dihitung kedua penulis sama:
 *        WSS   : hist:tok:<instrumentId dari EVENT>
 *        relay : hist:tok:<instrumentId dari BARIS DB>
 *      Kalau normalisasinya beda, dedup baru tetap bisa bocor.
 *   d. Tidak ada dua fakta BERBEDA yang jatuh ke kunci klaim sama
 *      (itu yang bikin baris legit terbuang / "miss").
 *
 * Klasifikasi memakai function PRODUKSI (`getExtractors()` dari
 * BalanceEventHandlerService hasil build), bukan salinan logika.
 *
 * Jalankan dari apps/api:  node scripts/simulate-receive-dedup.cjs
 * TIDAK menulis apa pun.
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
const {
  BalanceEventHandlerService,
} = require(path.join(ROOT, 'dist/canton/balance-event-handler.service.js'));

const prisma = new PrismaClient();
// Stub dependency — extractor yang dipakai murni (tanpa this.prisma/this.users).
const handler = new BalanceEventHandlerService({}, {}, {});
const {
  isTokenHoldingTemplate,
  extractTokenOwnerParty,
  extractTokenInstrument,
  extractTokenAmount,
} = handler.getExtractors();

const norm = (s) => (typeof s === 'string' ? s.trim().toLowerCase() : '');
const claimKey = (userId, updateId, inst) =>
  `${userId}|${updateId}|hist:tok:${norm(inst)}`;

let fails = 0;
const fail = (msg) => {
  fails++;
  console.log('  ✗ ' + msg);
};

async function main() {
  // ── 1. Peta party → userId ────────────────────────────────────────────
  const users = await prisma.user.findMany({
    select: { id: true, username: true, cantonPartyId: true },
  });
  const userByParty = new Map();
  for (const u of users) {
    if (u.cantonPartyId) userByParty.set(norm(u.cantonPartyId), u);
  }
  console.log(`user dengan party: ${userByParty.size}`);

  // Deteksi era BACKFILL: event yang masuk dalam batch besar (satu detik,
  // ratusan event) berasal dari skrip rekonstruksi, BUKAN dari stream live.
  // Update seperti itu memang tidak pernah ditulis oleh WSS/relay saat itu,
  // jadi ketiadaan barisnya bukan "miss" logika.
  const batchRows = await prisma.$queryRawUnsafe(
    `SELECT "ingestedAt" FROM "LedgerEvent" GROUP BY 1 HAVING COUNT(*) > 50`,
  );
  const backfillSeconds = new Set(
    batchRows.map((r) => new Date(r.ingestedAt).toISOString().slice(0, 19)),
  );
  const ingestOf = new Map(); // updateId → detik ingest
  for (const e of await prisma.ledgerEvent.findMany({
    select: { updateId: true, ingestedAt: true },
  })) {
    if (!ingestOf.has(e.updateId))
      ingestOf.set(e.updateId, new Date(e.ingestedAt).toISOString().slice(0, 19));
  }
  const isBackfillEra = (updateId) => {
    const sec = updateId ? ingestOf.get(updateId) : undefined;
    return !!sec && backfillSeconds.has(sec);
  };
  console.log(`timestamp batch backfill: ${backfillSeconds.size}`);

  // ── 2. Fakta raw: holding token masuk ────────────────────────────────
  const created = await prisma.ledgerEvent.findMany({
    where: { eventType: 'created', templateId: { contains: 'Holding:Holding' } },
    select: { updateId: true, contractId: true, templateId: true, payload: true },
  });
  console.log(`created token holding di raw layer: ${created.length}`);

  const offerUpdates = new Set();
  const acceptUpdates = new Set();
  const flags = await prisma.ledgerEvent.findMany({
    where: {
      OR: [
        { eventType: 'created', templateId: { contains: 'TransferInstruction' } },
        { eventType: 'created', templateId: { contains: 'TransferOffer' } },
        { eventType: 'exercised', choice: 'TransferInstruction_Accept' },
      ],
    },
    select: { updateId: true, eventType: true, templateId: true, choice: true },
  });
  for (const f of flags) {
    if (f.eventType === 'created') offerUpdates.add(f.updateId);
    if (f.choice === 'TransferInstruction_Accept') acceptUpdates.add(f.updateId);
  }

  // Fakta yang seharusnya punya baris history penerima.
  const expected = new Map(); // claimKey → faktanya
  let ownedByUser = 0;
  let skippedOfferOnly = 0;
  let ownedByNonUser = 0;
  let backfillFacts = 0;
  for (const ev of created) {
    if (!isTokenHoldingTemplate(ev.templateId || '')) continue;
    const args = (ev.payload && ev.payload.createArgument) || {};
    const ownerParty = extractTokenOwnerParty(args);
    // extractTokenInstrument mengembalikan { instrumentId, instrumentAdmin }.
    const { instrumentId: inst } = extractTokenInstrument(args);
    const amount = extractTokenAmount(args);
    const user = ownerParty ? userByParty.get(norm(ownerParty)) : undefined;
    if (!user) {
      ownedByNonUser++;
      continue;
    }
    ownedByUser++;
    // ACCEPT-1-HISTORY: update yang hanya MEMBUAT offer (tanpa Accept) sengaja
    // tidak menulis baris penerima.
    if (offerUpdates.has(ev.updateId) && !acceptUpdates.has(ev.updateId)) {
      skippedOfferOnly++;
      continue;
    }
    if (isBackfillEra(ev.updateId)) {
      backfillFacts++;
      continue;
    }
    const key = claimKey(user.id, ev.updateId, inst);
    if (!expected.has(key)) expected.set(key, []);
    expected.get(key).push({ updateId: ev.updateId, inst, amount, userId: user.id });
  }
  console.log(
    `holding milik user: ${ownedByUser} (non-user: ${ownedByNonUser}, offer-only dilewati: ${skippedOfferOnly}, era backfill: ${backfillFacts})`,
  );

  // ── 3. Baris DB: TOKEN_TRANSFER_IN ───────────────────────────────────
  const rows = await prisma.tokenTransaction.findMany({
    where: { type: 'TOKEN_TRANSFER_IN' },
    select: {
      id: true,
      userId: true,
      instrumentId: true,
      instrumentAdmin: true,
      amount: true,
      cantonUpdateId: true,
      ledgerTxId: true,
    },
  });
  console.log(`baris TOKEN_TRANSFER_IN di DB: ${rows.length}`);

  // (a) tiap baris DB punya fakta raw + (c) kunci klaim kedua penulis sama
  let cekBaris = 0;
  let cekTanpaFakta = 0;
  let cekDiLuarRaw = 0;
  let scopeMismatch = 0;
  let cekBarisBackfill = 0;
  for (const r of rows) {
    const updateId = r.cantonUpdateId;
    if (!updateId) continue;
    const candidates = created.filter((e) => e.updateId === updateId);
    if (candidates.length === 0) {
      cekDiLuarRaw++; // update-nya tidak ada di raw layer (coverage) — bukan miss
      continue;
    }
    // Cocokkan fakta lewat PEMILIK + JUMLAH (bukan instrumen) supaya
    // perbandingan instrumen di bawah benar-benar menguji kesamaan kunci klaim
    // yang dihitung relay (dari baris DB) vs WSS (dari event).
    const facts = candidates
      .map((e) => {
        const args = (e.payload && e.payload.createArgument) || {};
        return {
          owner: extractTokenOwnerParty(args),
          inst: extractTokenInstrument(args).instrumentId,
          amount: extractTokenAmount(args),
        };
      })
      .filter(
        (f) =>
          f.owner &&
          userByParty.get(norm(f.owner))?.id === r.userId &&
          f.amount != null &&
          Math.abs(Number(f.amount) - Number(r.amount)) < 1e-9,
      );
    const isBackfillRow =
      String(r.ledgerTxId ?? '').startsWith('backfill-') || isBackfillEra(updateId);
    if (facts.length === 0) {
      if (isBackfillRow) {
        cekBarisBackfill++;
        continue;
      }
      cekTanpaFakta++;
      fail(
        `baris ${r.id} (user ${r.userId.slice(0, 8)}, ${r.instrumentId}) tidak punya fakta raw yang cocok di update ${updateId.slice(0, 16)}…`,
      );
      continue;
    }
    cekBaris++;
    // (c) kedua penulis harus menghitung kunci klaim yang sama. Sisi relay
    // memakai instrumentId dari baris DB; sisi WSS dari event. Bandingkan.
    if (!facts.some((f) => norm(f.inst) === norm(r.instrumentId))) scopeMismatch++;
  }
  console.log(
    `baris cocok fakta: ${cekBaris}, tanpa fakta (live): ${cekTanpaFakta}, era backfill: ${cekBarisBackfill}, di luar raw layer: ${cekDiLuarRaw}, scope mismatch: ${scopeMismatch}`,
  );
  if (scopeMismatch > 0) fail(`ada ${scopeMismatch} baris dengan normalisasi instrumen tidak konsisten`);

  // (d) tidak ada dua fakta BERBEDA pada kunci klaim sama
  for (const [key, list] of expected) {
    const distinct = new Set(list.map((f) => `${norm(f.inst)}|${String(f.amount)}`));
    if (distinct.size > 1) {
      fail(`kunci klaim ${key} dipakai ${distinct.size} fakta berbeda → baris legit bisa terbuang`);
    }
  }

  // (1) MISS: fakta yang seharusnya ada barisnya
  const rowKeys = new Set(
    rows
      .filter((r) => r.cantonUpdateId)
      .map((r) => claimKey(r.userId, r.cantonUpdateId, r.instrumentId)),
  );
  let missing = 0;
  for (const key of expected.keys()) {
    if (!rowKeys.has(key)) {
      missing++;
      const f = expected.get(key)[0];
      if (missing <= 8)
        fail(`MISS: fakta ${f.inst} ${f.amount} user ${f.userId.slice(0, 8)} update ${f.updateId.slice(0, 16)}… tanpa baris`);
    }
  }
  if (missing === 0) console.log('MISS: 0 ✓');
  else console.log(`MISS: ${missing}`);

  // (2) DOBEL: >1 baris untuk fakta sama
  const byKey = new Map();
  for (const r of rows) {
    if (!r.cantonUpdateId) continue;
    const k = claimKey(r.userId, r.cantonUpdateId, r.instrumentId);
    byKey.set(k, (byKey.get(k) ?? 0) + 1);
  }
  const dups = [...byKey.entries()].filter(([, n]) => n > 1);
  if (dups.length) for (const [k, n] of dups) fail(`DOBEL: ${n} baris untuk ${k}`);
  else console.log('DOBEL: 0 ✓');

  console.log(
    `\n${fails === 0 ? '>>> SIMULASI BERSIH — tidak ada miss maupun dobel' : `>>> ${fails} temuan`}`,
  );
  process.exitCode = fails === 0 ? 0 : 1;
}

main()
  .catch((e) => {
    console.error('GAGAL:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
