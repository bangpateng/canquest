import { ServiceUnavailableException } from '@nestjs/common';
import { ExternalWalletController } from './external-wallet.controller';

function makeController(opts?: {
  cantonReachable?: boolean;
  spliceReachable?: boolean;
}) {
  const externalWallet = {
    isEnabled: true,
    prepare: jest.fn().mockResolvedValue({
      multiHash: 'prepared-hash',
      partyIdPreview: 'canquest-user-abcdef12::party',
    }),
    complete: jest.fn().mockResolvedValue({
      partyId: 'canquest-user-abcdef12::party',
      fingerprint: 'fingerprint',
    }),
    discard: jest.fn(),
  };
  const ledger = {
    isReachable: jest.fn().mockResolvedValue(opts?.cantonReachable ?? true),
    grantUserRights: jest.fn().mockResolvedValue(undefined),
  };
  const splice = {
    isReachable: jest.fn().mockResolvedValue(opts?.spliceReachable ?? true),
  };
  const featuredActivity = { recordActivity: jest.fn() };
  const users = {
    findById: jest.fn().mockResolvedValue({
      id: 'user-1',
      cantonPartyId: null,
      username: 'alice',
    }),
    findByUsernameInsensitive: jest.fn().mockResolvedValue(null),
    findByPartyId: jest.fn().mockResolvedValue(null),
    setExternalCantonIdentity: jest.fn().mockResolvedValue(undefined),
  };
  const walletInvites = {
    assertCanCreateWallet: jest.fn().mockResolvedValue(undefined),
    redeemAfterWalletCreated: jest.fn().mockResolvedValue(undefined),
    recordAllocation: jest.fn().mockResolvedValue(undefined),
    releaseReservation: jest.fn().mockResolvedValue(undefined),
  };
  const config = { get: jest.fn().mockReturnValue('false') };
  const controller = new ExternalWalletController(
    externalWallet as never,
    ledger as never,
    splice as never,
    featuredActivity as never,
    users as never,
    walletInvites as never,
    config as never,
  );
  const req = { user: { userId: 'user-1' } } as never;

  return {
    controller,
    externalWallet,
    ledger,
    splice,
    users,
    walletInvites,
    req,
  };
}

describe('ExternalWalletController onboarding readiness preflight', () => {
  const prepareDto = {
    publicKeyHex: 'a'.repeat(64),
    partyHint: 'canquest-user-abcdef12',
  };

  it('rejects prepare before topology creation when Canton Ledger API is unreachable', async () => {
    const { controller, externalWallet, req } = makeController({
      cantonReachable: false,
      spliceReachable: true,
    });

    await expect(controller.prepare(req, prepareDto)).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(externalWallet.prepare).not.toHaveBeenCalled();
  });

  it('rejects prepare before topology creation when Splice Validator API is unreachable', async () => {
    const { controller, externalWallet, req } = makeController({
      cantonReachable: true,
      spliceReachable: false,
    });

    await expect(controller.prepare(req, prepareDto)).rejects.toThrow(
      ServiceUnavailableException,
    );
    expect(externalWallet.prepare).not.toHaveBeenCalled();
  });

  it('passes the same prepare inputs through when both services are reachable', async () => {
    const { controller, externalWallet, ledger, splice, req } =
      makeController();

    await expect(controller.prepare(req, prepareDto)).resolves.toEqual({
      multiHash: 'prepared-hash',
      partyIdPreview: 'canquest-user-abcdef12::party',
    });
    expect(ledger.isReachable).toHaveBeenCalledTimes(1);
    expect(splice.isReachable).toHaveBeenCalledTimes(1);
    expect(externalWallet.prepare).toHaveBeenCalledWith(
      'user-1',
      prepareDto.publicKeyHex,
      prepareDto.partyHint,
    );
  });

  it('keeps the prepared session retryable when a service goes down before complete', async () => {
    const { controller, externalWallet, walletInvites, req } = makeController({
      cantonReachable: false,
      spliceReachable: true,
    });

    await expect(
      controller.complete(req, { signature: 'signed-hash-value' }),
    ).rejects.toThrow(ServiceUnavailableException);
    expect(externalWallet.complete).not.toHaveBeenCalled();
    expect(externalWallet.discard).not.toHaveBeenCalled();
    expect(walletInvites.assertCanCreateWallet).not.toHaveBeenCalled();
  });
});
