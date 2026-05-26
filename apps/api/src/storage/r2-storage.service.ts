import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
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

/** Bucket name only (e.g. canquest-media), not a URL. */
export function normalizeR2BucketName(raw: string | undefined | null): string | null {
  if (!raw?.trim()) return null;
  let s = raw.trim();
  if (s.startsWith('http://') || s.startsWith('https://')) {
    try {
      const u = new URL(s);
      const parts = u.pathname.split('/').filter(Boolean);
      s = parts[parts.length - 1] ?? s;
    } catch {
      /* keep raw */
    }
  }
  s = s.replace(/^\/+|\/+$/g, '');
  return s || null;
}

@Injectable()
export class R2StorageService implements OnModuleInit {
  private readonly logger = new Logger(R2StorageService.name);
  private readonly client: S3Client | null;
  private readonly bucket: string | null;
  private readonly publicBase: string | null;
  private readonly accountId: string | null;
  private readonly localDir: string;
  private bucketVerified = false;

  constructor(private readonly config: ConfigService) {
    const accountId = config.get<string>('R2_ACCOUNT_ID')?.trim();
    this.accountId = accountId ?? null;
    const accessKeyId = config.get<string>('R2_ACCESS_KEY_ID')?.trim();
    const secretAccessKey = config.get<string>('R2_SECRET_ACCESS_KEY')?.trim();
    this.bucket = normalizeR2BucketName(config.get<string>('R2_BUCKET_NAME'));
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
        forcePathStyle: true,
      });
      this.logger.log(
        `Cloudflare R2 enabled (bucket="${this.bucket}", account=${accountId}, public=${this.publicBase})`,
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

  async onModuleInit(): Promise<void> {
    if (!this.isR2Enabled()) return;
    try {
      await this.verifyBucket();
      this.bucketVerified = true;
      this.logger.log(`R2 bucket "${this.bucket}" verified`);
    } catch (err) {
      const msg = this.formatS3Error(err);
      this.logger.error(
        `R2 bucket check failed for "${this.bucket}" — uploads will fail until fixed. ${msg}`,
      );
    }
  }

  private async verifyBucket(): Promise<void> {
    await this.client!.send(
      new HeadBucketCommand({ Bucket: this.bucket! }),
    );
  }

  private formatS3Error(err: unknown): string {
    if (err instanceof S3ServiceException) {
      const code = err.name || err.$metadata?.httpStatusCode;
      if (err.name === 'NoSuchBucket' || code === 'NoSuchBucket') {
        return (
          `Bucket "${this.bucket}" does not exist for account ${this.accountId ?? '?'}. ` +
          'Set R2_BUCKET_NAME to the exact name in Cloudflare → R2 → Buckets (not the public URL).'
        );
      }
      if (err.name === 'AccessDenied' || code === 'AccessDenied') {
        return 'Access denied — check API token has Object Read & Write on this bucket.';
      }
      return err.message;
    }
    return err instanceof Error ? err.message : String(err);
  }

  private mapUploadError(err: unknown): never {
    const detail = this.formatS3Error(err);
    if (
      err instanceof S3ServiceException &&
      (err.name === 'NoSuchBucket' || err.name === 'AccessDenied')
    ) {
      throw new BadRequestException(`R2 upload failed: ${detail}`);
    }
    this.logger.error(`R2 PutObject failed: ${detail}`, err instanceof Error ? err.stack : undefined);
    throw new ServiceUnavailableException(`Image upload failed: ${detail}`);
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
      if (!this.bucketVerified) {
        try {
          await this.verifyBucket();
          this.bucketVerified = true;
        } catch (err) {
          this.mapUploadError(err);
        }
      }
      try {
        await this.client!.send(
          new PutObjectCommand({
            Bucket: this.bucket!,
            Key: key,
            Body: input.buffer,
            ContentType: input.mimeType,
            CacheControl: 'public, max-age=31536000, immutable',
          }),
        );
      } catch (err) {
        this.mapUploadError(err);
      }
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
