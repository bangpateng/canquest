import { RewardType } from '@prisma/client';
import {
  v30Account,
  v30CodeHash,
  v30Dec,
  v30RewardKindFor,
  v30ValidUntil,
  V30_LEDGER_PACKAGE,
  isV30Quest,
} from './v30.constants';

describe('v30 codeHash — rumus terkunci (AGENT.md)', () => {
  it('sha256(utf8) hex — vektor uji Daml Script SDK 3.4.11 (terbukti 2026-09-02)', () => {
    // sha256 (toHex "INVITE-XYZ") on-ledger = d3b9e1b1… (Daml Script probe).
    expect(v30CodeHash('INVITE-XYZ')).toBe(
      'd3b9e1b1c8914974d152102b7086866a575ac600ddf1111142a7bba5eb358d09',
    );
  });

  it('bukan sha256 atas string-hex (kelas bug "sha256 mentah")', () => {
    const wrong = require('crypto')
      .createHash('sha256')
      .update(Buffer.from('INVITE-XYZ', 'utf8').toString('hex'), 'utf8')
      .digest('hex');
    expect(v30CodeHash('INVITE-XYZ')).not.toBe(wrong);
  });

  it('deterministik & beda per plaintext', () => {
    expect(v30CodeHash('abc')).toBe(v30CodeHash('abc'));
    expect(v30CodeHash('abc')).not.toBe(v30CodeHash('abd'));
  });
});

describe('v30ValidUntil — waktu UNDIAN + 48 jam (bukan campaign)', () => {
  it('tepat 48 jam setelah undian', () => {
    const drawnAt = new Date('2026-09-01T12:00:00Z');
    expect(v30ValidUntil(drawnAt).toISOString()).toBe(
      '2026-09-03T12:00:00.000Z',
    );
  });
});

describe('v30RewardKindFor — mapping RewardType dapp → RewardKind kontrak', () => {
  const ccInstrument = { admin: 'DSO::1220abc', id: 'Amulet' };
  const usdcInstrument = { admin: 'registrar::1220def', id: 'USDCx' };

  it('CC_ONLY → TokenOnly (CC)', () => {
    const k = v30RewardKindFor({
      rewardType: RewardType.CC_ONLY,
      rewardToken: 'CC',
      rewardAmountCc: 10,
      codePlaintext: null,
      instrument: ccInstrument,
    });
    expect(k?.label).toBe('TOKEN_ONLY');
    expect(k?.json).toEqual({
      tag: 'TokenOnly',
      value: { tokenAmount: '10.0', tokenInstrument: ccInstrument },
    });
  });

  it('INVITE_CODE_RANDOM + kode → CodeOnly (hash kode terkomit)', () => {
    const k = v30RewardKindFor({
      rewardType: RewardType.INVITE_CODE_RANDOM,
      rewardToken: 'CC',
      rewardAmountCc: 0,
      codePlaintext: 'INVITE-XYZ',
      instrument: ccInstrument,
    });
    expect(k?.label).toBe('CODE_ONLY');
    expect(k?.json).toEqual({
      tag: 'CodeOnly',
      value: v30CodeHash('INVITE-XYZ'),
    });
    expect(k?.hasToken).toBe(false);
  });

  it('CC_AND_CODE_RAFFLE (both) → TokenAndCode', () => {
    const k = v30RewardKindFor({
      rewardType: RewardType.CC_AND_CODE_RAFFLE,
      rewardToken: 'USDCx',
      rewardAmountCc: 25,
      codePlaintext: 'CODE-1',
      instrument: usdcInstrument,
    });
    expect(k?.label).toBe('TOKEN_AND_CODE');
    expect(k?.hasToken).toBe(true);
    expect(k?.hasCode).toBe(true);
  });

  it('CC_AND_CODE_RAFFLE variant CC-only (caller map ke CC_ONLY)', () => {
    const k = v30RewardKindFor({
      rewardType: RewardType.CC_ONLY, // variant 'CC' dari caller
      rewardToken: 'USDCx',
      rewardAmountCc: 25,
      codePlaintext: null,
      instrument: usdcInstrument,
    });
    expect(k?.label).toBe('TOKEN_ONLY');
    expect(k?.json).toEqual({
      tag: 'TokenOnly',
      value: { tokenAmount: '25.0', tokenInstrument: usdcInstrument },
    });
  });

  it('kode reward tanpa kode tersedia → null (caller wajib menolak)', () => {
    const k = v30RewardKindFor({
      rewardType: RewardType.INVITE_CODE_RANDOM,
      rewardToken: 'CC',
      rewardAmountCc: 0,
      codePlaintext: null,
      instrument: ccInstrument,
    });
    expect(k).toBeNull();
  });
});

describe('v30 DAML-LF JSON helpers', () => {
  it('v30Dec: Decimal wajib string dengan .0', () => {
    expect(v30Dec(5)).toBe('5.0');
    expect(v30Dec(0.01)).toBe('0.01');
  });

  it('v30Account: regular account Some owner', () => {
    expect(v30Account('canquest-user-1::1220x')).toEqual({
      owner: 'canquest-user-1::1220x',
      provider: null,
      id: '',
    });
  });

  it('isV30Quest: pinning per-quest', () => {
    expect(isV30Quest({ ledgerPackage: V30_LEDGER_PACKAGE })).toBe(true);
    expect(isV30Quest({ ledgerPackage: 'canquest-v29' })).toBe(false);
    expect(isV30Quest({ ledgerPackage: null })).toBe(false);
  });
});
