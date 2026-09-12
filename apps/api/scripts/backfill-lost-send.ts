#!/usr/bin/env node
/**
 * BACKFILL baris Send (TRANSFER_OUT) yang HILANG karena rebutan slot unik
 * (userId, ledgerTxId) dengan baris CHANGE milik pengirim sendiri.
 *
 * Latar (forensik 2026-09-12): pada satu update transfer, WSS handler menulis
 * baris change (kembalian ke pengirim) dengan ledgerTxId = updateId — slot yang
 * sama dengan baris Send yang ditulis signing-relay. Saat handler menang balapan,
 * baris Send kena P2002 dan hilang permanen, walau transfer on-chain sukses.
 * Terbukti dari log "AUDIT-TRAIL LOSS: relay send_cc SUCCEEDED on-chain".
 *
 * Script ini HANYA menyentuh updateId yang terverifikasi:
 *   1. Ada exercise TransferFactory_Transfer/AmuletRules_Transfer di ledger
 *      dengan sender = party user (fakta transfer KE LUAR), dan
 *   2. Baris TRANSFER_OUT-nya TIDAK ada di DB, dan
 *   3. Slot (userId, updateId) ditempati baris change (bukan penerimaan nyata).
 *
 * Tindakan (saat --apply):
 *   - Hapus baris change yang menempati slot (change bukan history transfer).
 *   - Tulis baris Send via PENULIS PRODUKSI users.recordTransaction.
 * Saldo (CcBalance) TIDAK disentuh — script ini murni memperbaiki history.
 *
 * Jalankan: cd apps/api && npx ts-node --transpile-only scripts/backfill-lost-send.ts [--apply]
 */
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import * as fs from 'fs';
import * as path from 'path';

import { UsersService } from '../src/users/users.service';
import { PointsService } from '../src/users/points.service';
import { RealtimeService } from '../src/realtime/realtime.service';
import { normalizeCantonPartyId } from '../src/common/canton-party-id';

function loadEnv(file: string): void {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}
loadEnv(path.resolve(__dirname, '..', '.env'));

const APPLY = process.argv.includes('--apply');

/** Party fee/validator CanQuest — kaki ini bukan Send yang dicari. */
function this_isFeeParty(party: string | null | undefined): boolean {
  if (!party) return false;
  const short = party.split('::')[0]?.toLowerCase() ?? '';
  const labels = [
    process.env.CANTON_FEE_RECIPIENT_PARTY_ID,
    process.env.CANTON_FEE_PARTY_ID,
    process.env.CANTON_VALIDATOR_PARTY_ID,
  ]
    .map((v) => v?.split('::')[0]?.toLowerCase())
    .filter((v): v is string => !!v);
  return labels.includes(short) || short.includes('canquest-fee');
}

