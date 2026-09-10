/**
 * L60: raw ledger ingest contract — LedgerRawIngestService.toEventRows.
 *
 * Menjamin: SATU BARIS PER EVENT (tanpa agregasi), eventIndex positional
 * (bukan nodeId), Archive dipertahankan sebagai exercised, interfaceViews
 * diteruskan mentah di payload, redelivery menghasilkan baris identik
 * (idempoten via PK updateId+eventIndex).
 */
import { LedgerRawIngestService } from './ledger-raw-ingest.service';
import type { CantonUpdateEvent } from './canton-updates.service';
import { buildUpdateFormatCumulative } from './canton-updates.service';

function baseEvent(over: Partial<CantonUpdateEvent> = {}): CantonUpdateEvent {
  return {
    offset: 1325354,
    updateId: '1220abc',
    commandId: 'tf-001',
    effectiveAt: '2026-07-18T07:43:29.599964Z',
    workflowId: '',
    parties: ['karel::1220abc'],
    created: [],
    archived: [],
    exercised: [],
    ...over,
  };
}

describe('ledger raw ingest (L60)', () => {
  it('R1: CreatedEvent dipertahankan per kontrak (tanpa agregasi)', () => {
    const ev = baseEvent({
      created: [
        {
          nodeId: 3,
          contractId: 'cid-output',
          templateId: 'hash:Splice.Amulet:Amulet',
          createArgument: { owner: 'karel::1220', amount: { initialAmount: '4.22' } },
        },
        {
          nodeId: 4,
          contractId: 'cid-change',
          templateId: 'hash:Splice.Amulet:Amulet',
          createArgument: { owner: 'karel::1220', amount: { initialAmount: '49.98' } },
        },
      ],
    });
    const rows = LedgerRawIngestService.toEventRows(ev);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      eventIndex: 0,
      eventType: 'created',
      contractId: 'cid-output',
    });
    expect(rows[1]).toMatchObject({
      eventIndex: 1,
      eventType: 'created',
      contractId: 'cid-change',
    });
  });

  it('R2: ExercisedEvent(choice=Archive) dipertahankan sebagai exercised', () => {
    const ev = baseEvent({
      exercised: [
        {
          nodeId: 0,
          contractId: 'cid-old',
          templateId: 'hash:Splice.Amulet:Amulet',
          choice: 'Archive',
          choiceArgument: {},
          actingParties: ['karel::1220'],
        },
      ],
    });
    const rows = LedgerRawIngestService.toEventRows(ev);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      eventIndex: 0,
      eventType: 'exercised',
      choice: 'Archive',
      contractId: 'cid-old',
    });
  });

  it('R3: satu update multi-event (created + exercised) → N baris berurutan', () => {
    const ev = baseEvent({
      created: [
        {
          contractId: 'cid-new',
          templateId: 'pkg:Utility.Registry.Holding.V0.Holding:Holding',
          createArgument: { owner: 'karel::1220' },
        },
      ],
      exercised: [
        {
          contractId: 'cid-factory',
          templateId: 'pkg:Splice.Api.Token.TransferInstructionV1:TransferFactory',
          choice: 'TransferFactory_Transfer',
          choiceArgument: {},
        },
      ],
    });
    const rows = LedgerRawIngestService.toEventRows(ev);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.eventType)).toEqual(['created', 'exercised']);
    expect(rows.map((r) => r.eventIndex)).toEqual([0, 1]);
  });

  it('R4: interfaceViews diteruskan mentah di payload (sumber kanonis token)', () => {
    const viewValue = {
      owner: 'karel::1220abc',
      amount: '1.0348225687',
      instrumentId: { admin: 'DSO::1220dso', id: 'USDCx' },
    };
    const ev = baseEvent({
      created: [
        {
          contractId: 'cid-tok',
          templateId: 'pkg:Utility.Registry.Holding.V0.Holding:Holding',
          createArgument: { owner: 'karel::1220abc' },
          interfaceViews: [{ interfaceId: 'holding-iface', viewValue }],
        },
      ],
    });
    const rows = LedgerRawIngestService.toEventRows(ev);
    expect(rows).toHaveLength(1);
    expect(
      (rows[0].payload as { interfaceViews: Array<{ viewValue: unknown }> })
        .interfaceViews[0].viewValue,
    ).toEqual(viewValue);
  });

  it('R5: redelivery update sama → baris identik (idempoten via PK)', () => {
    const ev = baseEvent({
      created: [
        {
          contractId: 'cid-1',
          templateId: 'hash:Splice.Amulet:Amulet',
          createArgument: {},
        },
      ],
    });
    const a = LedgerRawIngestService.toEventRows(ev);
    const b = LedgerRawIngestService.toEventRows(structuredClone(ev));
    expect(a).toEqual(b);
    expect(`${ev.updateId}:${a[0].eventIndex}`).toBe('1220abc:0');
  });

  it('R6: deposit vs delivery swap = dua update berbeda (tidak digabung)', () => {
    const deposit = baseEvent({
      updateId: '1220deposit',
      offset: 100,
      created: [
        {
          contractId: 'cid-deposit-out',
          templateId: 'hash:Splice.Amulet:Amulet',
          createArgument: { owner: 'escrow::1220' },
        },
      ],
    });
    const delivery = baseEvent({
      updateId: '1220delivery',
      offset: 200,
      created: [
        {
          contractId: 'cid-delivery-out',
          templateId: 'hash:Splice.Amulet:Amulet',
          createArgument: { owner: 'karel::1220' },
        },
      ],
    });
    const rd = LedgerRawIngestService.toEventRows(deposit);
    const rl = LedgerRawIngestService.toEventRows(delivery);
    expect(rd).toHaveLength(1);
    expect(rl).toHaveLength(1);
    expect(rd[0]).not.toEqual(rl[0]);
    expect(rd[0].contractId).toBe('cid-deposit-out');
    expect(rl[0].contractId).toBe('cid-delivery-out');
    expect(deposit.updateId).not.toBe(delivery.updateId);
  });

  it('R7: filter produksi = 7 InterfaceFilter views + wildcard, verbose, LEDGER_EFFECTS', () => {
    const cumulative = buildUpdateFormatCumulative();
    // 7 interface + 1 wildcard.
    expect(cumulative).toHaveLength(8);
    const ifaces = cumulative.slice(0, 7);
    for (const entry of ifaces) {
      const value = (
        entry as {
          identifierFilter: {
            InterfaceFilter: {
              value: {
                interfaceId: string;
                includeInterfaceView: boolean;
                includeCreatedEventBlob: boolean;
              };
            };
          };
        }
      ).identifierFilter.InterfaceFilter.value;
      expect(value.includeInterfaceView).toBe(true);
      expect(value.includeCreatedEventBlob).toBe(false);
      expect(typeof value.interfaceId).toBe('string');
    }
    const wild = cumulative[7] as {
      identifierFilter: { WildcardFilter: { value: Record<string, unknown> } };
    };
    expect(wild.identifierFilter.WildcardFilter).toBeDefined();
  });
});
