import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import { createReadStream, existsSync } from 'fs';
import path from 'path';
import { ConfigService } from '@nestjs/config';
import { ProfileAvatarService, contentTypeForPath } from '../users/profile-avatar.service';

@Controller('uploads')
export class UploadsController {
  constructor(
    private readonly avatars: ProfileAvatarService,
    private readonly config: ConfigService,
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
    });
    return new StreamableFile(createReadStream(disk));
  }
}
