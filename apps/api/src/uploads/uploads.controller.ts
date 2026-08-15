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
import { ConfigService } from '@nestjs/config';
import { R2StorageService } from '../storage/r2-storage.service';

@Controller('uploads')
export class UploadsController {
  constructor(
    private readonly config: ConfigService,
    private readonly storage: R2StorageService,
  ) {}

  /** CC token icon for Earn / campaign reward UI (R2 key from CC_REWARD_LOGO_R2_KEY). */
  @Get('cc-reward-logo')
  @Throttle({ default: { limit: 60, ttl: 60_000 } })
  async serveCcRewardLogo(@Res({ passthrough: true }) res: Response) {
    const key =
      this.config.get<string>('CC_REWARD_LOGO_R2_KEY')?.trim() ||
      'quests/C (1).png';
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

  /**
   * Token logo untuk Swap modal — stream dari R2 key `tokens/<symbol>.<ext>`.
   * Case-insensitive via ListObjectsV2 prefix `tokens/` + match basename.
   * Fix untuk token mixed-case (mis. `USDCx.webp` — 'x' kecil) yang di-upload
   * admin tapi diminta frontend sebagai UPPERCASE. Listing di-cache 60s.
   * 404 kalau tidak ada satupun → FE fallback ke gradient circle.
   */
  @Get('token-logo/:symbol')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  async serveTokenLogo(
    @Param('symbol') rawSymbol: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Sanitize base: alphanumeric + dash, preserve case info.
    const base = rawSymbol.replace(/[^a-zA-Z0-9-]/g, '');
    if (!base || base.length > 64) {
      throw new NotFoundException();
    }
    const asset = await this.storage.getTokenLogoStream(base);
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
}
