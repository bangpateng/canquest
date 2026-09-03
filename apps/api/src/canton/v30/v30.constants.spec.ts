import { RewardType } from '@prisma/client';
import {
  v30Account,
  v30ClaimModel,
  v30CodeHash,
  v30Dec,
  v30RewardKindFor,
  v30T1At,
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

describe('v30ValidUntil — 7 HARI sejak offer dibuat (spesifikasi owner 2026-09-03)', () => {
  it('tepat 7 hari setelah momen pembuatan offer/undian', () => {
    const drawnAt = new Date('2026-09-01T12:00:00Z');
    expect(v30ValidUntil(drawnAt).toISOString()).toBe(
      '2026-09-08T12:00:00.000Z',
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
      // value = OBJEK ber-label (bukti MainNet: string polos ditolak participant).
      value: { codeHash: v30CodeHash('INVITE-XYZ') },
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

describe('v30ClaimModel — matriks FCFS/Raffle × CC/USDCx/Code (spesifikasi owner)', () => {
  const q = (rewardType: string, rewardToken?: string, entryGateMode?: string) =>
    v30ClaimModel({ rewardType, rewardToken, entryGateMode });

  // ── FCFS ──
  it('INVITE_CODE_FCFS → FCFS + CODE', () => {
    const m = q(RewardType.INVITE_CODE_FCFS);
    expect(m.selection).toBe('FCFS');
    expect(m.reward).toBe('CODE');
    expect(m.allowed).toBe(true);
  });
  it('CC_ONLY + CC → FCFS + TOKEN_CC', () => {
    const m = q(RewardType.CC_ONLY, 'CC');
    expect(m.selection).toBe('FCFS');
    expect(m.reward).toBe('TOKEN_CC');
  });
  it('CC_ONLY + USDCx → FCFS + TOKEN_USDCX (fee tetap CC)', () => {
    const m = q(RewardType.CC_ONLY, 'USDCx');
    expect(m.selection).toBe('FCFS');
    expect(m.reward).toBe('TOKEN_USDCX');
  });

  // ── RAFFLE ──
  it('INVITE_CODE_RANDOM → RAFFLE + CODE', () => {
    const m = q(RewardType.INVITE_CODE_RANDOM);
    expect(m.selection).toBe('RAFFLE');
    expect(m.reward).toBe('CODE');
  });
  it('CC_MANUAL + CC → RAFFLE + TOKEN_CC', () => {
    const m = q(RewardType.CC_MANUAL, 'CC');
    expect(m.selection).toBe('RAFFLE');
    expect(m.reward).toBe('TOKEN_CC');
  });
  it('CC_MANUAL + USDCx → RAFFLE + TOKEN_USDCX', () => {
    const m = q(RewardType.CC_MANUAL, 'USDCx');
    expect(m.reward).toBe('TOKEN_USDCX');
  });
  it('CC_AND_CODE_RAFFLE / CC_AND_INVITE → RAFFLE + TOKEN_AND_CODE', () => {
    expect(q(RewardType.CC_AND_CODE_RAFFLE).reward).toBe('TOKEN_AND_CODE');
    expect(q(RewardType.CC_AND_INVITE).reward).toBe('TOKEN_AND_CODE');
    expect(q(RewardType.CC_AND_CODE_RAFFLE).selection).toBe('RAFFLE');
  });
  it('5 kombinasi final (owner 2026-09-04): FCFS Token+Code DIHAPUS — tipe Code selalu CODE murni', () => {
    expect(q(RewardType.INVITE_CODE_FCFS).reward).toBe('CODE');
    expect(q(RewardType.INVITE_CODE_RANDOM).reward).toBe('CODE');
    // Token+Code hanya via CC_AND_* (raffle)
    expect(q(RewardType.CC_ONLY).reward).toBe('TOKEN_CC');
    expect(q(RewardType.CC_MANUAL).reward).toBe('TOKEN_CC');
  });

  // ── OFFCHAIN / tolak silang ──
  it('WAITLIST_EMAIL → offchain, tanpa klaim on-chain', () => {
    const m = q(RewardType.WAITLIST_EMAIL);
    expect(m.allowed).toBe(false);
    expect(m.selection).toBe('OFFCHAIN');
  });
  it('jalur silang tertolak: CC_MANUAL bukan FCFS, INVITE_CODE_FCFS bukan RAFFLE', () => {
    expect(q(RewardType.CC_MANUAL).selection).not.toBe('FCFS');
    expect(q(RewardType.INVITE_CODE_FCFS).selection).not.toBe('RAFFLE');
  });

  // ── Gate lock ──
  it('entryGateMode CC_ONLY → requiresLock; NONE/POINTS_ONLY → tidak', () => {
    expect(q(RewardType.CC_MANUAL, 'CC', 'CC_ONLY').requiresLock).toBe(true);
    expect(q(RewardType.CC_MANUAL, 'CC', 'CC_OR_POINTS').requiresLock).toBe(true);
    expect(q(RewardType.CC_MANUAL, 'CC', 'NONE').requiresLock).toBe(false);
    expect(q(RewardType.CC_MANUAL, 'CC', 'POINTS_ONLY').requiresLock).toBe(false);
  });
});

describe('v30T1At — penutupan pendaftaran 70% durasi', () => {
  it('T1 = startsAt + 70% durasi', () => {
    const t1 = v30T1At(new Date('2026-09-01T00:00:00Z'), new Date('2026-09-11T00:00:00Z'))!;
    // 10 hari × 70% = 7 hari → 8 Sept.
    expect(t1.toISOString()).toBe('2026-09-08T00:00:00.000Z');
  });
  it('tidak pernah melewati T2 (70% ≥ 100% mustahil, tapi guard tetap)', () => {
    const t1 = v30T1At(new Date('2026-09-10T00:00:00Z'), new Date('2026-09-11T00:00:00Z'))!;
    expect(t1.getTime()).toBeLessThanOrEqual(new Date('2026-09-11T00:00:00Z').getTime());
  });
  it('startsAt kosong → T1 = T2 (tanpa penutupan dini)', () => {
    const t1 = v30T1At(null, new Date('2026-09-11T00:00:00Z'));
    expect(t1?.toISOString()).toBe('2026-09-11T00:00:00.000Z');
  });
  it('endsAt kosong → null (campaign tanpa akhir tidak punya T1)', () => {
    expect(v30T1At(new Date('2026-09-01T00:00:00Z'), null)).toBeNull();
  });
});
