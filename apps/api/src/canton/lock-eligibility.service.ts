import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CantonLedgerService } from './canton-ledger.service';

export type LockTier = 'NONE' | 'SPIN' | 'FULL';

/**
 * CC Lock eligibility (non-custodial) — Spec CC Lock CanQuest.
 *
 * Menentukan tier user dari jumlah CC terkunci on-chain:
 *   - ≥ {LOCK_TIER_FULL}  (default 30) → FULL  (Earn quest + Spin)
 *   - ≥ {LOCK_TIER_SPIN}  (default 5)  → SPIN  (Spin saja)
 *   - else                              → NONE
 *
 * SUMBER KEBENARAN JUMLAH TERKUNCI = on-chain (semangat ATURAN EMAS #4 MD).
 *
 * Catatan rekonsiliasi spec:
 *   MD BAGIAN 2 menyuruh baca `effective_locked_qty` dari Splice wallet balance.
 *   Itu TIDAK jalan di LEDGER_AUTH_MODE=keycloak (splice.getUserBalance() return null
 *   karena wallet REST butuh HS256 per-user yang ditolak validator). Substitusi terdekat
 *   yang tetap ON-CHAIN (bukan tabel) = jumlahkan field `amount` dari LockedAmulet via
 *   `findLockedAmulets()` (ACS query, admin Keycloak token). Sumber kebenaran tetap chain.
 */
@Injectable()
export class LockEligibilityService {
  private readonly logger = new Logger(LockEligibilityService.name);
  private readonly tierFull: number;
  private readonly tierSpin: number;

  constructor(
    private readonly config: ConfigService,
    private readonly ledger: CantonLedgerService,
  ) {
    this.tierFull = Number(this.config.get<string>('LOCK_TIER_FULL') ?? '30');
    this.tierSpin = Number(this.config.get<string>('LOCK_TIER_SPIN') ?? '5');
  }

  /**
   * Jumlah CC terkunci on-chain milik ownerParty.
   * Baca dari LockedAmulet ACS (findLockedAmulets) — keycloak-safe, tidak butuh HS256.
   * Return angka; default 0 jika gagal/null. Tidak melempar error.
   */
  async lockedCcOf(ownerParty: string): Promise<number> {
    if (!ownerParty || ownerParty.startsWith('canquest:')) return 0;
    try {
      const locks = await this.ledger.findLockedAmulets(ownerParty);
      const total = locks.reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
      return Math.max(0, total);
    } catch (err) {
      this.logger.warn(`lockedCcOf(${ownerParty.split('::')[0]}) error: ${String(err)}`);
      return 0;
    }
  }

  /** Tier dari jumlah terkunci: ≥FULL → FULL ; ≥SPIN → SPIN ; else NONE. */
  async tierOf(ownerParty: string): Promise<LockTier> {
    const locked = await this.lockedCcOf(ownerParty);
    if (locked >= this.tierFull) return 'FULL';
    if (locked >= this.tierSpin) return 'SPIN';
    return 'NONE';
  }

  /** Boleh ikut Earn quest (partner campaigns) — butuh tier FULL (≥30 CC). */
  async canJoinEarn(ownerParty: string): Promise<boolean> {
    return (await this.tierOf(ownerParty)) === 'FULL';
  }

  /** Boleh Spin — tier apa pun selain NONE (≥5 CC). */
  async canSpin(ownerParty: string): Promise<boolean> {
    return (await this.tierOf(ownerParty)) !== 'NONE';
  }
}
