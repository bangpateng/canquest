import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CantonLedgerService } from './canton-ledger.service';
import { parseLockTerms } from './lock-terms';

export type LockTier = 'NONE' | 'FULL';

/**
 * Snapshot LockedAmulet on-chain milik ownerParty, dipakai untuk reconciling
 * baris cc_locks. amount/expiresAt/contractId adalah kebenaran dari chain.
 */
export interface OnChainLockedAmulet {
  contractId: string;
  amount: number;
  expiresAt: string;
  termSeconds: number;
}

/**
 * CC Lock eligibility (non-custodial) — Spec CC Lock CanQuest.
 *
 * Menentukan tier user dari jumlah CC terkunci on-chain:
 *   - ≥ {LOCK_TIER_FULL}  (default 30) → FULL  (boleh ikut Earn)
 *   - else                              → NONE
 *
 * SUMBER KEBENARAN JUMLAH TERKUNCI = on-chain (semangat ATURAN EMAS #4 MD).
 *
 * Catatan rekonsiliasi spec:
 *   MD BAGIAN 2 menyuruh baca `effective_locked_qty` dari Splice wallet balance.
 *   Itu TIDAK jalan di LEDGER_AUTH_MODE=keycloak (splice.getUserBalance() return null
 *   karena wallet REST butuh per-user token yang tidak ada di mode operator). Substitusi terdekat
 *   yang tetap ON-CHAIN (bukan tabel) = jumlahkan field `amount` dari LockedAmulet via
 *   `findLockedAmulets()` (ACS query, admin Keycloak token). Sumber kebenaran tetap chain.
 */
@Injectable()
export class LockEligibilityService {
  private readonly logger = new Logger(LockEligibilityService.name);
  private readonly tierFull: number;

  constructor(
    private readonly config: ConfigService,
    private readonly ledger: CantonLedgerService,
    private readonly prisma: PrismaService,
  ) {
    this.tierFull = Number(this.config.get<string>('LOCK_TIER_FULL') ?? '30');
  }

  /**
   * Jumlah CC terkunci on-chain milik ownerParty.
   * Baca dari LockedAmulet ACS (findLockedAmulets) — keycloak-safe (operator token).
   * Return angka; default 0 jika gagal/null. Tidak melempar error.
   */
  async lockedCcOf(ownerParty: string): Promise<number> {
    if (!ownerParty || ownerParty.startsWith('canquest:')) return 0;
    try {
      const locks = await this.ledger.findLockedAmulets(ownerParty);
      const total = locks.reduce((sum, l) => sum + (Number(l.amount) || 0), 0);
      return Math.max(0, total);
    } catch (err) {
      this.logger.warn(
        `lockedCcOf(${ownerParty.split('::')[0]}) error: ${String(err)}`,
      );
      return 0;
    }
  }

  /** Tier dari jumlah terkunci: ≥FULL → FULL ; else NONE. */
  async tierOf(ownerParty: string): Promise<LockTier> {
    const locked = await this.lockedCcOf(ownerParty);
    return locked >= this.tierFull ? 'FULL' : 'NONE';
  }

  /** Boleh ikut Earn quest (partner campaigns) — butuh tier FULL (≥30 CC). */
  async canJoinEarn(ownerParty: string): Promise<boolean> {
    return (await this.tierOf(ownerParty)) === 'FULL';
  }

  /**
   * Snapshot LockedAmulet on-chain milik ownerParty, lengkap dengan durasi term.
   * Term (detik) dihitung dari selisih expiresAt − lockedAt on-chain, lalu
   * di-match ke LOCK_TERM_OPTIONS supaya termKey konsisten dengan lock normal.
   */
  async getOnChainLockedAmulets(
    ownerParty: string,
  ): Promise<OnChainLockedAmulet[]> {
    if (!ownerParty || ownerParty.startsWith('canquest:')) return [];
    try {
      const raw = await this.ledger.findLockedAmulets(ownerParty);
      // Tabel term key → seconds; dipakai untuk tebak termKey yang paling dekat.
      const { map } = parseLockTerms(
        this.config.get<string>('LOCK_TERM_OPTIONS'),
      );
      const termSecondsList = [...map.values()].sort((a, b) => a - b);
      return raw.map((l) => {
        const expiresMs = Date.parse(l.expiresAt);
        // LockedAmulet tidak selalu expose createdAt; fallback ke now bila kosong.
        const lockedAtMs = Date.now();
        const termSeconds = Number.isFinite(expiresMs)
          ? Math.max(1, Math.round((expiresMs - lockedAtMs) / 1000))
          : 0;
        const termKey = this.bestTermKey(map, termSeconds, termSecondsList);
        return {
          contractId: l.contractId,
          amount: Number(l.amount) || 0,
          expiresAt: l.expiresAt,
          // Simpan detik asli (bukan termKey) supaya countdown UI akurat walau
          // tidak ada termKey yang persis cocok.
          termSeconds,
        };
      });
    } catch (err) {
      this.logger.warn(
        `getOnChainLockedAmulets(${ownerParty.split('::')[0]}) error: ${String(err)}`,
      );
      return [];
    }
  }

