import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Kata sandi transaksi (wallet password) opsional — gate Send / Lock / Unlock.
 *
 * Desain:
 *  - Terpisah dari `passwordHash` (password login). Tidak pernah dipakai untuk login.
 *  - Disimpan sebagai bcrypt hash (rounds 12, sama dengan login).
 *  - **Opsional**: `walletPasswordHash === null` ⇒ tidak ada gate (kompatibel dengan
 *    user eksisting — tidak ada perubahan UX).
 *
 * Brute-force: percobaan gagal dihitung di `walletPasswordAttempts`. Saat mencapai
 * `MAX_ATTEMPTS`, set `walletPasswordLockedUntil = now + LOCK_MS`. Reset ke 0 saat
 * verifikasi berhasil atau saat password baru diset.
 */
const BCRYPT_ROUNDS = 12;
const MAX_ATTEMPTS = 5;
const LOCK_MS = 15 * 60 * 1000; // 15 menit

export type VerifyResult =
  | { ok: true }
  | { ok: false; locked: boolean };

@Injectable()
export class WalletPasswordService {
  private readonly logger = new Logger(WalletPasswordService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Apakah user telah menetapkan wallet password? (tidak membocorkan hash). */
  async hasPassword(userId: string): Promise<boolean> {
    const u = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { walletPasswordHash: true },
    });
    return !!u?.walletPasswordHash;
  }

  /**
   * Verifikasi password. Mengembalikan `{ ok: false, locked }` bila salah / terkunci.
   * Aman terhadap timing-enumeration untuk user yang belum menetapkan password:
   * tetap menjalankan satu `bcrypt.compare` dengan hash dummy.
   */
  async verify(userId: string, password: string): Promise<VerifyResult> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        walletPasswordHash: true,
        walletPasswordAttempts: true,
        walletPasswordLockedUntil: true,
      },
    });
    if (!user) return { ok: false, locked: false };

    // Sedang dalam cooldown brute-force?
    if (
      user.walletPasswordLockedUntil &&
      user.walletPasswordLockedUntil.getTime() > Date.now()
    ) {
      return { ok: false, locked: true };
    }

    const stored = user.walletPasswordHash;
    // Hash dummy tetap di-compare agar waktu respons konsisten walau user belum set.
    const dummyHash = await this.dummyHash();
    const compareHash = stored ?? dummyHash;
    const ok = await this.safeCompare(password, compareHash);

    if (!stored) {
      // Belum set password → selalu gagal, tapi tidak menginkrementasi counter
      // (tidak ada password yang bisa ditebak). Tetap konstan-waktu.
      return { ok: false, locked: false };
    }

    if (ok) {
      if (user.walletPasswordAttempts > 0) {
        await this.prisma.user.update({
          where: { id: userId },
          data: {
            walletPasswordAttempts: 0,
            walletPasswordLockedUntil: null,
          },
        });
      }
      return { ok: true };
    }

    // Gagal → naikkan counter, kunci bila mencapai ambang.
    const attempts = user.walletPasswordAttempts + 1;
    const lock =
      attempts >= MAX_ATTEMPTS ? new Date(Date.now() + LOCK_MS) : null;
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        walletPasswordAttempts: attempts,
        walletPasswordLockedUntil: lock,
      },
    });
    if (lock) {
      this.logger.warn(
        `wallet password locked: user=${userId.slice(0, 8)} after ${attempts} failed attempts`,
      );
    }
    return { ok: false, locked: !!lock };
  }

  /** Set password pertama kali (user belum punya). */
  async setPassword(userId: string, newPassword: string): Promise<void> {
    const hash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        walletPasswordHash: hash,
        walletPasswordAttempts: 0,
        walletPasswordLockedUntil: null,
      },
    });
  }

  /**
   * Ganti password. Wajib verifikasi `currentPassword` bila user sudah mempunyai satu.
   * Bila belum punya, ini ekuivalen dengan `setPassword` (currentPassword diabaikan).
   */
  async changePassword(
    userId: string,
    newPassword: string,
    currentPassword?: string,
  ): Promise<void> {
    const has = await this.hasPassword(userId);
    if (has) {
      const r = await this.verify(userId, currentPassword ?? '');
      if (!r.ok) {
        throw r.locked
          ? new ForbiddenException(
              'Too many failed attempts. Please try again later.',
            )
          : new BadRequestException('Current wallet password is incorrect.');
      }
    }
    await this.setPassword(userId, newPassword);
  }

  /** Hapus password (menonaktifkan gate). Wajib verifikasi currentPassword. */
  async clearPassword(userId: string, currentPassword: string): Promise<void> {
    const r = await this.verify(userId, currentPassword);
    if (!r.ok) {
      throw r.locked
        ? new ForbiddenException(
            'Too many failed attempts. Please try again later.',
          )
        : new BadRequestException('Current wallet password is incorrect.');
    }
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        walletPasswordHash: null,
        walletPasswordAttempts: 0,
        walletPasswordLockedUntil: null,
      },
    });
  }

  /**
   * Helper gate untuk endpoint sensitif: lempar ForbiddenException bila user telah
   * menetapkan wallet password dan `supplied` salah / terkunci. No-op bila belum set.
   */
  async assertGate(userId: string, supplied?: string): Promise<void> {
    if (!(await this.hasPassword(userId))) return;
    const r = await this.verify(userId, supplied ?? '');
    if (!r.ok) {
      throw new ForbiddenException(
        r.locked
          ? 'Too many failed wallet password attempts. Try again later.'
          : 'Wrong wallet password.',
      );
    }
  }

  // ── internals ────────────────────────────────────────────────────────────

  /** Bandingkan password vs hash secara konstan-waktu (membungkus bcrypt). */
  private async safeCompare(password: string, hash: string): Promise<boolean> {
    try {
      return await bcrypt.compare(password, hash);
    } catch {
      return false;
    }
  }

  /**
   * Hash dummy untuk menjaga waktu respons konstan saat user belum menetapkan
   * password. Dibuat sekali per instance lalu di-cache.
   */
  private dummyCache: string | null = null;
  private async dummyHash(): Promise<string> {
    if (this.dummyCache) return this.dummyCache;
    this.dummyCache = await bcrypt.hash(randomBytes(16).toString('hex'), BCRYPT_ROUNDS);
    return this.dummyCache;
  }
}