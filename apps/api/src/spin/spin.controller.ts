import {
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { SpinService } from './spin.service';
import { UsersService } from '../users/users.service';

type AuthedReq = Request & { user: { userId: string; email: string } };

@Controller('spin')
@UseGuards(AuthGuard('jwt'))
export class SpinController {
  constructor(
    private readonly spin: SpinService,
    private readonly users: UsersService,
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

    const result = await this.spin.executeSpin(
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
