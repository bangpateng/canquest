import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { createReadStream, existsSync } from 'fs';
import path from 'path';
import { ConfigService } from '@nestjs/config';
import { ProfileAvatarService, contentTypeForPath } from '../users/profile-avatar.service';
import { R2StorageService } from '../storage/r2-storage.service';

@Controller('uploads')
export class UploadsController {
  constructor(
    private readonly avatars: ProfileAvatarService,
    private readonly config: ConfigService,
    private readonly storage: R2StorageService,
  ) {}

  /** Public avatar image — safe user id only (cuid). */
  @Get('avatars/:userId')
  @SkipThrottle()
  serveAvatar(@Param('userId') userId: string, @Res({ passthrough: true }) res: Response) {
    if (!/^[a-zA-Z0-9_-]+$/.test(userId)) {
      throw new NotFoundException();
    }
    const disk = this.avatars.resolveDiskPathForUser(userId);
    if (!disk || !existsSync(disk)) {
      throw new NotFoundException();
    }
    res.set({
      'Content-Type': contentTypeForPath(disk),
      'Cache-Control': 'public, max-age=3600',
    });
    return new StreamableFile(createReadStream(disk));
  }

  /** CC token icon for Earn / campaign reward UI (R2 key from CC_REWARD_LOGO_R2_KEY). */
  @Get('cc-reward-logo')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async serveCcRewardLogo(@Res({ passthrough: true }) res: Response) {
    const key =
      this.config.get<string>('CC_REWARD_LOGO_R2_KEY')?.trim() || 'quests/C (1).png';
    if (!/^quests\/[a-zA-Z0-9 ()_.-]+\.(png|jpg|jpeg|webp|gif)$/i.test(key)) {
      throw new NotFoundException();
    }
    const asset = await this.storage.getQuestAssetStream(key);
    if (!asset) {
      throw new NotFoundException();
    }
    res.set({
      'Content-Type': asset.contentType,
      'Cache-Control': 'public, max-age=86400',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    return new StreamableFile(asset.stream);
  }

  /** Stream quest banner/logo from Cloudflare R2 (works even when r2.dev public URL is misconfigured). */
  @Get('quests/:filename')
  @SkipThrottle()
  async serveQuestR2Asset(
    @Param('filename') filename: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!/^[a-f0-9-]{36}\.(jpg|jpeg|png|webp|gif)$/i.test(filename)) {
      throw new NotFoundException();
    }
    const key = `quests/${filename}`;
    const asset = await this.storage.getQuestAssetStream(key);
    if (!asset) {
      throw new NotFoundException();
    }
    res.set({
      'Content-Type': asset.contentType,
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    return new StreamableFile(asset.stream);
  }

  /** Local dev fallback when R2 is not configured. */
  @Get('quest-media/:filename')
  @SkipThrottle()
  serveQuestMedia(
    @Param('filename') filename: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (!/^[a-f0-9-]{36}\.(jpg|jpeg|png|webp|gif)$/i.test(filename)) {
      throw new NotFoundException();
    }
    const dir =
      this.config.get<string>('QUEST_MEDIA_UPLOAD_DIR')?.trim() ||
      path.join(process.cwd(), 'uploads', 'quest-media');
    const disk = path.join(dir, filename);
    if (!existsSync(disk)) {
      throw new NotFoundException();
    }
    res.set({
      'Content-Type': contentTypeForPath(disk),
      'Cache-Control': 'public, max-age=86400',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    return new StreamableFile(createReadStream(disk));
  }
}