/** updateId Send yang hilang — terverifikasi dari log AUDIT-TRAIL LOSS. */
const LOST_UPDATE_IDS = [
  '122073bcfa36980973fea83719f11ec91f1166d9f92110c736b5c73d887ba3b21398',
  '1220821791257ce279efe14c3ceb69e9edd43e41f35cea0439d109c86a4a9b6c130b',
  '1220a16ef0ed674281ef6fbc8bd5374fc6bcfdde41600988a589d0dde802cdf6d5c3',
  '1220a1809a98e8e88edcac4b63adca4f54d0a886eefc63cdca9c1c137116760248fc',
  '1220f4d2eae96137080d774bbc811de7274561a217a92b7bd8db7a285b9a287634aa',
  '1220fac380f09aca49f4e6a8463a2e4a7edcf9c0063c28de1e3f43a45706cee275e5',
  '12201069afa60c37e6dcdac1cd2dfe405352baa4080722c4dca5034e8c1def00d405',
];

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

  console.log(`=== BACKFILL LOST SEND (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);

  for (const updateId of LOST_UPDATE_IDS) {
    // Fakta ledger: exercise transfer dengan sender party user CanQuest.
    // Urutkan per eventIndex — leg UTAMA (transfer ke penerima) muncul sebelum
    // leg fee. Kaki fee dibuang: itu bukan Send yang hilang, dan slot-nya
    // memang sengaja tanpa ledgerTxId.
    const exRows = await prisma.ledgerEvent.findMany({
      where: {
        updateId,
        choice: { in: ['TransferFactory_Transfer', 'AmuletRules_Transfer'] },
      },
      select: { payload: true, eventIndex: true },
      orderBy: { eventIndex: 'asc' },
    });
    const legs = exRows
      .map((r) => {
        const t = (r.payload as Record<string, unknown>)?.choiceArgument as
          | {
              transfer?: {
                sender?: string;
                receiver?: string;
                amount?: string;
              };
            }
          | undefined;
        return t?.transfer;
      })
      .filter(
        (t): t is { sender: string; receiver: string; amount: string } =>
          !!t?.sender && !!t?.receiver && !!t?.amount,
      )
      .filter((t) => !this_isFeeParty(t.receiver));

    // Cari leg yang SEND-nya benar-benar hilang: sender harus user CanQuest,
    // dan belum ada baris TRANSFER_OUT non-fee untuk update ini.
    let handled = false;
    for (const leg of legs) {
      const sender = await prisma.user.findFirst({
        where: { cantonPartyId: leg.sender },
        select: { id: true, username: true },
      });
      if (!sender) continue; // sender bukan user dapp (mis. external)

      const existingSend = await prisma.ccTransaction.findFirst({
        where: {
          userId: sender.id,
          cantonUpdateId: updateId,
          type: 'TRANSFER_OUT',
          NOT: { referenceId: { startsWith: 'fee:' } },
        },
        select: { id: true },
      });
      const amount = parseFloat(leg.amount);
      if (existingSend) {
        console.log(
          `OK   ${updateId.slice(0, 18)}...: baris Send sudah ada (@${sender.username} -${amount} CC)`,
        );
        handled = true;
        break;
      }

      const occupier = await prisma.ccTransaction.findFirst({
        where: { userId: sender.id, ledgerTxId: updateId },
        select: {
          id: true,
          type: true,
          description: true,
          amountMicroCc: true,
          referenceId: true,
        },
      });

      console.log(
        `TAMBAL ${updateId.slice(0, 18)}...: @${sender.username} -${amount} CC → ${leg.receiver.split('::')[0]}`,
      );
      console.log(
        `   slot ditempati: ${occupier ? `${occupier.type} ${Number(occupier.amountMicroCc) / 1e6} CC "${occupier.description}"` : '(kosong)'}`,
      );

      if (!APPLY) {
        handled = true;
        break;
      }

      // Urutan: bebaskan slot DULU (baris change bukan history transfer — ia
      // hanya artefak yang menempati slot unik), lalu tulis baris Send lewat
      // penulis produksi. Saldo tidak disentuh. Bila penulisan Send gagal,
      // script aman diulang: baris Send belum ada → percobaan berikutnya jalan.
      //
      // WAKTU: createdAt baris Send harus waktu transfer on-chain, BUKAN waktu
      // script jalan. Sumber paling akurat = createdAt baris change yang
      // ditempati (ditulis WSS handler tepat saat event). Fallback: baris lain
      // di update yang sama (mis. baris fee).
      let eventAt: Date | null = null;
      if (occupier) {
        const full = await prisma.ccTransaction.findUnique({
          where: { id: occupier.id },
        });
        eventAt = full?.createdAt ?? null;
        console.log(
          `   ~ backup baris yang dihapus: id=${full?.id} type=${full?.type} amountMicroCc=${full?.amountMicroCc} desc="${full?.description}" ref=${full?.referenceId} ltx=${full?.ledgerTxId} upd=${full?.cantonUpdateId} created=${full?.createdAt?.toISOString()}`,
        );
        await prisma.ccTransaction.delete({ where: { id: occupier.id } });
        console.log(
          `   − baris ${occupier.type} "${occupier.description}" dihapus (slot dibebaskan)`,
        );
      }
      if (!eventAt) {
        const sibling = await prisma.ccTransaction.findFirst({
          where: { userId: sender.id, cantonUpdateId: updateId },
          orderBy: { createdAt: 'asc' },
          select: { createdAt: true },
        });
        eventAt = sibling?.createdAt ?? null;
      }

      const created = await users.recordTransaction({
        userId: sender.id,
        amountCc: amount,
        type: 'TRANSFER_OUT',
        // Memo asli tidak dibawa ledger; baris Send lain di produksi juga
        // umumnya ber-deskripsi kosong → FE menampilkan "Send".
        description: '',
        referenceId: normalizeCantonPartyId(leg.receiver) ?? leg.receiver,
        ledgerTxId: updateId,
        cantonUpdateId: updateId,
        status: 'COMPLETED',
      });
      if (eventAt) {
        await prisma.ccTransaction.update({
          where: { id: created.id },
          data: { createdAt: eventAt },
        });
      }
      console.log(
        `   ✓ baris Send ditulis (createdAt=${eventAt?.toISOString() ?? 'now'}).`,
      );
      handled = true;
      break;
    }

    if (!handled) {
      console.log(
        `SKIP ${updateId.slice(0, 18)}...: tidak ada leg ke user CanQuest yang Send-nya hilang`,
      );
    }
  }

  console.log(
    APPLY ? '\nSELESAI.' : '\nDRY RUN — tambahkan --apply untuk menulis.',
  );
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error('fatal', err);
  process.exit(1);
});
