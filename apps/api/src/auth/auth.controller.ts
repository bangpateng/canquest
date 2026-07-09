import {
  Body,
  Controller,
  Delete,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { Throttle, SkipThrottle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { UploadAvatarDto } from './dto/upload-avatar.dto';
import { ProfileAvatarService } from '../users/profile-avatar.service';

type AuthedReq = Request & { user: { userId: string; email: string } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly avatars: ProfileAvatarService,
  ) {}

  /**
   * Register — ketat: 10 req/menit (auth tier).
   *
   * Endpoint ini adalah ORKESTRATOR registrasi (validasi email anti-sybil,
   * referral, displayName, buat row User). Password storage & session ada di
   * Supabase Auth (saat SUPABASE_AUTH_ENABLED=true) atau hash lokal (legacy).
   * Frontend bertanggung jawab mendapatkan session setelah ini.
   */
  @Post('register')
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  register(@Body() body: RegisterDto) {
    return this.auth.register(body);
  }

  /**
   * /me — skip throttle, ringan & sering dipanggil oleh frontend.
   * Diproteksi AuthGuard('jwt') yang dispatch HS256 legacy atau Supabase RS256
   * sesuai feature flag.
   */
  @Get('me')
  @UseGuards(AuthGuard('jwt'))
  @SkipThrottle()
  me(@Req() req: AuthedReq) {
    return this.auth.getMe(req.user.userId);
  }

  /**
   * Mint token SSE ephemeral (60s) untuk connect ke /api/realtime/stream.
   * Diproteksi access token utama (AuthGuard jwt) — userId sudah terverifikasi.
   * Throttle longgar (30/menit) karena token cepat expired & butuh di-refresh
   * tiap ~50 detik selama sesi SSE aktif.
   */
  @Post('sse-token')
  @UseGuards(AuthGuard('jwt'))
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  sseToken(@Req() req: AuthedReq) {
    return this.auth.issueSseToken(req.user.userId);
  }

  @Post('me/avatar')
  @UseGuards(AuthGuard('jwt'))
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  uploadAvatar(@Req() req: AuthedReq, @Body() body: UploadAvatarDto) {
    return this.avatars.setFromDataUrl(req.user.userId, body.image);
  }

  @Delete('me/avatar')
  @UseGuards(AuthGuard('jwt'))
  removeAvatar(@Req() req: AuthedReq) {
    return this.avatars.remove(req.user.userId);
  }
}
