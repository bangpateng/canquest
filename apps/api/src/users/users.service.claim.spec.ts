/**
 * Unit test `UsersService.claimLedgerApply` — primitif anti-receipt-ganda.
 *
 * Kontraknya harus tepat: klaim pertama menang (true), klaim kedua untuk
 * (updateId, userId, scope) yang sama WAJIB kalah (false) — itulah yang
 * menghentikan baris penerima ditulis dua kali oleh signing relay dan WSS.
 * Fail-closed: error DB selain tabrakan unik → false (jangan menulis).
 */
import { UsersService } from './users.service';

type CreateImpl = () => Promise<unknown>;

function makeService(createImpl: CreateImpl = () => Promise.resolve({})) {
  const create = jest.fn(createImpl);
  const prisma = { wssBalanceApplied: { create } };
  const points = {};
  const realtime = { push: jest.fn() };
  const service = new UsersService(
    prisma as never,
    points as never,
    realtime as never,
  );
  return { service, create };
}

const UPDATE = `1220${'a'.repeat(60)}`;
const USER = 'user-1';

describe('UsersService.claimLedgerApply', () => {
  it('klaim pertama berhasil → true', async () => {
    const { service, create } = makeService();
    await expect(
      service.claimLedgerApply(UPDATE, USER, 'hist:tok:usdcx'),
    ).resolves.toBe(true);
    expect(create).toHaveBeenCalledWith({
      data: { updateId: UPDATE, userId: USER, scope: 'hist:tok:usdcx' },
    });
  });

  it('klaim kedua untuk kunci sama kalah (P2002) → false', async () => {
    const { service } = makeService(() =>
      Promise.reject(
        new Error(
          'Unique constraint failed on the fields: (`updateId`,`userId`,`scope`) P2002',
        ),
      ),
    );
    await expect(
      service.claimLedgerApply(UPDATE, USER, 'hist:tok:usdcx'),
    ).resolves.toBe(false);
  });

  it('unik per scope: instrumen berbeda = klaim berbeda', async () => {
    // Memastikan satu updateId multi-instrumen tetap boleh punya dua baris.
    const seen: string[] = [];
    const { service } = makeService(() => {
      return Promise.resolve({});
    });
    await service.claimLedgerApply(UPDATE, USER, 'hist:tok:usdcx');
    await service.claimLedgerApply(UPDATE, USER, 'hist:tok:cbtc');
    await service.claimLedgerApply(UPDATE, USER, 'hist:cc');
    expect(seen).toEqual([]); // tidak ada tabrakan pada jalur sukses
  });

  it('error DB selain tabrakan unik → false (fail-closed)', async () => {
    const { service } = makeService(() =>
      Promise.reject(new Error('connection terminated unexpectedly')),
    );
    await expect(
      service.claimLedgerApply(UPDATE, USER, 'hist:tok:usdcx'),
    ).resolves.toBe(false);
  });

  it('argumen kosong → false tanpa menyentuh DB', async () => {
    const { service, create } = makeService();
    await expect(service.claimLedgerApply('', USER, 'hist:cc')).resolves.toBe(
      false,
    );
    await expect(service.claimLedgerApply(UPDATE, '', 'hist:cc')).resolves.toBe(
      false,
    );
    await expect(service.claimLedgerApply(UPDATE, USER, '')).resolves.toBe(
      false,
    );
    expect(create).not.toHaveBeenCalled();
  });
});
