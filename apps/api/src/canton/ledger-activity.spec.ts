/**
 * L60 satu sumber: LedgerActivityService.projectRow — pure projection
 * LedgerEvent → baris feed. Tanpa DB (service di-construct tanpa prisma
 * untuk test ini via Object.create).
 */
import { LedgerActivityService } from './ledger-activity.service';

const USER = 'canquest-user-7fd3df003453::1220a5e003d34981573be4bc35737d6b78176e7117af28e80c90ec339a0262b92260';
const ESCROW = 'oneswap-wallet-mtpoao3s::122043df1a3b6ae04288cbcd1899434a945a75b849859f20b124e8ba07ebb812a047';
const DSO = 'DSO::1220b1431ef217342db44d516bb9befde802be7d8899637d290895fa58880f19accc';

function svc(): LedgerActivityService {
  return Object.create(LedgerActivityService.prototype) as LedgerActivityService;
}

function row(over: Record<string, unknown>) {
  return {
    updateId: '1220abc',
    eventIndex: 0,
    eventType: 'created',
    templateId: null,
    choice: null,
    contractId: 'cid-1',
    witnessParties: [USER],
    payload: {},
    ...over,
  } as Parameters<LedgerActivityService['projectRow']>[0];
}

describe('ledger activity projection (satu sumber)', () => {
  it('created Amulet milik user → baris in CC + link updateId', () => {
    const item = svc().projectRow(
      row({
        templateId: 'hash:Splice.Amulet:Amulet',
        payload: {
          createArgument: { owner: USER, amount: { initialAmount: '8.6924543455' } },
          witnessParties: [USER],
        },
      }),
      USER,
    );
    expect(item).not.toBeNull();
    expect(item).toMatchObject({
      updateId: '1220abc',
      direction: 'in',
      instrumentId: 'CC',
      amount: '8.6924543455',
    });
  });

  it('created Holding milik user → baris in token', () => {
    const item = svc().projectRow(
      row({
        templateId: 'hash:Utility.Registry.Holding.V0.Holding:Holding',
        payload: {
          createArgument: {
            owner: USER,
            amount: '1.2411679363',
            instrument: { id: 'USDCx', admin: DSO },
          },
          witnessParties: [USER],
        },
      }),
      USER,
    );
    expect(item).toMatchObject({
      direction: 'in',
      instrumentId: 'USDCx',
      amount: '1.2411679363',
    });
  });

  it('created milik orang lain tapi user witness → tampil sebagai kejadian', () => {
    const item = svc().projectRow(
      row({
        templateId: 'hash:Splice.Amulet:Amulet',
        payload: {
          createArgument: { owner: ESCROW, amount: { initialAmount: '5' } },
          witnessParties: [USER, ESCROW],
        },
      }),
      USER,
    );
    expect(item).not.toBeNull();
    expect(item).toMatchObject({ direction: null, counterparty: ESCROW });
  });

  it('exercised Accept oleh user → baris action + link', () => {
    const item = svc().projectRow(
      row({
        eventType: 'exercised',
        templateId: 'pkg:Transfer:TransferOffer',
        choice: 'TransferInstruction_Accept',
        contractId: 'cid-offer',
        payload: { actingParties: [USER], witnessParties: [USER, ESCROW] },
      }),
      USER,
    );
    expect(item).toMatchObject({
      direction: 'action',
      choice: 'TransferInstruction_Accept',
      label: 'Accepted offer',
    });
  });

  it('exercised Archive → null (consume internal)', () => {
    expect(
      svc().projectRow(
        row({
          eventType: 'exercised',
          templateId: 'pkg:Holding:Holding',
          choice: 'Archive',
          payload: { actingParties: [USER], witnessParties: [USER] },
        }),
        USER,
      ),
    ).toBeNull();
  });

  it('exercised orang lain tapi user witness → tampil sebagai kejadian', () => {
    const item = svc().projectRow(
      row({
        eventType: 'exercised',
        templateId: 'pkg:X:Y',
        choice: 'TransferFactory_Transfer',
        payload: {
          actingParties: [ESCROW],
          witnessParties: [USER, ESCROW],
          choiceArgument: { transfer: { sender: ESCROW, receiver: USER } },
        },
      }),
      USER,
    );
    expect(item).not.toBeNull();
    expect(item).toMatchObject({ direction: null, counterparty: ESCROW });
  });
});