  /** Pilih termKey dari LOCK_TERM_OPTIONS yang paling mendekati durasi on-chain. */
  private bestTermKey(
    map: Map<string, number>,
    seconds: number,
    sortedSeconds: number[],
  ): string {
    if (map.size === 0 || sortedSeconds.length === 0) return '';
    // Cari match persis dulu.
    for (const [key, secs] of map) {
      if (secs === seconds) return key;
    }
    // Fallback: term dengan selisih terkecil.
    let best: string | null = null;
    let bestDiff = Infinity;
    for (const [key, secs] of map) {
      const diff = Math.abs(secs - seconds);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = key;
      }
    }
    return best ?? '';
  }

  /**
   * RECONCILE: deteksi LockedAmulet on-chain yang TIDAK punya baris cc_locks
   * (kasus: lock sukses on-chain tapi DB row gagal dibuat → orphan/stuck).
   *
   * Untuk setiap orphan, backfill baris LOCKED dengan lockedAmuletCid asli dari
   * chain. Setelah itu lock muncul di activeLocks[] dan user bisa unlock via UI.
   *
   * Idempoten: di-match per lockedAmuletCid, jadi aman dipanggil berulang.
   * Tidak menghapus/ubah baris existing — hanya menambah yang hilang.
   *
   * @returns jumlah baris baru yang dibuat (0 = sudah sinkron).
   */
  async reconcileLocksWithChain(
    ownerParty: string,
    userId: string,
  ): Promise<number> {
    if (!ownerParty || ownerParty.startsWith('canquest:')) return 0;

    const [onChain, dbRows] = await Promise.all([
      this.getOnChainLockedAmulets(ownerParty),
      this.prisma.ccLock.findMany({
        where: { ownerParty, lockedAmuletCid: { not: null } },
        select: { lockedAmuletCid: true },
      }),
    ]);
    if (onChain.length === 0) return 0;

    const knownCids = new Set(
      dbRows
        .map((r) => r.lockedAmuletCid)
        .filter((c): c is string => !!c && c.length > 0),
    );

    // Orphan = LockedAmulet on-chain tanpa baris DB (match by contractId).
    const orphans = onChain.filter((l) => !knownCids.has(l.contractId));
    if (orphans.length === 0) return 0;

    const { map } = parseLockTerms(
      this.config.get<string>('LOCK_TERM_OPTIONS'),
    );

    let created = 0;
    for (const lock of orphans) {
      const expiresMs = Date.parse(lock.expiresAt);
      if (!Number.isFinite(expiresMs)) {
        this.logger.warn(
          `reconcile: skip orphan cid=${lock.contractId.slice(0, 16)}… (expiresAt invalid)`,
        );
        continue;
      }
      const expiresAt = new Date(expiresMs);
      const termSeconds = lock.termSeconds || 0;
      const termKey = this.bestTermKey(
        map,
        termSeconds,
        [...map.values()].sort((a, b) => a - b),
      );
      const lockedAt = new Date(Math.max(0, expiresMs - termSeconds * 1000));

      try {
        await this.prisma.ccLock.create({
          data: {
            ownerParty,
            userId,
            amountCc: lock.amount,
            termKey: termKey || `chain-${termSeconds}s`,
            lockSeconds: termSeconds,
            lockedAt,
            expiresAt,
            status: 'LOCKED',
            // Sidik jari bahwa row ini berasal dari reconcile (audit/debug).
            lockedAmuletCid: lock.contractId,
          },
        });
        created++;
        this.logger.log(
          `reconcile: backfilled orphan LockedAmulet cid=${lock.contractId.slice(0, 16)}… ` +
            `amount=${lock.amount} owner=${ownerParty.split('::')[0]} expires=${expiresAt.toISOString()}`,
        );
      } catch (err) {
        // P2002 (unique) tidak mungkin di sini (cid unik), tapi jaga-jaga: skip.
        this.logger.warn(
          `reconcile: failed to backfill cid=${lock.contractId.slice(0, 16)}… : ${String(err)}`,
        );
      }
    }
    return created;
  }
}
