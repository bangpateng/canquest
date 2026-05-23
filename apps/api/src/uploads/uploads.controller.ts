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
import { ProfileAvatarService, contentTypeForPath } from '../users/profile-avatar.service';

@Controller('uploads')
export class UploadsController {
  constructor(private readonly avatars: ProfileAvatarService) {}

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
}
