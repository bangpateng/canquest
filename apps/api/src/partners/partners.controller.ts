import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { PartnersService } from './partners.service';

type AuthedReq = Request & { user: { userId: string; email: string } };

@Controller('partners')
@UseGuards(AuthGuard('jwt'))
export class PartnersController {
  constructor(private readonly partners: PartnersService) {}

  /** Meta ecosystem: kategori (admin-managed) + social links global. */
  @SkipThrottle()
  @Get('meta')
  meta() {
    return this.partners.getMeta();
  }

  /** Daftar partner ecosystem (published) — ?category= & ?q= opsional. */
  @SkipThrottle()
  @Get()
  list(
    @Query('category') category: string | undefined,
    @Query('q') q: string | undefined,
    @Req() req: AuthedReq,
  ) {
    return this.partners.listPublished(category, q, req.user.userId);
  }

  /** Detail partner (modal ecosystem). */
  @SkipThrottle()
  @Get(':id')
  detail(@Param('id') id: string) {
    return this.partners.getById(id);
  }

  /** Toggle like — siapa pun user, tanpa batas waktu (throttle ringan anti spam). */
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  @Post(':id/like')
  like(@Param('id') id: string, @Req() req: AuthedReq) {
    return this.partners.toggleLike(id, req.user.userId);
  }
}
