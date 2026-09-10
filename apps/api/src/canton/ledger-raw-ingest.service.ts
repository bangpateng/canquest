import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { CantonUpdateEvent } from './canton-updates.service';

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
 *   - offset/recordTime TIDAK difake: Transaction.value LEDGER_EFFECTS tidak
 *     membawa top-level offset / recordTime / synchronizerId (audit #4/#5).
 *     Kolom DB nullable — diisi null bila wire tidak membawa. effectiveAt
 *     (jam ledger) disimpan di kolomnya sendiri, BUKAN sebagai recordTime.
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

      // Satu transaksi DB: update + N events atomik. upsert per PK → replay aman.
      await this.prisma.$transaction(async (tx) => {
        await tx.ledgerUpdate.upsert({
          where: { updateId },
          create: {
            updateId,
            offset: null,
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
              offset: null,
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

interface BuiltRow {
  eventIndex: number;
  eventType: string;
  templateId: string | null;
  choice: string | null;
  contractId: string | null;
  witnessParties: string[];
  payload: Prisma.InputJsonValue;
}

/**
 * Satu baris per event, tanpa agregasi. created[] → archived[] → exercised[]
 * (urutan deterministik, didokumentasikan). eventType = nama wrapper persis.
 * Archive (ExercisedEvent choice=Archive) dipertahankan sebagai exercised —
 * JANGAN digabung ke created.
 */
function buildEventRows(ev: CantonUpdateEvent): BuiltRow[] {
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
      payload: { ...e } as unknown as Prisma.InputJsonValue,
    });
  }
  return rows;
}
