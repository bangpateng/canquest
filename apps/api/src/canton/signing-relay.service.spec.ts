/**
 * Isolasi signing relay (P0 security regression).
 *
 * Bukti bahwa prepared signing request TERIKAT ke user yang menyiapkannya:
 *   - User B tidak bisa meng-eksekusi prepared request milik User A.
 *   - Eksekusi memakai partyId yang DIKUNCI saat prepare (identitas server),
 *     bukan identitas yang bisa disubstitusi di langkah execute.
 *   - Satu prepared request hanya bisa dikonsumsi sekali (replay ditolak).
 *
 * SDK di-stub: kita hanya menguji logika binding/otorisasi relay, bukan Canton.
 */
import { BadRequestException } from '@nestjs/common';
import { SigningRelayService } from './signing-relay.service';

const PARTY_A = 'canquest-user-aaa::1220' + 'a'.repeat(60);
const PARTY_B = 'canquest-user-bbb::1220' + 'b'.repeat(60);

type FakePrepared = {
  preparedPromise: Promise<{
    preparedTransactionHash: string;
    preparedTransaction: { partyId: string };
  }>;
};

function makeService() {
  const preparedByParty = new Map<string, FakePrepared>();

  const prepare = jest.fn((args: { partyId: string }): FakePrepared => {
    const prepared: FakePrepared = {
      preparedPromise: Promise.resolve({
        preparedTransactionHash: `hash-${args.partyId}`,
        preparedTransaction: { partyId: args.partyId },
      }),
    };
    preparedByParty.set(args.partyId, prepared);
    return prepared;
  });

  const execute = jest.fn(
    (
      signed: { partyId: string },
      _opts: { partyId: string; submissionId: string },
    ) => Promise.resolve({ updateId: `update-${signed.partyId}` }),
  );

  const sdk = {
    ledger: {
      prepare,
      fromSignature: jest.fn(
        (
          response: { preparedTransaction: { partyId: string } },
          signature: string,
        ) => ({ partyId: response.preparedTransaction.partyId, signature }),
      ),
      execute,
    },
  };

  const sdkProvider = { getSdk: jest.fn().mockResolvedValue(sdk) };
  const ledger = {};
  const splice = {};
  const prisma = {};
  const users = {};
  const config = { get: jest.fn().mockReturnValue(undefined) };
  const claimOffers = {};
  const lockProposals = {};

  const service = new SigningRelayService(
    sdkProvider as never,
    ledger as never,
    splice as never,
    prisma as never,
    users as never,
    config as never,
    claimOffers as never,
    lockProposals as never,
  );

  return { service, sdk, execute };
}

const OPTS = (partyId: string) => ({
  partyId,
  commandId: `cmd-${partyId.split('::')[0]}`,
  meta: {},
  description: 'test',
});

describe('SigningRelayService — isolasi prepared request antar user', () => {
  it('User B TIDAK bisa execute prepared request milik User A', async () => {
    const { service, execute } = makeService();

    await service.prepareWithCommands(
      'userA',
      'wallet_registration_accept',
      [],
      OPTS(PARTY_A),
    );

    await expect(
      service.execute('userB', 'x'.repeat(64)),
    ).rejects.toBeInstanceOf(BadRequestException);

    // Tidak ada submit yang lolos atas nama party A.
    expect(execute).not.toHaveBeenCalled();
  });

  it('User A execute → sukses dan memakai party A (identitas dari prepare)', async () => {
    const { service, execute } = makeService();

    await service.prepareWithCommands(
      'userA',
      'wallet_registration_accept',
      [],
      OPTS(PARTY_A),
    );
    const result = await service.execute('userA', 'x'.repeat(64));

    expect(result.updateId).toBe(`update-${PARTY_A}`);
    expect(execute).toHaveBeenCalledTimes(1);
    const [, opts] = execute.mock.calls[0];
    expect(opts.partyId).toBe(PARTY_A);
  });

  it('dua user prepare paralel → masing-masing execute dengan party-nya sendiri (tanpa crossover)', async () => {
    const { service, execute } = makeService();

    await service.prepareWithCommands(
      'userA',
      'wallet_registration_accept',
      [],
      OPTS(PARTY_A),
    );
    await service.prepareWithCommands(
      'userB',
      'wallet_registration_accept',
      [],
      OPTS(PARTY_B),
    );

    const [resA, resB] = await Promise.all([
      service.execute('userA', 'x'.repeat(64)),
      service.execute('userB', 'y'.repeat(64)),
    ]);

    expect(resA.updateId).toBe(`update-${PARTY_A}`);
    expect(resB.updateId).toBe(`update-${PARTY_B}`);

    // Kedua party terpakai, masing-masing sekali — tidak ada yang dipakai dua kali.
    const partiesUsed = execute.mock.calls.map((c) => c[1].partyId).sort();
    expect(partiesUsed).toEqual([PARTY_A, PARTY_B].sort());
  });

  it('prepared request hanya bisa dikonsumsi sekali (replay ditolak)', async () => {
    const { service, execute } = makeService();

    await service.prepareWithCommands(
      'userA',
      'wallet_registration_accept',
      [],
      OPTS(PARTY_A),
    );
    await service.execute('userA', 'x'.repeat(64));

    await expect(
      service.execute('userA', 'x'.repeat(64)),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('user tanpa prepared request → execute ditolak (tidak menebak)', async () => {
    const { service, execute } = makeService();
    await expect(
      service.execute('userGhost', 'x'.repeat(64)),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(execute).not.toHaveBeenCalled();
  });
});
