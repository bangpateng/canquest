/**
 * M4b: Wallet key backup sync — blob terenkripsi kunci dompet disimpan di
 * akun user supaya bisa dibuka di browser lain HANYA dengan passphrase
 * (tanpa raw hex).
 *
 * Keamanan: blob = AES-256-GCM (PBKDF2 310k dari passphrase user) — dibuat
 * DAN didekripsi 100% di browser. Server tidak pernah menerima passphrase;
 * server tidak bisa membuka blob-nya sendiri. Raw-hex backup tetap berlaku
 * sebagai pemulihan terakhir.
 *
 * Endpoints (JWT):
 *   GET    /party/wallet-key/backup  → { blob: string | null }
 *   PUT|POST /party/wallet-key/backup { blob } → { ok: true }
 *   DELETE /party/wallet-key/backup  → { ok: true }
 */
import { AuthGuard } from '@nestjs/passport';
import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsString, MaxLength, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { UsersService } from '../users/users.service';
import type { AuthedReq } from './party-shared';

export class WalletKeyBackupDto {
  /** Record terenkripsi dari key-manager browser (JSON stringified). */
  @IsString()
  @MinLength(64)
  @MaxLength(8192)
  blob!: string;
}

@Controller('party/wallet-key/backup')
@UseGuards(AuthGuard('jwt'))
export class WalletKeyBackupController {
  private readonly logger = new Logger(WalletKeyBackupController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
  ) {}

  @Get()
  async get(@Req() req: AuthedReq) {
    const row = await this.prisma.walletKeyBackup.findUnique({
      where: { userId: req.user.userId },
    });
    return { blob: row?.blob ?? null, updatedAt: row?.updatedAt ?? null };
  }

  private async upsertBlob(userId: string, blob: string) {
    // Hanya user external yang punya kunci dompet untuk disinkronkan.
    const user = await this.users.findById(userId);
    if (!user) throw new BadRequestException('User not found');
    if (user.walletKind !== 'external') {
      throw new BadRequestException(
        'Key sync is only available for non-custodial wallets.',
      );
    }
    // Validasi bentuk: harus JSON dengan field record terenkripsi.
    try {
      const parsed = JSON.parse(blob) as Record<string, unknown>;
      if (parsed.v !== 1 || !parsed.kdf || !parsed.cipher) {
        throw new Error('shape');
      }
    } catch {
      throw new BadRequestException('Invalid encrypted blob format.');
    }

    await this.prisma.walletKeyBackup.upsert({
      where: { userId },
      create: { userId, blob },
      update: { blob },
    });
    this.logger.log(`key backup synced: user=${userId.slice(0, 8)}…`);
    return { ok: true as const };
  }

  @Put()
  async put(@Req() req: AuthedReq, @Body() dto: WalletKeyBackupDto) {
    return this.upsertBlob(req.user.userId, dto.blob);
  }

  @Post()
  async post(@Req() req: AuthedReq, @Body() dto: WalletKeyBackupDto) {
    return this.upsertBlob(req.user.userId, dto.blob);
  }

  @Delete()
  async remove(@Req() req: AuthedReq) {
    await this.prisma.walletKeyBackup
      .deleteMany({ where: { userId: req.user.userId } })
      .catch(() => undefined);
    this.logger.log(`key backup removed: user=${req.user.userId.slice(0, 8)}…`);
    return { ok: true as const };
  }
}
