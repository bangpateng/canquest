import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CantonReassignment,
  CantonUpdateEvent,
} from './canton-updates.service';

/**
 * LedgerRawIngestService — RAW LEDGER PROJECTION BOUNDARY (canonical history).
 *
 * Untuk setiap CantonUpdateEvent dari /v2/updates (LEDGER_EFFECTS):
 *   - 1 baris LedgerUpdate (PK updateId): updateId, commandId, effectiveAt,
 *     envelope JSON lengkap.
 *   - N baris LedgerEvent (PK updateId+eventIndex): SATU BARIS PER EVENT,
 *     tanpa agregasi, tanpa atribusi user, tanpa klasifikasi semantik.
 *
 * Kontrak preservasi:
 *   - eventIndex = posisi array events[] (0-based). BUKAN Canton nodeId —
 *     nodeId (bila ada) tersimpan mentah di payload.
 *   - eventType = 'created' | 'archived' | 'exercised' (normalisasi dari
 *     wrapper lowercase maupun PascalCase — sama seperti
 *     scripts/ledger-backfill.cjs). Archive di LEDGER_EFFECTS tiba sebagai
 *     ExercisedEvent(choice=Archive) dan dipertahankan sebagai exercised
 *     (bukti audit #5) — JANGAN digabung ke created.
 *   - payload/envelope = JSON mentah lengkap (interfaceViews, choiceArgument,
 *     actingParties, dsb bila dibawa wire) — sumber forensik.
 *   - offset = offset ledger asli, ditulis HANYA bila wire membawanya
 *     (CantonUpdateEvent.offsetKnown true) — nilai sama untuk LedgerUpdate
 *     dan seluruh LedgerEvent-nya, sehingga feed bisa diurutkan kronologis
 *     dan direkonsiliasi per-rentang. Bila wire tidak membawa (LEDGER_EFFECTS
 *     kadang tanpa offset top-level), kolom nullable → null. Tidak pernah
 *     difake dari effectiveAt/recordTime/nodeId/index/offset fallback
 *     in-memory (audit #4/#5). recordTime tetap null (tidak dibawa wire);
 *     effectiveAt (jam ledger) disimpan di kolomnya sendiri — bukan recordTime.
 *
 * Idempotency: upsert per PK — replay WSS / reconnect / backfill aman.
 * Tidak menyentuh checkpoint/replay (milik CantonUpdatesService).
 */
