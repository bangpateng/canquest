/**
 * Claim & Lock v30 (paket canquest-claim + canquest-lock) — endpoint user.
 *
 * Dipilih PER QUEST lewat Quest.ledgerPackage === 'canquest-v30'. Quest v29
 * lama tidak pernah menyentuh controller ini (jalur lamanya tetap utuh).
 *
 * Alur klaim (AGENT.md §"Alur klaim"):
 *   GET  /quests/:questId/claim-v30/status   → pre-checks + status receipt
 *   POST /quests/:questId/claim-v30/prepare  → hash utk ditandatangani browser
 *        (browser sign → POST /party/sign/execute — relay generik)
 *   POST /quests/:questId/claim-v30/reveal   → tampilkan kode (setelah Settled)
 *
 * Alur lock (LOCK-SPEC.md):
 *   POST /quests/:questId/lock-v30           → backend buat LockProposal (T0)
 *   POST /quests/:questId/lock-v30/prepare   → hash AcceptLock utk browser
 *   GET  /quests/:questId/lock-v30/status    → status + jendela proposal
 *
 * Semua prepare memakai signing relay — kunci private user TIDAK PERNAH keluar
 * browser; backend hanya membangun command + menyimpan hash.
 */
import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { SigningRelayService } from '../canton/signing-relay.service';
import { ClaimOfferService } from '../canton/v30/claim-offer.service';
import { LockProposalService } from '../canton/v30/lock-proposal.service';
import { UsersService } from '../users/users.service';

type AuthedReq = Request & { user: { userId: string; email: string } };

@Controller('quests')
@UseGuards(AuthGuard('jwt'))
export class ClaimsV30Controller {
  constructor(
    private readonly relay: SigningRelayService,
    private readonly claims: ClaimOfferService,
    private readonly locks: LockProposalService,
    private readonly users: UsersService,
  ) {}

  /** Assert user punya wallet aktif (403 kalau belum). */
  private async requireWallet(userId: string): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user?.cantonPartyId) {
      throw new ForbiddenException(
        'A Canton wallet is required for this action.',
      );
    }
  }

  // ── Claim (ClaimOffer → Accept* → ClaimReceipt) ──────────────────────────

  /** Pre-checks UI-STATES.md: cek SEBELUM tombol/tanda tangan, bukan setelah gagal. */
  @Get(':questId/claim-v30/status')
  async claimStatus(@Req() req: AuthedReq, @Param('questId') questId: string) {
    await this.requireWallet(req.user.userId);
    return this.claims.claimStatus(questId, req.user.userId);
  }

  /**
   * Prepare Accept* — SATU ExerciseCommand. Jendela tanda tangan 10 menit
   * (TTL relay). FCFS: offer dibuat on-the-fly di sini (winner = peminang
   * pertama; WinnerDraw unique constraint = jaring anti double).
   */
  @Post(':questId/claim-v30/prepare')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async prepareClaim(
    @Req() req: AuthedReq,
    @Param('questId') questId: string,
    @Body() body: { fcfs?: boolean },
  ) {
    const userId = req.user.userId;
    await this.requireWallet(userId);

    if (body?.fcfs) {
      // FCFS v30: WinnerDraw + offer dibuat on-the-fly (peminang kedua kalah
      // di constraint unique / kuota penuh).
      const made = await this.claims.createOfferForFcfs(questId, userId);
      if (!made.ok) {
        throw new BadRequestException(made.error);
      }
    }
    return this.relay.prepare(userId, 'accept_claim_offer', { questId });
  }

  /** RevealCode — backend actAs admin; kode dipaparkan SETELAH fee settle. */
  @Post(':questId/claim-v30/reveal')
  async reveal(@Req() req: AuthedReq, @Param('questId') questId: string) {
    await this.requireWallet(req.user.userId);
    const res = await this.claims.revealIfSettled(questId, req.user.userId);
    return { code: res.code, status: res.status };
  }

  // ── Lock (LockProposal → AcceptLock → LockedAmulet holders=[validator]) ──

  @Post(':questId/lock-v30')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async createLock(@Req() req: AuthedReq, @Param('questId') questId: string) {
    await this.requireWallet(req.user.userId);
    return this.locks.createProposal(questId, req.user.userId);
  }

  @Post(':questId/lock-v30/prepare')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async prepareLock(@Req() req: AuthedReq, @Param('questId') questId: string) {
    await this.requireWallet(req.user.userId);
    return this.relay.prepare(req.user.userId, 'accept_lock_proposal', { questId });
  }

  @Get(':questId/lock-v30/status')
  async lockStatus(@Req() req: AuthedReq, @Param('questId') questId: string) {
    return this.locks.lockStatus(questId, req.user.userId);
  }
}
