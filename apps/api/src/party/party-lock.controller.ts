/**
 * Lock/unlock CC + terms & status.
 *
 * Diekstraksi dari party.controller.ts — route path & behavior identik.
 */
import { AuthGuard } from '@nestjs/passport';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Logger,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { CantonLedgerService } from '../canton/canton-ledger.service';
import { ConfigService } from '@nestjs/config';
import { LockCcDto } from './dto/lock-cc.dto';
import { LockEligibilityService } from '../canton/lock-eligibility.service';
import { PrismaService } from '../prisma/prisma.service';
import { SkipThrottle } from '@nestjs/throttler';
import { UnlockCcDto } from './dto/unlock-cc.dto';
import { UsersService } from '../users/users.service';
import { hasRealWallet } from '../common/wallet-policy';
import { parseLockTerms } from '../canton/lock-terms';
import type { AuthedReq } from './party-shared';

/** Lock/unlock CC + terms & status. Prefix & guard sama dengan controller party lama. */
@Controller('party')
@UseGuards(AuthGuard('jwt'))
export class PartyLockController {
  private readonly logger = new Logger(PartyLockController.name);

  constructor(
    private readonly users: UsersService,
    private readonly ledger: CantonLedgerService,
    private readonly config: ConfigService,
    private readonly lockEligibility: LockEligibilityService,
    private readonly prisma: PrismaService,
  ) {}

  // Catatan: endpoint legacy accept-offer/reject-offer telah dihapus. Accept &
  // reject (baik legacy Splice TransferOffer maupun CIP-0056 TransferInstruction)
  // sekarang terpusat di POST /party/offers/accept dan /party/offers/reject,
  // yang auto-detect jenis offer. Lihat acceptOfferInbox / rejectOfferInbox.
  // ═══════════════════════════════════════════════════════════════════════════
  // CC LOCK — Spec CC Lock CanQuest (CC stays owned by user's party; returned at expiry)
  // ownerParty di-resolve dari user login (JANGAN terima ownerParty mentah dari body).
  // ═══════════════════════════════════════════════════════════════════════════
  /** Helper: parse LOCK_TERM_OPTIONS sekali per request (murah, string kecil). */
  private getLockTerms() {
    return parseLockTerms(this.config.get<string>('LOCK_TERM_OPTIONS'));
  }

  @Post('lock')
  async lockCc(@Req() req: AuthedReq, @Body() body: LockCcDto) {
    const user = await this.users.findById(req.user.userId);
    
    // M5: custodial path removed — reject custodial users
    if (user?.walletKind === 'custodial') {
      throw new BadRequestException(
        'Custodial wallets are deprecated. Please upgrade to a non-custodial wallet.',
      );
    }

    if (!user?.cantonPartyId || !hasRealWallet(user.cantonPartyId)) {
      throw new BadRequestException(
        'No wallet found. Create your wallet first.',
      );
    }
    const ownerParty = user.cantonPartyId;

    const { map } = this.getLockTerms();
    const seconds = map.get(body.termKey);
    if (seconds === undefined) {
      throw new BadRequestException(`term "${body.termKey}" tidak valid`);
    }
    const amountCc = Number(body.amountCc);
    if (!Number.isFinite(amountCc) || amountCc <= 0) {
      throw new BadRequestException('amountCc must be greater than 0.');
    }

    this.logger.log(
      `lockCc: user=@${user.username} amount=${amountCc} term=${body.termKey} (${seconds}s)`,
    );

    const result = await this.ledger.lockCc(ownerParty, amountCc, seconds);
    if (!result.ok) {
      return { ok: false, error: result.error ?? 'lock gagal' };
    }

    // Metadata di cc_locks (sumber kebenaran jumlah tetap on-chain; tabel = metadata + UI)
    const lockedAt = new Date();
    const expiresAt = new Date(lockedAt.getTime() + seconds * 1000);
    let lockRow: { id: string } | null = null;
    try {
      lockRow = await this.prisma.ccLock.create({
        data: {
          ownerParty,
          userId: user.id,
          amountCc,
          termKey: body.termKey,
          lockSeconds: seconds,
          lockedAt,
          expiresAt,
          status: 'LOCKED',
          lockedAmuletCid: result.lockedAmuletCid ?? null,
        },
      });
    } catch (err) {
      // Lock inti SUDAH sukses on-chain (LockedAmulet mendarat). Kegagalan tulis
      // baris metadata DB TIDAK boleh membatalkan lock. Reconciler di lock-status
      // akan backfill baris dari chain (match by lockedAmuletCid) sehingga lock
      // tetap muncul di UI & unlockable.
      this.logger.error(
        `lockCc: on-chain sukses tapi ccLock.create gagal user=${user.id.slice(0, 8)} ` +
          `cid=${(result.lockedAmuletCid ?? '?').slice(0, 16)}… : ${String(err)} — reconcile akan backfill.`,
      );
    }

    // Catat ke history transaksi (tampilan). Idempotensi via @@unique(userId, ledgerTxId):
    // ledgerTxId = Canton update_id ("1220…") → handler ulang tidak akan mendobel-catat,
    // dan link explorer Modo langsung jalan. lockedAmuletCid tersimpan terpisah di
    // ccLocks (dipakai saat unlock), tidak perlu duplikat di kolom cantonUpdateId.
    if (result.updateId || result.lockedAmuletCid) {
      try {
        await this.users.recordTransaction({
          userId: user.id,
          amountCc,
          type: 'CC_LOCK',
          description: 'CC Locked',
          referenceId: lockRow?.id,
          // ledgerTxId + cantonUpdateId = Canton update_id supaya link explorer jalan.
          // Fallback ke lockedAmuletCid (contract_id) bila updateId tidak ter-parse —
          // link akan di-resolve lazy via Modo /v1/contracts/{id}.
          ledgerTxId: result.updateId ?? result.lockedAmuletCid,
          cantonUpdateId: result.updateId ?? undefined,
        });
      } catch (err) {
        // P2002 = sudah ada (idempoten). Selain itu: non-fatal — lock inti tetap sukses.
        this.logger.warn(`CC_LOCK history record failed: ${String(err)}`);
      }
    }

    return {
      ok: true,
      expiresAt,
      lockId: lockRow?.id,
      lockedAmuletCid: result.lockedAmuletCid ?? null,
    };
  }

