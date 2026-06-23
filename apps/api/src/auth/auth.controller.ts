import { Body, Controller, Delete, Get, Post, Req, UseGuards } from '@nestjs/common';
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

  /** Refresh token — default tier (120/mnt) */
  @Post('refresh')
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

