import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';

import type { Request } from 'express';

import { AuthGuard } from '@nestjs/passport';

import { AuthService } from './auth.service';

import { LoginDto } from './dto/login.dto';

import { RefreshTokenDto } from './dto/refresh-token.dto';

import { RegisterDto } from './dto/register.dto';

import { VerifyOtpDto } from './dto/verify-otp.dto';



type AuthedReq = Request & { user: { userId: string; email: string } };



@Controller('auth')

export class AuthController {

  constructor(private readonly auth: AuthService) {}



  @Post('register')

  register(@Body() body: RegisterDto) {

    return this.auth.register(body);

  }



  @Post('verify-otp')

  verifyOtp(@Body() body: VerifyOtpDto) {

    return this.auth.verifyOtp(body.userId, body.code);

  }



  @Post('login')

  login(@Body() body: LoginDto) {

    return this.auth.login(body);

  }



  @Post('refresh')

  refresh(@Body() body: RefreshTokenDto) {

    return this.auth.refresh(body.refreshToken);

  }



  @Get('me')

  @UseGuards(AuthGuard('jwt'))

  me(@Req() req: AuthedReq) {

    return this.auth.getMe(req.user.userId);

  }

}

