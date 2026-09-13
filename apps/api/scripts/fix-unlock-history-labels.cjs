#!/usr/bin/env node
/**
 * PERBAIKAN RIWAYAT (idempoten, dry-run default) — baris CC lama yang salah
 * label untuk gerakan UNLOCK dana sendiri.
 *
 * Latar: sebelum WSS tahu label CC_UNLOCK, semua kredit CC ditulis
 * `TRANSFER_IN`/"Receive". Akibatnya unlock milik user tampil sebagai
 * penerimaan (kasus nyata 2026-09-13 07:20 @airplanestar, 5 CC) — bahkan baris
 * lama ber-`ledgerTxId = wss:<updateId>` dengan `referenceId` = party sendiri
 * disembunyikan `isSelfReferenceWssRow()`.
 *
 * Dua jenis tindakan, HANYA bila dibuktikan data ledger (`selfUnlockCredit`
 * dari dist + jumlah kredit persis sama dengan jumlah unlock):
 *   RELABEL : TRANSFER_IN → CC_UNLOCK ("Unlock"), referenceId = CcLock.id,
 *             ledgerTxId dinormalkan ke updateId asli (kalau tidak bentrok).
 *   DELETE  : TRANSFER_IN kembar saat baris CC_UNLOCK untuk fakta yang SAMA
 *             sudah ada (duplikat pre-fix; fakta tetap terwakili CC_UNLOCK).
 *
 * Aturan aman: baris yang tidak lolos bukti ledger TIDAK disentuh sama sekali.
 *
 * Jalankan dari apps/api:
 *   node scripts/fix-unlock-history-labels.cjs            # dry-run
 *   node scripts/fix-unlock-history-labels.cjs --apply    # tulis
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
const {
  selfUnlockCredit,
  transientContractIds,
} = require(path.join(ROOT, 'dist/canton/ledger-event-intent.js'));

const APPLY = process.argv.includes('--apply');
const UNLOCK_CHOICES = ['LockedAmulet_UnlockV2', 'LockedAmulet_OwnerExpireLockV2'];

const prisma = new PrismaClient({
  adapter: new PrismaPg(new Pool({ connectionString: process.env.DATABASE_URL, max: 5 })),
});

(async () => {
  const events = await prisma.ledgerEvent.findMany({
    where: { choice: { in: UNLOCK_CHOICES } },
    select: { updateId: true, witnessParties: true },
  });
  const byUpdate = new Map();
  for (const e of events) {
    if (!byUpdate.has(e.updateId)) byUpdate.set(e.updateId, []);
    byUpdate.get(e.updateId).push(e);
  }
  const users = await prisma.user.findMany({
    where: { cantonPartyId: { not: null } },
    select: { id: true, username: true, cantonPartyId: true },
  });
  const partyToUser = new Map(users.map((u) => [u.cantonPartyId, u]));

  const updates = await prisma.ledgerUpdate.findMany({
    where: { updateId: { in: [...byUpdate.keys()] } },
    select: { updateId: true, envelope: true, effectiveAt: true },
  });
  const envOf = new Map(updates.map((u) => [u.updateId, u]));

  const relabel = [];
  const del = [];

  for (const [updateId, evs] of byUpdate) {
    const up = envOf.get(updateId);
    if (!up) continue;
    const env = normalizeStoredEnvelope(up.envelope);
    const parties = new Set();
    for (const e of evs) for (const p of e.witnessParties ?? []) parties.add(p);
    const ev = {
      offset: 0,
      offsetKnown: true,
      updateId,
      parties: [...parties],
      created: env.created,
      archived: env.archived,
      exercised: env.exercised,
    };
    const transient = transientContractIds(ev);

    for (const party of parties) {
      const user = partyToUser.get(party);
      if (!user) continue;
      let sum = 0;
      for (const c of env.created) {
        if (!String(c.templateId ?? '').includes(':Splice.Amulet:Amulet')) continue;
        if (c.contractId && transient.has(String(c.contractId))) continue;
        const args = c.createArgument ?? {};
        if (args.owner !== party) continue;
        const s =
          args.amount?.initialAmount ??
          args.amount?.amount ??
          (typeof args.amount === 'string' ? args.amount : null);
        if (s) sum += parseFloat(s);
      }
      if (sum <= 0) continue;
      const movement = selfUnlockCredit(ev, party, sum);
      if (!movement) continue;

      const rows = await prisma.ccTransaction.findMany({
        where: {
          userId: user.id,
          OR: [
            { ledgerTxId: updateId },
            { cantonUpdateId: updateId },
            { ledgerTxId: `wss:${updateId}` },
          ],
        },
        select: {
          id: true,
          type: true,
          description: true,
          amountMicroCc: true,
          ledgerTxId: true,
          cantonUpdateId: true,
          referenceId: true,
        },
      });
      if (rows.length === 0) continue;
      const unlockRow = rows.find((r) => r.type === 'CC_UNLOCK');
      const transferRows = rows.filter((r) => r.type === 'TRANSFER_IN');

      // Duplikat: CC_UNLOCK untuk fakta yang sama sudah ada → buang TRANSFER_IN.
      if (unlockRow) {
        for (const r of transferRows) {
          if (Number(r.amountMicroCc) !== Number(unlockRow.amountMicroCc)) {
            console.log(
              `  ! LEWAT ${r.id}: TRANSFER_IN ${Number(r.amountMicroCc) / 1e6} != CC_UNLOCK ${Number(unlockRow.amountMicroCc) / 1e6} (update ${updateId.slice(0, 16)}…)`,
            );
            continue;
          }
          del.push({ row: r, user, updateId });
        }
        continue;
      }

      const lockRow = movement.lockedAmuletCid
        ? await prisma.ccLock
            .findUnique({ where: { lockedAmuletCid: movement.lockedAmuletCid }, select: { id: true } })
            .catch(() => null)
        : null;

      for (const r of transferRows) {
        // Normalisasi identitas hanya kalau TIDAK bentrok dengan baris lain
        // milik user yang sama pada updateId asli yang sama.
        const canonicalTaken = rows.some(
          (o) => o.id !== r.id && o.ledgerTxId === updateId,
        );
        relabel.push({
          row: r,
          user,
          updateId,
          lockedAmuletCid: movement.lockedAmuletCid,
          referenceId: lockRow?.id ?? null,
          normalizeLedgerTxId: !canonicalTaken,
        });
      }
    }
  }

  console.log(
    `RENCANA (${APPLY ? 'APPLY' : 'DRY-RUN'}): relabel ${relabel.length}, delete ${del.length}\n`,
  );
  for (const r of relabel) {
    console.log(
      `  RELABEL ${r.row.type}→CC_UNLOCK @${r.user.username ?? r.user.id.slice(0, 8)} ${Number(r.row.amountMicroCc) / 1e6} ${r.updateId.slice(0, 20)}…` +
        `\n          ref: ${r.row.referenceId} → ${r.referenceId ?? '(tetap)'} | ltx: ${r.row.ledgerTxId}${r.normalizeLedgerTxId ? ' → ' + r.updateId : ' (tetap)'}`,
    );
  }
  for (const d of del) {
    console.log(
      `  DELETE  TRANSFER_IN (duplikat) @${d.user.username ?? d.user.id.slice(0, 8)} ${Number(d.row.amountMicroCc) / 1e6} ltx=${d.row.ledgerTxId} update=${d.updateId.slice(0, 20)}…`,
    );
  }

  if (!APPLY) {
    console.log('\nDRY-RUN — tidak ada yang ditulis. Jalankan dengan --apply.');
    return;
  }

  // Snapshot baris yang akan diubah (untuk rollback) — ditulis SEBELUM mutasi.
  const snapshotPath = process.env.UNLOCK_REPAIR_SNAPSHOT || '/tmp/unlock-repair-before.json';
  fs.writeFileSync(
    snapshotPath,
    JSON.stringify(
      {
        takenAt: new Date().toISOString(),
        relabel: relabel.map((r) => r.row),
        delete: del.map((d) => d.row),
      },
      (key, value) => (typeof value === 'bigint' ? `${value}` : value),
      2,
    ),
  );
  console.log(`\nsnapshot baris lama → ${snapshotPath}`);

  let ok = 0;
  for (const r of relabel) {
    await prisma.ccTransaction.update({
      where: { id: r.row.id },
      data: {
        type: 'CC_UNLOCK',
        description: 'Unlock',
        ...(r.referenceId ? { referenceId: r.referenceId } : {}),
        ...(r.normalizeLedgerTxId ? { ledgerTxId: r.updateId } : {}),
        cantonUpdateId: r.updateId,
      },
    });
    ok++;
  }
  for (const d of del) {
    await prisma.ccTransaction.delete({ where: { id: d.row.id } });
    ok++;
  }
  console.log(`\nSELESAI: ${ok} baris diperbarui.`);
})().finally(() => prisma.$disconnect());
