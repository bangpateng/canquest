import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';

const ALLOWED_MIME = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);
const MAX_BYTES = 2 * 1024 * 1024;

@Injectable()
export class ProfileAvatarService {
  private readonly logger = new Logger(ProfileAvatarService.name);
  private readonly uploadsRoot: string;
  private readonly avatarsDir: string;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.uploadsRoot = resolveUploadsRoot(config.get<string>('UPLOADS_DIR'));
    this.avatarsDir = join(this.uploadsRoot, 'avatars');
    mkdirSync(this.avatarsDir, { recursive: true });
  }

  /** Public path segment used by the API + web proxy (no auth). */
  avatarPublicPath(userId: string): string {
    // Route di UploadsController: @Controller('uploads') + @Get('avatars/:userId')
    return `/api/uploads/avatars/${userId}`;
  }

  hasAvatar(avatarPath: string | null | undefined): boolean {
    if (!avatarPath) return false;
    return existsSync(join(this.uploadsRoot, avatarPath));
  }

  resolveDiskPath(avatarPath: string): string {
    return join(this.uploadsRoot, avatarPath);
  }

  resolveDiskPathForUser(userId: string): string | null {
    const rel = this.relativePathForUser(userId);
    const full = join(this.uploadsRoot, rel);
    return existsSync(full) ? full : null;
  }

  relativePathForUser(userId: string, ext = 'jpg'): string {
    const safe = userId.replace(/[^a-zA-Z0-9_-]/g, '');
    return `avatars/${safe}.${ext}`;
  }

  async setFromDataUrl(
    userId: string,
    dataUrl: string,
  ): Promise<{ avatarUrl: string }> {
    const parsed = parseDataUrlImage(dataUrl);
    if (!ALLOWED_MIME.has(parsed.mime)) {
      throw new BadRequestException(
        'Only JPEG, PNG, WebP, or GIF images are allowed.',
      );
    }
    if (parsed.buffer.length > MAX_BYTES) {
      throw new BadRequestException('Image must be 2 MB or smaller.');
    }

    const ext = mimeToExt(parsed.mime);
    const rel = this.relativePathForUser(userId, ext);
    const full = join(this.uploadsRoot, rel);

    // Remove previous files for this user (any extension)
    this.removeUserFiles(userId);

    writeFileSync(full, parsed.buffer);

    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarPath: rel },
    });

    this.logger.log(`Avatar saved for user ${userId} → ${rel}`);
    return { avatarUrl: this.avatarPublicPath(userId) };
  }

  async remove(userId: string): Promise<void> {
    this.removeUserFiles(userId);
    await this.prisma.user.update({
      where: { id: userId },
      data: { avatarPath: null },
    });
  }

  private removeUserFiles(userId: string): void {
    const safe = userId.replace(/[^a-zA-Z0-9_-]/g, '');
    for (const ext of ['jpg', 'jpeg', 'png', 'webp', 'gif']) {
      const p = join(this.avatarsDir, `${safe}.${ext}`);
      if (existsSync(p)) {
        try {
          unlinkSync(p);
        } catch {
          /* ignore */
        }
      }
    }
  }
}

function resolveUploadsRoot(configured?: string): string {
  if (configured?.trim()) {
    return configured.trim();
  }
  const candidates = [
    join(process.cwd(), 'uploads'),
    join(process.cwd(), 'apps', 'api', 'uploads'),
    join(__dirname, '..', '..', 'uploads'),
  ];
  for (const dir of candidates) {
    const parent = join(dir, '..');
    if (existsSync(parent)) return dir;
  }
  return join(process.cwd(), 'uploads');
}

function parseDataUrlImage(input: string): { mime: string; buffer: Buffer } {
  const trimmed = input.trim();
  const match = /^data:(image\/[a-z+]+);base64,(.+)$/i.exec(trimmed);
  if (match) {
    return {
      mime: match[1].toLowerCase(),
      buffer: Buffer.from(match[2], 'base64'),
    };
  }
  try {
    return { mime: 'image/jpeg', buffer: Buffer.from(trimmed, 'base64') };
  } catch {
    throw new BadRequestException('Invalid image payload.');
  }
}

function mimeToExt(mime: string): string {
  switch (mime) {
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    default:
      return 'jpg';
  }
}

export function contentTypeForPath(filePath: string): string {
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.webp')) return 'image/webp';
  if (filePath.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}
