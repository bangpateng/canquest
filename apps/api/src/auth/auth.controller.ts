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
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UploadAvatarDto } from './dto/upload-avatar.dto';
import { ProfileAvatarService } from '../users/profile-avatar.service';

type AuthedReq = Request & { user: { userId: string; email: string } };

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly avatars: ProfileAvatarService,
  ) {}

  /** Register — ketat: 10 req/menit (auth tier) */
  @Post('register')
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  register(@Body() body: RegisterDto) {
    return this.auth.register(body);
  }

  /** OTP verify — ketat sama seperti register */
  @Post('verify-otp')
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  verifyOtp(@Body() body: VerifyOtpDto) {
    return this.auth.verifyOtp(body.userId, body.code);
  }

  /** Login — ketat: 10 req/menit per IP, cegah brute-force */
  @Post('login')
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  login(@Body() body: LoginDto) {
    return this.auth.login(body);
  }

  /**
   * Refresh token.
   * SECURITY (M2): previously had NO @Throttle, falling through to the default
   * tier (300 req/min/IP). That allowed a stolen refresh token to be hammered
   * 300×/min — minting a new access token + refresh row on every call (token-
   * fountain amplification, DB bloat). 30/min is plenty for legitimate use
   * (tokens expire every 15 min, so a normal session refreshes ~4×/hour) while
   * capping abuse. Tighter than default, looser than login (no password here).
   */
  @Post('refresh')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  refresh(@Body() body: RefreshTokenDto) {
    return this.auth.refresh(body.refreshToken);
  }

  /** Forgot password — generik (anti-enumerasi), 10 req/menit. */
  @Post('forgot-password')
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  forgotPassword(@Body() body: ForgotPasswordDto) {
    return this.auth.forgotPassword(body.email);
  }

  /** Reset password — verifikasi kode + ganti password, 10 req/menit. */
  @Post('reset-password')
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  resetPassword(@Body() body: ResetPasswordDto) {
    return this.auth.resetPassword(body.email, body.code, body.newPassword);
  }

  /** /me — skip throttle, ringan & sering dipanggil oleh frontend */
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