@Injectable()
export class LedgerRawIngestService {
  private readonly logger = new Logger(LedgerRawIngestService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Preservasi satu update + semua event-nya. Idempoten (upsert per PK).
   * Non-fatal: error dicatat, tidak melempar — semantic projector
   * (BalanceEventHandler) tetap jalan walau raw ingest gagal sesaat.
   */
  async ingestUpdate(ev: CantonUpdateEvent): Promise<void> {
    const updateId = ev.updateId;
    if (!updateId) return; // OffsetCheckpoint / tanpa identitas — bukan transaksi.

    try {
      const effectiveAt = parseEffectiveAt(ev.effectiveAt);
      const envelope = {
        updateId,
        commandId: ev.commandId ?? null,
        workflowId: ev.workflowId ?? null,
        effectiveAt: ev.effectiveAt ?? null,
        created: ev.created,
        archived: ev.archived,
        exercised: ev.exercised,
      } as unknown as Prisma.InputJsonValue;

      const events = buildEventRows(ev);
      // Offset ledger asli — HANYA bila wire membawanya (offsetKnown). Bila
      // absen, null (jujur): kolom nullable, dan offset fallback in-memory
      // BUKAN posisi ledger. Sumber tunggal, dipakai update + tiap event.
      const offset = resolveRawOffset(ev);

      // Satu transaksi DB: update + N events atomik. upsert per PK → replay aman.
      await this.prisma.$transaction(async (tx) => {
        await tx.ledgerUpdate.upsert({
          where: { updateId },
          create: {
            updateId,
            offset,
            recordTime: null,
            effectiveAt,
            commandId: ev.commandId ?? null,
            synchronizerId: null,
            envelope,
          },
          update: {
            // Refresh envelope/forensik bila redelivery membawa payload yang
            // lebih lengkap (mis. filter berubah); identitas tak tersentuh.
            effectiveAt: effectiveAt ?? undefined,
            commandId: ev.commandId ?? undefined,
            // Hanya isi offset bila sekarang diketahui — redelivery tanpa
            // offset tidak boleh meng-null-kan nilai yang sudah tersimpan.
            offset: offset ?? undefined,
            envelope,
          },
        });
        for (const row of events) {
          await tx.ledgerEvent.upsert({
            where: {
              updateId_eventIndex: {
                updateId,
                eventIndex: row.eventIndex,
              },
            },
            create: {
              updateId,
              eventIndex: row.eventIndex,
              offset,
              recordTime: null,
              eventType: row.eventType,
              templateId: row.templateId,
              choice: row.choice,
              contractId: row.contractId,
              witnessParties: row.witnessParties,
              payload: row.payload,
            },
            update: {
              eventType: row.eventType,
              templateId: row.templateId,
              choice: row.choice,
              contractId: row.contractId,
              witnessParties: row.witnessParties,
              payload: row.payload,
              // Sama seperti LedgerUpdate: isi bila diketahui, jangan null-kan
              // kembali nilai yang sudah ada (heal baris lama ber-offset null).
              offset: offset ?? undefined,
            },
          });
        }
      });
    } catch (err) {
      this.logger.warn(
        `LedgerRawIngest: ingest failed updateId=${updateId.slice(0, 16)}… events=${ev.created.length + ev.archived.length + ev.exercised.length}: ${String(err)}`,
      );
    }
  }

  /**
   * Preservasi satu update Reassignment (kontrak pindah synchronizer).
   *
   * RAW AUDIT SAJA — tidak ada proyeksi semantik. Sisi `assigned` membawa
   * CreatedEvent lengkap, tapi kontrak itu sudah ada sebelum reassignment:
   * menganggapnya create baru akan double-count saldo. Feed personal juga
   * tidak menampilkannya (projectRow hanya mengenal created/exercised).
   *
   * Yang disimpan: update (PK updateId) + satu baris per event dengan
   * eventType 'assigned' | 'unassigned'. recordTime DIISI (reassignment
   * membawanya di wire, beda dari Transaction LEDGER_EFFECTS). Idempoten
   * upsert per PK — replay/reconnect aman.
   */
  async ingestReassignment(ev: CantonReassignment): Promise<void> {
    const updateId = ev.updateId;
    if (!updateId) return; // tanpa identitas — bukan update yang bisa di-resume.

    try {
      const offset = resolveReassignmentOffset(ev);
      const envelope = {
        updateId,
        kind: 'reassignment',
        commandId: ev.commandId ?? null,
        workflowId: ev.workflowId ?? null,
        recordTime: ev.recordTime ?? null,
        synchronizerId: ev.synchronizerId ?? null,
        parties: ev.parties,
        events: ev.events,
      } as unknown as Prisma.InputJsonValue;

      await this.prisma.$transaction(async (tx) => {
        await tx.ledgerUpdate.upsert({
          where: { updateId },
          create: {
            updateId,
            offset,
            recordTime: parseEffectiveAt(ev.recordTime),
            effectiveAt: null,
            commandId: ev.commandId ?? null,
            synchronizerId: ev.synchronizerId ?? null,
            envelope,
          },
          update: {
            commandId: ev.commandId ?? undefined,
            offset: offset ?? undefined,
            recordTime: parseEffectiveAt(ev.recordTime) ?? undefined,
            synchronizerId: ev.synchronizerId ?? undefined,
            envelope,
          },
        });
        for (const row of ev.events) {
          await tx.ledgerEvent.upsert({
            where: {
              updateId_eventIndex: { updateId, eventIndex: row.eventIndex },
            },
            create: {
              updateId,
              eventIndex: row.eventIndex,
              offset,
              recordTime: parseEffectiveAt(ev.recordTime),
              eventType: row.kind,
              templateId: row.templateId,
              choice: null,
              contractId: row.contractId,
              witnessParties: row.witnessParties,
              payload: row.payload as unknown as Prisma.InputJsonValue,
            },
            update: {
              eventType: row.kind,
              templateId: row.templateId,
              contractId: row.contractId,
              witnessParties: row.witnessParties,
              payload: row.payload as unknown as Prisma.InputJsonValue,
              offset: offset ?? undefined,
            },
          });
        }
      });
    } catch (err) {
      this.logger.warn(
        `LedgerRawIngest: reassignment ingest failed updateId=${updateId.slice(0, 16)}... events=${ev.events.length}: ${String(err)}`,
      );
    }
  }

  /**
   * Varian murni-fungsi untuk unit test: bangun baris LedgerEvent dari
   * CantonUpdateEvent TANPA DB. Kontrak: satu baris per event input,
   * urutan created → archived → exercised, eventIndex positional.
   */
  static toEventRows(ev: CantonUpdateEvent): Array<{
    eventIndex: number;
    eventType: string;
    templateId: string | null;
    choice: string | null;
    contractId: string | null;
    witnessParties: string[];
    offset: bigint | null;
    payload: Prisma.InputJsonValue;
  }> {
    return buildEventRows(ev);
  }
}

/** Parse effectiveAt ISO → Date, atau null bila absen/invalid. */
function parseEffectiveAt(value: string | undefined): Date | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Offset ledger untuk raw layer — BigInt hanya bila wire benar-benar
 * membawanya. `offsetKnown` false/undefined (offset fallback in-memory) atau
 * nilai non-finite → null. JANGAN pakai fallback: offset adalah posisi ledger,
 * bukan tebakan. LedgerUpdate/LedgerEvent memakai nilai yang sama sehingga
 * urutan antar-tabel konsisten. Diexport untuk unit test.
 */
export function resolveRawOffset(ev: CantonUpdateEvent): bigint | null {
  if (!ev.offsetKnown) return null;
  const n = Number(ev.offset);
  if (!Number.isFinite(n) || n < 0) return null;
  return BigInt(Math.trunc(n));
}

/** Offset untuk update Reassignment — kontrak sama: wire-known → BigInt,
 *  fallback → null. Diexport untuk unit test. */
export function resolveReassignmentOffset(
  ev: CantonReassignment,
): bigint | null {
  if (!ev.offsetKnown) return null;
  const n = Number(ev.offset);
  if (!Number.isFinite(n) || n < 0) return null;
  return BigInt(Math.trunc(n));
}

interface BuiltRow {
  eventIndex: number;
  eventType: string;
  templateId: string | null;
  choice: string | null;
  contractId: string | null;
  witnessParties: string[];
  offset: bigint | null;
  payload: Prisma.InputJsonValue;
}

/**
 * Satu baris per event, tanpa agregasi. created[] → archived[] → exercised[]
 * (urutan deterministik, didokumentasikan). eventType = nama wrapper persis.
 * Archive (ExercisedEvent choice=Archive) dipertahankan sebagai exercised —
 * JANGAN digabung ke created.
 */
function buildEventRows(ev: CantonUpdateEvent): BuiltRow[] {
  const offset = resolveRawOffset(ev);
  const rows: BuiltRow[] = [];
  let idx = 0;
  for (const c of ev.created) {
    rows.push({
      eventIndex: idx++,
      eventType: 'created',
      templateId: c.templateId ?? null,
      choice: null,
      contractId: c.contractId ?? null,
      witnessParties: c.witnessParties ?? [],
      offset,
      payload: { ...c } as unknown as Prisma.InputJsonValue,
    });
  }
  for (const a of ev.archived) {
    rows.push({
      eventIndex: idx++,
      eventType: 'archived',
      templateId: a.templateId ?? null,
      choice: null,
      contractId: a.contractId ?? null,
      witnessParties: a.witnessParties ?? [],
      offset,
      payload: { ...a } as unknown as Prisma.InputJsonValue,
    });
  }
  for (const e of ev.exercised) {
    rows.push({
      eventIndex: idx++,
      eventType: 'exercised',
      templateId: e.templateId ?? null,
      choice: e.choice ?? null,
      contractId: e.contractId ?? null,
      witnessParties: e.witnessParties ?? [],
      offset,
      payload: { ...e } as unknown as Prisma.InputJsonValue,
    });
  }
  return rows;
}
