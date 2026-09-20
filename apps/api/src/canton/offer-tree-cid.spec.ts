/**
 * Unit test ekstraksi CID offer dari respons ledger.
 *
 * Nilai yang dijaga di sini adalah inti perbaikan bug "offer pending selamanya":
 * CID harus ditemukan dari FAKTA tree (adanya kontrak offer), bukan dari label
 * `transferKind` registry yang pernah salah lapor 'direct' pada produksi.
 *
 * Bentuk respons diambil dari struktur submit-and-wait Canton JSON Ledger API
 * (eventsById + wrapper PascalCase CreatedTreeEvent).
 */
import {
  extractTransferInstructionCid,
  isOfferTemplate,
} from './offer-tree-cid';

const OFFER_CID = '00' + 'a'.repeat(62);
const HOLDING_CID = '00' + 'b'.repeat(62);

describe('isOfferTemplate', () => {
  it('mengenali template offer CIP-0056 dan registry', () => {
    expect(
      isOfferTemplate(
        '7a75ef6e:Utility.Registry.App.V0.Model.Transfer:TransferOffer',
      ),
    ).toBe(true);
    expect(
      isOfferTemplate(
        'abc:Splice.AmuletTransferInstruction:AmuletTransferInstruction',
      ),
    ).toBe(true);
    expect(isOfferTemplate('x:TransferInstruction')).toBe(true);
  });

  it('menolak holding/factory/result', () => {
    expect(
      isOfferTemplate('x:Utility.Registry.Holding.V0.Holding:Holding'),
    ).toBe(false);
    expect(isOfferTemplate('x:TransferFactory')).toBe(false);
  });
});

describe('extractTransferInstructionCid', () => {
  it('eventsById: mengambil CID offer, bukan holding yang muncul lebih dulu', () => {
    // Kasus nyata: tree memuat holding change SEBELUM kontrak offer. Versi lama
    // (contractId pertama) mengambil holding → CID offer hilang.
    const response = JSON.stringify({
      transactionTree: { updateId: '1220' + 'c'.repeat(60) },
      eventsById: {
        '0': {
          templateId: '8107899:Utility.Registry.Holding.V0.Holding:Holding',
          contractId: HOLDING_CID,
        },
        '1': {
          templateId:
            '7a75ef6e:Utility.Registry.App.V0.Model.Transfer:TransferOffer',
          contractId: OFFER_CID,
        },
      },
    });
    expect(extractTransferInstructionCid(response)).toBe(OFFER_CID);
  });

  it('extracts CC AmuletTransferInstruction from a transaction tree', () => {
    const response = JSON.stringify({
      eventsById: {
        '0': {
          templateId:
            'abc:Splice.AmuletTransferInstruction:AmuletTransferInstruction',
          contractId: OFFER_CID,
        },
      },
    });
    expect(extractTransferInstructionCid(response)).toBe(OFFER_CID);
  });

  it('wrapper PascalCase CreatedTreeEvent', () => {
    const response = JSON.stringify({
      CreatedTreeEvent: {
        value: {
          templateId: 'x:TransferInstruction',
          contractId: OFFER_CID,
        },
      },
    });
    expect(extractTransferInstructionCid(response)).toBe(OFFER_CID);
  });

  it('transfer langsung (tanpa kontrak offer) → null', () => {
    // Penerima sudah preapprove: hanya holding/event-log yang tercipta.
    const response = JSON.stringify({
      eventsById: {
        '0': { templateId: 'x:Holding:Holding', contractId: HOLDING_CID },
        '1': {
          templateId: 'x:EventLog_HoldingsChange',
          contractId: HOLDING_CID,
        },
      },
    });
    expect(extractTransferInstructionCid(response)).toBeNull();
  });

  it('respons tidak valid → null (tidak melempar)', () => {
    expect(extractTransferInstructionCid('not json')).toBeNull();
    expect(extractTransferInstructionCid('')).toBeNull();
    expect(extractTransferInstructionCid('{}')).toBeNull();
  });

  it('tetap menemukan offer meski bersarang dalam array (bentuk flat)', () => {
    const response = JSON.stringify({
      events: [
        {
          created: { templateId: 'x:Holding:Holding', contractId: HOLDING_CID },
        },
        {
          created: {
            templateId: 'x:TransferOffer',
            contractId: OFFER_CID,
          },
        },
      ],
    });
    expect(extractTransferInstructionCid(response)).toBe(OFFER_CID);
  });
});
