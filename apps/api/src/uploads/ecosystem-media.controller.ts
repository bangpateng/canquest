import {
  Controller,
  Get,
  NotFoundException,
  Param,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { R2StorageService } from '../storage/r2-storage.service';

/**
 * Media ecosystem — URL bersih sesuai struktur folder R2:
 *   GET /api/ecosystem/<filename>  →  R2 key `ecosystem/<filename>`
 * (logo partner & foto team; di-upload lewat panel admin).
 */
@Controller('ecosystem')
export class EcosystemMediaController {
  constructor(private readonly storage: R2StorageService) {}

  @Get(':filename')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async serve(
    @Param('filename') filename: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const asset = await this.storage.getEcosystemAssetStream(filename);
    if (!asset) throw new NotFoundException();
    res.set({
      'Content-Type': asset.contentType,
      'Cache-Control': 'public, max-age=86400',
      'Cross-Origin-Resource-Policy': 'cross-origin',
    });
    return new StreamableFile(asset.stream);
  }
}
