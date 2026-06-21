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
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from '@aws-sdk/client-s3';
import { mkdir, unlink, writeFile } from 'fs/promises';
import path from 'path';
import type { Readable } from 'stream';

export const QUEST_ASSET_KEY_PREFIX = 'quests/';

const QUEST_MEDIA_FILENAME = /^[0-9a-f-]{36}\.(jpe?g|png|webp|gif)$/i;

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

function contentTypeForQuestKey(key: string): string {
  const lower = key.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

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

/** S3 API host — for PutObject only, not browser-visible URLs. */
export function isR2S3ApiEndpoint(url: string): boolean {
  return /\.r2\.cloudflarestorage\.com/i.test(url);
}

/** Public CDN / r2.dev URL shown in Earn cards (not the cloudflarestorage.com API host). */
export function normalizeR2PublicBaseUrl(raw: string | undefined | null): string | null {
  if (!raw?.trim()) return null;
  const base = raw.trim().replace(/\/$/, '');
  if (isR2S3ApiEndpoint(base)) {
    return null;
  }
  return base;
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
    const publicBaseRaw = config.get<string>('R2_PUBLIC_BASE_URL')?.trim();
    this.publicBase = normalizeR2PublicBaseUrl(publicBaseRaw);

    const endpoint =
      config.get<string>('R2_ENDPOINT')?.trim() ||
      (accountId
        ? `https://${accountId}.r2.cloudflarestorage.com`
        : null);

    if (publicBaseRaw && !this.publicBase && isR2S3ApiEndpoint(publicBaseRaw)) {
      this.logger.error(
        'R2_PUBLIC_BASE_URL is the S3 API endpoint (….r2.cloudflarestorage.com). ' +
          'Use the public bucket URL from R2 → bucket → Settings → Public access (https://pub-….r2.dev). ' +
          'Uploads are disabled until fixed.',
      );
    }

    if (accountId && accessKeyId && secretAccessKey && this.bucket && endpoint) {
      this.client = new S3Client({
        region: 'auto',
        endpoint,
        credentials: { accessKeyId, secretAccessKey },
        forcePathStyle: true,
      });
      const serveVia =
        this.publicBase != null
          ? `public ${this.publicBase} (also API proxy)`
          : 'API proxy only — set R2_PUBLIC_BASE_URL optional';
      this.logger.log(
        `Cloudflare R2 enabled (bucket="${this.bucket}", account=${accountId}, ${serveVia})`,
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
    return this.client != null && !!this.bucket;
  }

  getApiPublicBase(): string {
    return (
      this.config.get<string>('API_PUBLIC_BASE_URL')?.replace(/\/$/, '') ||
      `http://127.0.0.1:${this.config.get<string>('PORT') ?? '3001'}`
    );
  }

  /** Browser-visible URL — served by GET /api/uploads/quests/:filename from R2. */
  buildQuestAssetServeUrl(key: string): string {
    const filename = key.startsWith(QUEST_ASSET_KEY_PREFIX)
      ? key.slice(QUEST_ASSET_KEY_PREFIX.length)
      : key;
    return `${this.getApiPublicBase()}/api/uploads/quests/${filename}`;
  }

  /**
   * Map DB URL (r2.dev, API, or legacy) to a URL the web app can load.
   * Fixes broken pub-….r2.dev links when public access does not match the bucket.
   */
  normalizeQuestMediaUrl(url: string | null | undefined): string | null {
    if (!url?.trim()) return null;
    const resolved = this.resolveManagedQuestAsset(url);
    if (!resolved) return url.trim();
    if (resolved.kind === 'r2') {
      return this.buildQuestAssetServeUrl(resolved.key);
    }
    const filename = path.basename(resolved.filePath);
    return `${this.getApiPublicBase()}/api/uploads/quest-media/${filename}`;
  }

  async getQuestAssetStream(
    key: string,
  ): Promise<{ stream: Readable; contentType: string } | null> {
    if (!this.isR2Enabled()) return null;
    try {
      const out = await this.client!.send(
        new GetObjectCommand({ Bucket: this.bucket!, Key: key }),
      );
      if (!out.Body) return null;
      return {
        stream: out.Body as Readable,
        contentType: out.ContentType ?? contentTypeForQuestKey(key),
      };
    } catch (err) {
      if (
        err instanceof S3ServiceException &&
        (err.name === 'NoSuchKey' || err.name === 'NotFound')
      ) {
        return null;
      }
      throw err;
    }
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

  /** Ensures the object exists in R2 and is reachable via R2_PUBLIC_BASE_URL (same bucket). */
  private async assertPublicObjectReadable(key: string): Promise<void> {
    try {
      await this.client!.send(
        new HeadObjectCommand({ Bucket: this.bucket!, Key: key }),
      );
    } catch (err) {
      this.mapUploadError(err);
    }

    const publicUrl = `${this.publicBase}/${key}`;
    let res: Response;
    try {
      res = await fetch(publicUrl, { method: 'HEAD', redirect: 'follow' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ServiceUnavailableException(
        `Image uploaded but public URL check failed (${msg}). Verify R2_PUBLIC_BASE_URL and bucket public access.`,
      );
    }

    if (res.ok) return;

    const hint =
      res.status === 404
        ? `R2_PUBLIC_BASE_URL (${this.publicBase}) does not serve objects from bucket "${this.bucket}". ` +
          'In Cloudflare → R2 → open that bucket → Settings → Public access → enable and copy the pub-….r2.dev URL from the same bucket, then restart the API and re-upload.'
        : `Public URL returned HTTP ${res.status}. Check bucket public access or custom domain.`;

    this.logger.error(`R2 public URL not readable: ${publicUrl} → ${res.status}`);
    throw new BadRequestException(`R2 public URL not reachable: ${hint}`);
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

  /**
   * Verifikasi magic-byte signature buffer agar tidak sekadar mempercayai
   * `Content-Type` dari klien. Mencegah upload HTML/polyglot/malware yang
   * diakali dengan `Content-Type: image/jpeg`. Mengembalikan tipe MIME
   * terdeteksi, atau null jika tidak cocok format gambar yang diizinkan.
   *
   * Referensi signature: https://en.wikipedia.org/wiki/List_of_file_signatures
   */
  private detectImageMime(buf: Buffer): string | null {
    if (buf.length < 12) return null;
    // JPEG: FF D8 FF
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (
      buf[0] === 0x89 &&
      buf[1] === 0x50 &&
      buf[2] === 0x4e &&
      buf[3] === 0x47 &&
      buf[4] === 0x0d &&
      buf[5] === 0x0a &&
      buf[6] === 0x1a &&
      buf[7] === 0x0a
    ) {
      return 'image/png';
    }
    // GIF: "GIF87a" atau "GIF89a"
    if (
      buf[0] === 0x47 &&
      buf[1] === 0x49 &&
      buf[2] === 0x46 &&
      buf[3] === 0x38 &&
      (buf[4] === 0x37 || buf[4] === 0x39) &&
      buf[5] === 0x61
    ) {
      return 'image/gif';
    }
    // WebP: "RIFF" .... "WEBP"
    if (
      buf[0] === 0x52 &&
      buf[1] === 0x49 &&
      buf[2] === 0x46 &&
      buf[3] === 0x46 &&
      buf[8] === 0x57 &&
      buf[9] === 0x45 &&
      buf[10] === 0x42 &&
      buf[11] === 0x50
    ) {
      return 'image/webp';
    }
    return null;
  }

  /** Upload banner or logo; returns public HTTPS URL stored on Quest. */
  async uploadQuestAsset(input: QuestImageUpload): Promise<string> {
    const maxBytes = Number(this.config.get<string>('QUEST_MEDIA_MAX_BYTES') ?? '5242880');

    // Verifikasi magic-byte: jangan percaya Content-Type dari klien.
    // Tipe MIME final diambil dari signature buffer; bila tidak cocok format
    // gambar yang diizinkan, tolak (mencegah HTML/polyglot disamarkan).
    const detectedMime = this.detectImageMime(input.buffer);
    if (!detectedMime) {
      throw new BadRequestException(
        'File content does not match a valid JPEG, PNG, WebP, or GIF image',
      );
    }
    // Gunakan tipe terdeteksi (lebih otoritatif dari header klien) untuk
    // menentukan ekstensi & Content-Type penyimpanan.
    const mimeType = detectedMime;

    const ext = this.assertAllowedImage(mimeType, input.buffer.length, maxBytes);
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
            ContentType: mimeType,
            CacheControl: 'public, max-age=31536000, immutable',
          }),
        );
      } catch (err) {
        this.mapUploadError(err);
      }
      if (this.publicBase) {
        await this.assertPublicObjectReadable(key);
      }
      return this.buildQuestAssetServeUrl(key);
    }

    const publicBaseRaw = this.config.get<string>('R2_PUBLIC_BASE_URL')?.trim();
    if (publicBaseRaw && isR2S3ApiEndpoint(publicBaseRaw.replace(/\/$/, ''))) {
      throw new BadRequestException(
        'R2_PUBLIC_BASE_URL must be the public bucket URL (https://pub-….r2.dev), not the S3 API endpoint. Fix apps/api/.env and restart API.',
      );
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

  /**
   * Returns R2 object key or local filename when `url` is a quest asset we uploaded.
   * Ignores external paths (e.g. /quest-media/ on Vercel static).
   */
  resolveManagedQuestAsset(url: string): { kind: 'r2'; key: string } | { kind: 'local'; filePath: string } | null {
    const trimmed = url.trim();
    if (!trimmed) return null;

    let pathname: string;
    try {
      if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        pathname = new URL(trimmed).pathname;
      } else if (trimmed.startsWith('/')) {
        pathname = trimmed;
      } else {
        return null;
      }
    } catch {
      return null;
    }

    const segments = pathname.split('/').filter(Boolean);
    const questsIdx = segments.indexOf('quests');
    if (questsIdx >= 0 && segments.length === questsIdx + 2) {
      const filename = segments[questsIdx + 1];
      if (QUEST_MEDIA_FILENAME.test(filename) && this.isR2Enabled()) {
        return { kind: 'r2', key: `${QUEST_ASSET_KEY_PREFIX}${filename}` };
      }
    }

    const mediaIdx = segments.indexOf('quest-media');
    if (mediaIdx >= 0 && segments.length === mediaIdx + 2) {
      const filename = segments[mediaIdx + 1];
      if (QUEST_MEDIA_FILENAME.test(filename)) {
        return { kind: 'local', filePath: path.join(this.localDir, filename) };
      }
    }

    return null;
  }

  /** Delete a previously uploaded quest banner/logo (R2 or local dev). Best-effort, idempotent. */
  async deleteQuestAssetByUrl(url: string | null | undefined): Promise<boolean> {
    const resolved = url?.trim() ? this.resolveManagedQuestAsset(url) : null;
    if (!resolved) return false;

    if (resolved.kind === 'r2') {
      if (!this.isR2Enabled()) {
        this.logger.warn(`Skip R2 delete (not configured): ${url}`);
        return false;
      }
      try {
        await this.client!.send(
          new DeleteObjectCommand({ Bucket: this.bucket!, Key: resolved.key }),
        );
        this.logger.log(`Deleted R2 quest asset: ${resolved.key}`);
        return true;
      } catch (err) {
        const detail = this.formatS3Error(err);
        this.logger.warn(`R2 delete failed for ${resolved.key}: ${detail}`);
        return false;
      }
    }

    try {
      await unlink(resolved.filePath);
      this.logger.log(`Deleted local quest asset: ${resolved.filePath}`);
      return true;
    } catch (err) {
      const code = err && typeof err === 'object' && 'code' in err ? (err as NodeJS.ErrnoException).code : null;
      if (code === 'ENOENT') return true;
      this.logger.warn(
        `Local delete failed for ${resolved.filePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return false;
    }
  }
}