  @Post('unlock')
  async unlockCc(@Req() req: AuthedReq, @Body() body: UnlockCcDto) {
    const user = await this.users.findById(req.user.userId);
    if (!user?.cantonPartyId || !hasRealWallet(user.cantonPartyId)) {
      throw new BadRequestException(
        'No wallet found. Create your wallet first.',
      );
    }
    const ownerParty = user.cantonPartyId;

    // Pilih lock: by lockId, else expired paling awal milik user.
    let lock = null as null | {
      id: string;
      lockedAmuletCid: string | null;
      expiresAt: Date;
      amountCc: any;
    };
    if (body.lockId?.trim()) {
      lock = await this.prisma.ccLock.findFirst({
        where: { id: body.lockId.trim(), ownerParty, status: 'LOCKED' },
      });
      if (!lock)
        throw new BadRequestException(
          'Lock tidak ditemukan atau sudah tidak aktif.',
        );
    } else {
      const now = new Date();
      lock = await this.prisma.ccLock.findFirst({
        where: { ownerParty, status: 'LOCKED', expiresAt: { lte: now } },
        orderBy: { expiresAt: 'asc' },
      });
      if (!lock) {
        throw new BadRequestException(
          'Tidak ada lock yang siap di-unlock saat ini.',
        );
      }
    }

    // Guard backend (ledger juga menolak; ini untuk pesan rapi).
    if (lock.expiresAt.getTime() > Date.now()) {
      const tanggal = lock.expiresAt.toLocaleString('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
      throw new BadRequestException(`Belum bisa unlock sampai ${tanggal}.`);
    }

    this.logger.log(
      `unlockCc: user=@${user.username} lockId=${lock.id} cid=${(lock.lockedAmuletCid ?? '?').slice(0, 16)}…`,
    );

    const result = await this.ledger.unlockCc(
      ownerParty,
      lock.lockedAmuletCid ?? undefined,
    );
    if (!result.ok) {
      return { ok: false, error: result.error ?? 'unlock failed' };
    }

    await this.prisma.ccLock.update({
      where: { id: lock.id },
      data: { status: 'UNLOCKED', unlockedAt: new Date() },
    });

    // Catat ke history transaksi (tampilan). Idempotensi via @@unique(userId, ledgerTxId):
    // ledgerTxId + cantonUpdateId = Canton update_id ASLI dari exercise (link Modo benar).
    // Relasi ke lock asli disimpan di referenceId (lock.id); lockedAmuletCid asli tetap
    // di ccLocks. Bila updateId tidak ter-parse, ledgerTxId null → link explorer
    // disembunyikan (bukan marker palsu).
    try {
      await this.users.recordTransaction({
        userId: user.id,
        amountCc: Number(lock.amountCc),
        type: 'CC_UNLOCK',
        description: 'CC Unlocked',
        referenceId: lock.id,
        ledgerTxId: result.updateId ?? undefined,
        cantonUpdateId: result.updateId ?? undefined,
      });
    } catch (err) {
      // P2002 = sudah ada (idempoten). Selain itu: non-fatal — unlock inti tetap sukses.
      this.logger.warn(`CC_UNLOCK history record failed: ${String(err)}`);
    }

    return { ok: true, lockId: lock.id };
  }

  /**
   * GET /party/lock-terms — daftar pilihan term dari LOCK_TERM_OPTIONS.
   * UI render tombol durasi dari sini (BUKAN hard-code 7/15/30).
   */
  @SkipThrottle()
  @Get('lock-terms')
  lockTerms() {
    const { options } = this.getLockTerms();
    return { terms: options };
  }

  /**
   * GET /party/lock-status — status lock user.
   * lockedCc dari on-chain (lockEligibility.lockedCcOf); activeLocks dari cc_locks.
   * Countdown DIHITUNG DI FRONTEND dari expiresAt.
   *
   * RECONCILE: sebelum query activeLocks, selaraskan dulu tabel cc_locks dengan
   * LockedAmulet on-chain. Ini menutup celah "lock sukses di chain tapi row DB
   * gagal dibuat" (mis. frontend error setelah tx on-chain sukses) → CC tetap
   * terkunci di chain tapi TIDAK muncul di UI → user tidak bisa unlock. Dengan
   * reconcile, orphan LockedAmulet di-backfill jadi baris LOCKED sehingga muncul
   * di activeLocks[] dan jadi unlockable. Idempoten & best-effort (non-fatal).
   */
  @SkipThrottle()
  @Get('lock-status')
  async lockStatus(@Req() req: AuthedReq) {
    const user = await this.users.findById(req.user.userId);
    if (!user?.cantonPartyId || !hasRealWallet(user.cantonPartyId)) {
      return {
        lockedCc: 0,
        availableCc: null,
        tier: 'NONE' as const,
        activeLocks: [],
        hasWallet: false,
      };
    }
    const ownerParty = user.cantonPartyId;

    // ── Reconcile: backfill orphan LockedAmulet (lock on-chain, DB row hilang) ──
    try {
      const backfilled = await this.lockEligibility.reconcileLocksWithChain(
        ownerParty,
        user.id,
      );
      if (backfilled > 0) {
        this.logger.log(
          `lock-status reconcile: backfilled ${backfilled} orphan lock(s) for user=${user.id.slice(0, 8)}`,
        );
      }
    } catch (err) {
      // Non-fatal: status tetap dikembalikan (hanya reconcile yang skip).
      this.logger.warn(`lock-status reconcile failed: ${String(err)}`);
    }

    const [lockedCc, tier, activeLocks, balanceRow] = await Promise.all([
      this.lockEligibility.lockedCcOf(ownerParty),
      this.lockEligibility.tierOf(ownerParty),
      this.prisma.ccLock.findMany({
        where: { ownerParty, status: 'LOCKED' },
        orderBy: { expiresAt: 'asc' },
      }),
      this.prisma.ccBalance.findUnique({
        where: { userId: user.id },
        select: { balanceMicroCc: true },
      }),
    ]);

    // availableCc opsional (untuk tombol MAX di modal). Dari snapshot DB balance.
    const availableCc = balanceRow
      ? Number(balanceRow.balanceMicroCc) / 1_000_000
      : null;

    return {
      lockedCc,
      availableCc,
      tier,
      activeLocks: activeLocks.map((l) => ({
        id: l.id,
        amountCc: Number(l.amountCc),
        termKey: l.termKey,
        lockSeconds: l.lockSeconds,
        expiresAt: l.expiresAt.toISOString(),
        lockedAmuletCid: l.lockedAmuletCid,
      })),
      hasWallet: true,
    };
  }
}
