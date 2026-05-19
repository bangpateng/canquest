import {
  Body,
  Controller,
  Get,
  InternalServerErrorException,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';

import { AdminLoginDto } from './dto/admin-login.dto';

type AdminReqUser = { adminPanel: true; email: string };
type AdminAuthedReq = Request & { user: AdminReqUser };

@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  @Post('login')
  async login(@Body() login: AdminLoginDto): Promise<{ accessToken: string }> {
    const norm = (s: string | undefined) =>
      s === undefined ? '' : s.replace(/^\ufeff/, '').trim();

    // Config often misses vars when workspaces start Nest from repo root; loadEnv order + fallback.
    const expectedEmail =
      norm(this.config.get<string>('ADMIN_PANEL_EMAIL'))?.toLowerCase() ||
      norm(process.env.ADMIN_PANEL_EMAIL)?.toLowerCase();

    const expectedPass =
      norm(this.config.get<string>('ADMIN_PANEL_PASSWORD')) ||
      norm(process.env.ADMIN_PANEL_PASSWORD);

    if (!expectedEmail || !expectedPass) {
      throw new InternalServerErrorException(
        [
          'Admin panel credentials are not configured (ADMIN_PANEL_EMAIL / ADMIN_PANEL_PASSWORD).',
          'Set them in apps/api/.env or ensure no empty OS-level env duplicates those names, then restart the API.',
        ].join(' '),
      );
    }

    const email = login.email.trim().toLowerCase();
    if (email !== expectedEmail || login.password !== expectedPass) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const accessToken = await this.jwt.signAsync(
      { scope: 'admin-panel', email },
      {
        subject: 'admin-panel',
        expiresIn: '8h',
      },
    );
    return { accessToken };
  }

  /** Check whether the Bearer token is a valid panel session. */
  @Get('me')
  @UseGuards(AuthGuard('admin-jwt'))
  me(@Req() req: AdminAuthedReq) {
    return { ok: true, email: req.user.email };
  }
}
