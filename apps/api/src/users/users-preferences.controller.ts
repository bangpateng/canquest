import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Patch,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IsBoolean } from 'class-validator';
import type { Request } from 'express';
import { UsersService } from './users.service';

type AuthedReq = Request & { user: { userId: string; email: string } };

export class UpdateEmailPreferencesDto {
  @IsBoolean()
  emailNotificationsEnabled!: boolean;
}

/**
 * User self-service preferences. Target link "Manage email preferences" di
 * footer email notifikasi campaign — PATCH /api/users/me/preferences.
 */
@Controller('users')
@UseGuards(AuthGuard('jwt'))
export class UsersPreferencesController {
  constructor(private readonly users: UsersService) {}

  @Get('me/preferences')
  async getPreferences(@Req() req: AuthedReq) {
    const user = await this.users.findById(req.user.userId);
    if (!user) throw new NotFoundException('User not found');
    return {
      emailNotificationsEnabled: user.emailNotificationsEnabled ?? true,
    };
  }

  @Patch('me/preferences')
  async updatePreferences(
    @Req() req: AuthedReq,
    @Body() body: UpdateEmailPreferencesDto,
  ) {
    return this.users.setEmailNotificationsEnabled(
      req.user.userId,
      body.emailNotificationsEnabled,
    );
  }
}
