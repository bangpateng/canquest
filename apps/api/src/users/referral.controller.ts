import { Controller, Get, Headers, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { ReferralService } from './referral.service';

type AuthedReq = Request & { user: { userId: string; email: string } };

@Controller('referral')
export class ReferralController {
  constructor(private readonly referral: ReferralService) {}

  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  @SkipThrottle()
  me(@Req() req: AuthedReq, @Headers('x-site-origin') siteOrigin?: string) {
    return this.referral.getStats(req.user.userId, siteOrigin);
  }
}
