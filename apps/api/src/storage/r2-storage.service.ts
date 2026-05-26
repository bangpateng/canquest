import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);

const EXT_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export type QuestImageUpload = {
  buffer: Buffer;
  mimeType: string;
  originalName?: string;
};

@Injectable()
export class R2StorageService {
  private readonly logger = new Logger(R2StorageService.name);
  private readonly client: S3Client | null;
  private readonly bucket: string | null;
  private readonly publicBase: string | null;
  private readonly localDir: string;

  constructor(private readonly config: ConfigService) {
    const accountId = config.get<string>('R2_ACCOUNT_ID')?.trim();
    const accessKeyId = config.get<string>('R2_ACCESS_KEY_ID')?.trim();
    const secretAccessKey = config.get<string>('R2_SECRET_ACCESS_KEY')?.trim();
    this.bucket = config.get<string>('R2_BUCKET_NAME')?.trim() ?? null;
    const publicBase = config.get<string>('R2_PUBLIC_BASE_URL')?.trim();
    this.publicBase = publicBase ? publicBase.replace(/\/$/, '') : null;

    const endpoint =
      config.get<string>('R2_ENDPOINT')?.trim() ||
      (accountId
        ? `https://${accountId}.r2.cloudflarestorage.com`
        : null);

    if (
      accountId &&
      accessKeyId &&
      secretAccessKey &&
      this.bucket &&
      endpoint &&
      this.publicBase
    ) {
      this.client = new S3Client({
        region: 'auto',
        endpoint,
        credentials: { accessKeyId, secretAccessKey },
      });
      this.logger.log(
        `Cloudflare R2 enabled (bucket=${this.bucket}, public=${this.publicBase})`,
      );
    } else {
      this.client = null;
      this.logger.warn(
        'Cloudflare R2 not configured — quest images save to local uploads/quest-media (dev only)',
      );
    }

    this.localDir =
      config.get<string>('QUEST_MEDIA_UPLOAD_DIR')?.trim() ||
      path.join(process.cwd(), 'uploads', 'quest-media');
  }

  isR2Enabled(): boolean {
    return this.client != null && !!this.bucket && !!this.publicBase;
  }

  assertAllowedImage(mimeType: string, sizeBytes: number, maxBytes: number): string {
    if (!ALLOWED_MIME.has(mimeType)) {
      throw new BadRequestException('Only JPEG, PNG, WebP, or GIF allowed');
    }
    const ext = EXT_BY_MIME[mimeType];
    if (!ext) {
      throw new BadRequestException('Unsupported image type');
    }
    if (sizeBytes > maxBytes) {
      throw new BadRequestException(
        `File too large (max ${Math.round(maxBytes / (1024 * 1024))} MB)`,
      );
    }
    return ext;
  }

  /** Upload banner or logo; returns public HTTPS URL stored on Quest. */
  async uploadQuestAsset(input: QuestImageUpload): Promise<string> {
    const maxBytes = Number(this.config.get<string>('QUEST_MEDIA_MAX_BYTES') ?? '5242880');
    const ext = this.assertAllowedImage(input.mimeType, input.buffer.length, maxBytes);
    const key = `quests/${randomUUID()}.${ext}`;

    if (this.isR2Enabled()) {
      await this.client!.send(
        new PutObjectCommand({
          Bucket: this.bucket!,
          Key: key,
          Body: input.buffer,
          ContentType: input.mimeType,
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      );
      return `${this.publicBase}/${key}`;
    }

    await mkdir(this.localDir, { recursive: true });
    const filename = `${randomUUID()}.${ext}`;
    const diskPath = path.join(this.localDir, filename);
    await writeFile(diskPath, input.buffer);

    const apiPublic =
      this.config.get<string>('API_PUBLIC_BASE_URL')?.replace(/\/$/, '') ||
      `http://127.0.0.1:${this.config.get<string>('PORT') ?? '3001'}`;
    return `${apiPublic}/api/uploads/quest-media/${filename}`;
  }
}
