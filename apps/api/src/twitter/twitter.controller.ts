import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { PrismaService } from '../prisma/prisma.service';
import { TwitterApiService } from './twitter-api.service';
import { ConnectTwitterDto } from './dto/connect-twitter.dto';
import { normalizeTwitterUsername } from './twitter-target.util';

type AuthedReq = Request & { user: { userId: string; email: string } };

@Controller('twitter')
@UseGuards(AuthGuard('jwt'))
export class TwitterController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly twitterApi: TwitterApiService,
  ) {}

  private async backfillAvatarIfMissing(userId: string, twitterUsername: string) {
    if (!this.twitterApi.isConfigured()) return null;
    try {
      const profile = await this.twitterApi.fetchUserProfile(twitterUsername);
      if (!profile.profileImageUrl) return null;
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          twitterAvatarUrl: profile.profileImageUrl,
          ...(profile.userId ? { twitterUserId: profile.userId } : {}),
        },
      });
      return profile.profileImageUrl;
    } catch {
      return null;
    }
  }

  @Get('status')
  async status(@Req() req: AuthedReq) {
    const user = await this.prisma.user.findUnique({
      where: { id: req.user.userId },
      select: {
        twitterUsername: true,
        twitterConnectedAt: true,
        twitterUserId: true,
        twitterAvatarUrl: true,
      },
    });

    let twitterAvatarUrl = user?.twitterAvatarUrl ?? null;
    if (user?.twitterUsername && !twitterAvatarUrl) {
      twitterAvatarUrl = await this.backfillAvatarIfMissing(
        req.user.userId,
        user.twitterUsername,
      );
    }

    return {
      connected: Boolean(user?.twitterUsername),
      username: user?.twitterUsername ?? null,
      connectedAt: user?.twitterConnectedAt?.toISOString() ?? null,
      avatarUrl: twitterAvatarUrl,
      apiConfigured: this.twitterApi.isConfigured(),
    };
  }

  @Post('connect')
  async connect(@Req() req: AuthedReq, @Body() body: ConnectTwitterDto) {
    if (!this.twitterApi.isConfigured()) {
      throw new BadRequestException(
        'Twitter verification is not configured on this server.',
      );
    }

    const normalized = normalizeTwitterUsername(body.username);
    const existing = await this.prisma.user.findFirst({
      where: {
        twitterUsername: normalized,
        NOT: { id: req.user.userId },
      },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        'This X account is already linked to another CanQuest user.',
      );
    }

    const resolved = await this.twitterApi.fetchUserProfile(normalized);
    const now = new Date();
    await this.prisma.user.update({
      where: { id: req.user.userId },
      data: {
        twitterUsername: resolved.username,
        twitterUserId: resolved.userId,
        twitterAvatarUrl: resolved.profileImageUrl,
        twitterConnectedAt: now,
        ...(resolved.displayName
          ? { displayName: resolved.displayName }
          : {}),
      },
    });

    return {
      ok: true,
      username: resolved.username,
      avatarUrl: resolved.profileImageUrl,
      connectedAt: now.toISOString(),
    };
  }

  @Delete('disconnect')
  async disconnect(@Req() req: AuthedReq) {
    await this.prisma.user.update({
      where: { id: req.user.userId },
      data: {
        twitterUsername: null,
        twitterUserId: null,
        twitterAvatarUrl: null,
        twitterConnectedAt: null,
      },
    });
    return { ok: true };
  }
}
