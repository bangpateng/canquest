import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { AdminGuard } from './admin.guard';
import { R2StorageService } from '../storage/r2-storage.service';

const MAX_BYTES = 5 * 1024 * 1024;

@Controller('admin/uploads')
@UseGuards(AuthGuard('admin-jwt'), AdminGuard)
export class AdminUploadsController {
  constructor(private readonly storage: R2StorageService) {}

  /** Banner + logo for Earn campaigns (Cloudflare R2 when configured). */
  @Post('quest-asset')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_BYTES },
    }),
  )
  async uploadQuestAsset(
    @UploadedFile() file?: Express.Multer.File,
  ): Promise<{ url: string; storage: 'r2' | 'local' }> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('Missing file field');
    }
    const url = await this.storage.uploadQuestAsset({
      buffer: file.buffer,
      mimeType: file.mimetype,
      originalName: file.originalname,
    });
    return { url, storage: this.storage.isR2Enabled() ? 'r2' : 'local' };
  }

  /** Remove a quest banner/logo from R2 (or local dev) when replaced or cleared in admin. */
  @Delete('quest-asset')
  async deleteQuestAsset(
    @Body() body: { url?: string },
  ): Promise<{ deleted: boolean }> {
    const url = body?.url?.trim();
    if (!url) {
      throw new BadRequestException('Missing url');
    }
    if (!this.storage.resolveManagedQuestAsset(url)) {
      throw new BadRequestException(
        'URL is not a managed quest upload (only R2 /quests/… or local quest-media files can be deleted)',
      );
    }
    const deleted = await this.storage.deleteQuestAssetByUrl(url);
    return { deleted };
  }
}
