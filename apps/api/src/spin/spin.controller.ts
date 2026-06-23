import {
  Controller,
  ForbiddenException,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { WalletRequiredGuard } from '../common/wallet-required.guard';
import { LockEligibilityService } from '../canton/lock-eligibility.service';
import { SpinService } from './spin.service';
import { UsersService } from '../users/users.service';

type AuthedReq = Request & { user: { userId: string; email: string } };

@Controller('spin')
@UseGuards(AuthGuard('jwt'), WalletRequiredGuard)
export class SpinController {
  constructor(
    private readonly spin: SpinService,
    private readonly users: UsersService,
    private readonly lockEligibility: LockEligibilityService,
  ) {}

  // ── Public endpoints ───────────────────────────────────────────────────────

  /** Ambil daftar spin items aktif untuk ditampilkan di UI wheel. */
  @Get('items')
  getItems() {
    return this.spin.listItems();
  }

  /** Points available for spin + cost per spin. */
  @Get('state')
  async getState(@Req() req: AuthedReq) {
    return this.spin.getSpinState(req.user.userId);
  }

  /**
   * Execute spin — user menggunakan points untuk spin.
   * Rate-limited: 5x per menit (ledger tier) untuk cegah abuse.
   */
  @Post('execute')
  @Throttle({ ledger: { limit: 5, ttl: 60_000 } })
  async executeSpin(@Req() req: AuthedReq) {
    const user = await this.users.findById(req.user.userId);
    if (!user) return { ok: false, message: 'User not found' };

    // CC Lock guard (Spec CC Lock BAGIAN 4): Spin butuh ≥5 CC terkunci.
    // Setelah guard lolos, logika potong points di service JANGAN diubah.
    if (user.cantonPartyId && !(await this.lockEligibility.canSpin(user.cantonPartyId))) {
      throw new ForbiddenException('Kunci minimal 5 CC untuk Spin');
    }

    const result = await this.spin.executeSpin(
      user.id,
      user.username ?? null,
      user.cantonPartyId ?? null,
    );

    return { ok: true, ...result };
  }

  /**
   * Free daily spin — 1x per hari, tanpa biaya points.
   * Rate-limited: 2x per menit (cegah spam klik).
   */
  @Post('free')
  @Throttle({ ledger: { limit: 2, ttl: 60_000 } })
  async executeFreeSpin(@Req() req: AuthedReq) {
    const user = await this.users.findById(req.user.userId);
    if (!user) return { ok: false, message: 'User not found' };

    // CC Lock guard (Spec CC Lock BAGIAN 4): Spin (termasuk free) butuh ≥5 CC terkunci.
    if (user.cantonPartyId && !(await this.lockEligibility.canSpin(user.cantonPartyId))) {
      throw new ForbiddenException('Kunci minimal 5 CC untuk Spin');
    }

    const result = await this.spin.executeFreeSpin(
      user.id,
      user.username ?? null,
      user.cantonPartyId ?? null,
    );

    return { ok: true, ...result };
  }

  /** Riwayat spin user yang login. */
  @Get('history')
  async getHistory(
    @Req() req: AuthedReq,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const p = Math.max(1, parseInt(page ?? '1', 10) || 1);
    const ps = Math.min(20, Math.max(1, parseInt(pageSize ?? '10', 10) || 10));
    return this.spin.getUserHistory(req.user.userId, p, ps);
  }

  // Admin endpoints dipindah ke SpinAdminController (src/spin/spin-admin.controller.ts)
  // prefix: GET|POST|PATCH|DELETE /api/admin/spin/...
}
