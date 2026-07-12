/**
 * PasskeyService — WebAuthn (passkey) untuk gate transaksi, menggantikan wallet password.
 *
 * Arsitektur:
 *   1. User enroll passkey (registration) → simpan PasskeyCredential + generate backup codes.
 *   2. Saat transaksi (send/swap/lock/unlock), user verify passkey (authentication) →
 *      backend issue SHORT-LIVED verification token (JWT 90s).
 *   3. Token dikirim ke endpoint transaksi (field `txVerification`) → assertGate verify.
 *
 * Kenapa verification token (bukan verify assertion langsung di endpoint transaksi)?
 *   WebAuthn assertion itu one-shot + challenge-bound. Tidak bisa di-replay untuk
 *   swap retry (8s/16s backoff). Verification token (90s) cukup cover beberapa retry
 *   tanpa user harus Face ID berkali-kali.
 *
 * Recovery: kalau semua device hilang, user pakai backup code (10 kode pre-generated
 * saat enrollment) untuk enroll device baru. Backup code = bcrypt hash, one-time use.
 *
 * Multi-device: user bisa daftar multiple passkey (iPhone + laptop + dll).
 *
 * @simplewebauthn/server v10 API:
 *   generateRegistrationOptions / verifyRegistrationResponse
 *   generateAuthenticationOptions / verifyAuthenticationResponse
 */

import { Injectable, ForbiddenException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import bcrypt from 'bcrypt';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifiedRegistrationResponse,
  type VerifiedAuthenticationResponse,
} from '@simplewebauthn/server';
// Response JSON types live in @simplewebauthn/types (transitive dep of server).
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/types';

/** RP (Relying Party) = web app Anda. Passkey ter-bound ke domain ini. */
const DEFAULT_RP_ID = 'canquest.cc';
const DEFAULT_RP_NAME = 'CanQuest';
const DEFAULT_ORIGIN = 'https://www.canquest.cc';

/** Verification token lifetime — cukup untuk swap retry (8s+16s backoff). */
const TX_VERIFY_TOKEN_TTL_SECONDS = 90;

/** Challenge TTL — user punya waktu ini untuk complete WebAuthn ceremony. */
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

/** Backup code config. */
const BACKUP_CODE_COUNT = 10;
const BACKUP_CODE_ROUNDS = 12;

/** Format backup code: XXXX-XXXX-XXXX (12 alphanumeric). */
function generateBackupCode(): string {
  // Cryptographically random via node crypto (fallback Math.random tidak aman).
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no ambiguous chars (0/O/1/I)
  const { randomBytes } = require('crypto') as typeof import('crypto');
  const bytes = randomBytes(9);
  let out = '';
  for (let i = 0; i < 9; i++) out += chars[bytes[i] % chars.length];
  return `${out.slice(0, 3)}-${out.slice(3, 6)}-${out.slice(6, 9)}`;
}

/** In-memory challenge store (TTL). Untuk multi-instance API → pindah ke Redis. */
interface ChallengeEntry {
  challenge: string;
  expiresAt: number;
}

@Injectable()
export class PasskeyService {
  private readonly logger = new Logger(PasskeyService.name);
  private readonly rpID: string;
  private readonly rpName: string;
  private readonly expectedOrigin: string;

  /** Challenge per-user untuk registration + authentication (keyed by userId). */
  private readonly regChallenges = new Map<string, ChallengeEntry>();
  private readonly authChallenges = new Map<string, ChallengeEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
  ) {
    this.rpID = this.config.get<string>('PASSKEY_RP_ID') ?? DEFAULT_RP_ID;
    this.rpName =
      this.config.get<string>('PASSKEY_RP_NAME') ?? DEFAULT_RP_NAME;
    this.expectedOrigin =
      this.config.get<string>('PASSKEY_ORIGIN') ?? DEFAULT_ORIGIN;
    // Startup warning kalau pakai default (kemungkinan lupa set env di prod).
    if (
      this.rpID === DEFAULT_RP_ID &&
      !this.config.get<string>('PASSKEY_RP_ID')
    ) {
      this.logger.warn(
        `PASSKEY_RP_ID tidak diset — pakai default "${this.rpID}". Set di env untuk prod.`,
      );
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Status queries
  // ═══════════════════════════════════════════════════════════════════════

  /** User punya passkey terdaftar? (frontend: "sudah enroll?") */
  async hasPasskey(userId: string): Promise<boolean> {
    const count = await this.prisma.passkeyCredential.count({
      where: { userId },
    });
    return count > 0;
  }

  /** List device terdaftar (Settings page). */
  async listCredentials(userId: string) {
    return this.prisma.passkeyCredential.findMany({
      where: { userId },
      select: {
        id: true,
        deviceLabel: true,
        createdAt: true,
        lastUsedAt: true,
        transports: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Registration (enroll device baru)
  // ═══════════════════════════════════════════════════════════════════════

  /** Generate registration options (challenge) untuk navigator.credentials.create(). */
  async generateRegistrationOptions(
    userId: string,
    userDisplayName: string,
  ) {
    // Exclude existing credentials supaya user tidak daftar device sama 2x.
    const existing = await this.prisma.passkeyCredential.findMany({
      where: { userId },
      select: { id: true, transports: true },
    });
    const excludeCredentials = existing.map((c) => ({
      id: c.id,
      // transports opsional (UX hint ajaib browser); skip — exclude by id cukup.
    }));

    const options = await generateRegistrationOptions({
      rpName: this.rpName,
      rpID: this.rpID,
      userID: Buffer.from(userId, 'utf8'),
      userName: userDisplayName || userId,
      // Attestation none — kita tidak butuh attestation (device trust chain).
      // Lebih privacy-friendly + cepat.
      attestationType: 'none',
      excludeCredentials,
      authenticatorSelection: {
        // Resident key preferred — device bisa simpan credential locally,
        // user tidak perlu select credential manual.
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
    });

    this.regChallenges.set(userId, {
      challenge: options.challenge,
      expiresAt: Date.now() + CHALLENGE_TTL_MS,
    });
    return options;
  }

  /**
   * Verify registration response dari browser → simpan credential.
   * Generate backup codes KALAU ini enrollment pertama (sebelumnya tidak ada credential).
   * Return backup codes plaintext (display sekali di frontend, tidak disimpan ulang).
   */
  async verifyRegistration(
    userId: string,
    response: RegistrationResponseJSON,
    deviceLabel?: string,
  ): Promise<{ credentialId: string }> {
    const entry = this.regChallenges.get(userId);
    if (!entry || entry.expiresAt < Date.now()) {
      throw new ForbiddenException(
        'Registration challenge expired or missing. Coba lagi.',
      );
    }
    this.regChallenges.delete(userId);

    let verification: VerifiedRegistrationResponse;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge: entry.challenge,
        expectedOrigin: this.expectedOrigin,
        expectedRPID: this.rpID,
        requireUserVerification: true,
      });
    } catch (err) {
      throw new ForbiddenException(
        `Registration verification failed: ${(err as Error).message}`,
      );
    }

    if (!verification.verified || !verification.registrationInfo) {
      throw new ForbiddenException('Registration not verified.');
    }
    const info = verification.registrationInfo;

    // Cek duplikat (race: 2 device daftar credential sama barengan).
    const existing = await this.prisma.passkeyCredential.findUnique({
      where: { id: info.credentialID },
    });
    if (existing) {
      throw new ForbiddenException('Credential already registered.');
    }

    // Apakah ini enrollment pertama? Kalau ya → generate backup codes.
    const isFirstEnrollment = !(await this.hasPasskey(userId));

    // Simpan credential. publicKey = Buffer (Prisma Bytes).
    // transports datang dari client response (browser kasih hint internal/hybrid/usb).
    const transports =
      (response.response.transports as string[] | undefined) ?? [];
    await this.prisma.passkeyCredential.create({
      data: {
        id: info.credentialID,
        userId,
        publicKey: Buffer.from(info.credentialPublicKey),
        counter: info.counter,
        transports,
        deviceLabel: deviceLabel ?? null,
      },
    });

    // Set passkeyEnrolledAt kalau enrollment pertama.
    if (isFirstEnrollment) {
      await this.prisma.user.update({
        where: { id: userId },
        data: { passkeyEnrolledAt: new Date() },
      });
      // Generate backup codes internal (TIDAK ditampilkan ke user — untuk
      // admin recovery flow nanti). User experience: setup passkey → selesai.
      await this.generateBackupCodesInternal(userId);
      this.logger.log(
        `Passkey enrolled (first) for user ${userId.slice(0, 8)} — ${BACKUP_CODE_COUNT} backup codes generated internally`,
      );
      return { credentialId: info.credentialID };
    }

    this.logger.log(
      `Additional passkey enrolled for user ${userId.slice(0, 8)} (total now >1)`,
    );
    return { credentialId: info.credentialID };
  }

  /** Hapus credential (device) — user remove device di Settings. */
  async removeCredential(userId: string, credentialId: string): Promise<void> {
    const cred = await this.prisma.passkeyCredential.findUnique({
      where: { id: credentialId },
    });
    if (!cred || cred.userId !== userId) {
      throw new ForbiddenException('Credential not found or not yours.');
    }
    await this.prisma.passkeyCredential.delete({ where: { id: credentialId } });
    this.logger.log(
      `Passkey removed for user ${userId.slice(0, 8)} (credential ${credentialId.slice(0, 12)}…)`,
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Authentication (verify passkey untuk transaksi)
  // ═══════════════════════════════════════════════════════════════════════

  /** Generate authentication options (challenge) untuk navigator.credentials.get(). */
  async generateAuthenticationOptions(userId: string) {
    const creds = await this.prisma.passkeyCredential.findMany({
      where: { userId },
      select: { id: true, transports: true },
    });
    if (creds.length === 0) {
      throw new ForbiddenException({
        code: 'PASSKEY_NOT_ENROLLED',
        message: 'Setup passkey dulu untuk transaksi.',
      });
    }
    const allowCredentials = creds.map((c) => ({
      id: c.id,
      // transports opsional (UX hint); allow by id cukup untuk most authenticators.
    }));

    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      allowCredentials,
      userVerification: 'preferred',
    });

    this.authChallenges.set(userId, {
      challenge: options.challenge,
      expiresAt: Date.now() + CHALLENGE_TTL_MS,
    });
    return options;
  }

  /**
   * Verify authentication response → issue verification token (JWT 90s).
   * Token ini dikirim ke endpoint transaksi sebagai `txVerification`.
   */
  async verifyAuthentication(
    userId: string,
    response: AuthenticationResponseJSON,
  ): Promise<{ verificationToken: string }> {
    const entry = this.authChallenges.get(userId);
    if (!entry || entry.expiresAt < Date.now()) {
      throw new ForbiddenException(
        'Authentication challenge expired or missing. Coba lagi.',
      );
    }
    this.authChallenges.delete(userId);

    const cred = await this.prisma.passkeyCredential.findUnique({
      where: { id: response.id },
    });
    if (!cred || cred.userId !== userId) {
      throw new ForbiddenException('Credential not found or not yours.');
    }

    let verification: VerifiedAuthenticationResponse;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: entry.challenge,
        expectedOrigin: this.expectedOrigin,
        expectedRPID: this.rpID,
        authenticator: {
          credentialID: cred.id,
          credentialPublicKey: new Uint8Array(cred.publicKey),
          counter: cred.counter,
          // transports di DB string[]; cast ke literal union (nilai valid: internal/hybrid/usb/ble/nfc).
          transports: cred.transports as never[],
        },
        requireUserVerification: true,
      });
    } catch (err) {
      throw new ForbiddenException(
        `Authentication verification failed: ${(err as Error).message}`,
      );
    }

    if (!verification.verified) {
      throw new ForbiddenException('Authentication not verified.');
    }

    // Counter handling: banyak platform authenticator (Face ID/Touch ID/Windows
    // Hello) TIDAK increment counter (selalu 0). Jadi clone-detection via counter
    // tidak reliable untuk mereka. Strategi aman: simpan max(stored, new). Kalau
    // newCounter < stored, log warning (anomali) tapi JANGAN hapus credential —
    // false positive akan lock user dari wallet mereka (bug serius).
    const newCounter = verification.authenticationInfo.newCounter;
    if (newCounter !== cred.counter && newCounter < cred.counter) {
      this.logger.warn(
        `Passkey counter anomaly for user ${userId.slice(0, 8)}: ` +
          `stored=${cred.counter} new=${newCounter}. Keeping credential ` +
          `(platform authenticators may not increment counter).`,
      );
    }
    const effectiveCounter = Math.max(cred.counter, newCounter);

    // Update counter + lastUsedAt.
    await this.prisma.passkeyCredential.update({
      where: { id: cred.id },
      data: { counter: effectiveCounter, lastUsedAt: new Date() },
    });

    // Issue verification token (short-lived JWT).
    const token = await this.jwt.signAsync(
      { sub: userId, type: 'tx-verify', credentialId: cred.id },
      { expiresIn: TX_VERIFY_TOKEN_TTL_SECONDS },
    );

    return { verificationToken: token };
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Transaction gate (replace WalletPasswordService.assertGate)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Gate transaksi: user HARUS punya passkey + verification token valid.
   * Signature mirror WalletPasswordService.assertGate supaya call-site minim berubah.
   *
   * @param userId - user yang transaksi
   * @param txVerification - verification token (JWT 90s) dari verifyAuthentication
   * @throws ForbiddenException kalau: belum enroll / token invalid / token expired
   */
  async assertGate(userId: string, txVerification?: string): Promise<void> {
    // 1. Forced enrollment: user WAJIB punya passkey.
    if (!(await this.hasPasskey(userId))) {
      throw new ForbiddenException({
        code: 'PASSKEY_NOT_ENROLLED',
        message: 'Setup passkey dulu untuk transaksi.',
      });
    }

    // 2. Verification token required + valid.
    if (!txVerification) {
      throw new ForbiddenException({
        code: 'PASSKEY_VERIFY_REQUIRED',
        message: 'Verify passkey untuk konfirmasi transaksi.',
      });
    }

    try {
      const payload = await this.jwt.verifyAsync<{
        sub: string;
        type: string;
        credentialId: string;
      }>(txVerification);
      if (payload.type !== 'tx-verify') {
        throw new Error('wrong token type');
      }
      if (payload.sub !== userId) {
        // Token milik user lain — kemungkinan serangan. Tolak.
        throw new Error('token bound to different user');
      }
    } catch {
      throw new ForbiddenException({
        code: 'PASSKEY_VERIFY_EXPIRED',
        message:
          'Passkey verification expired. Verifikasi ulang dan coba lagi.',
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // Backup codes (recovery)
  // ═══════════════════════════════════════════════════════════════════════

  /**
   * Generate N backup codes, store hash, return plaintext (sekali saja).
   * Dipakai internal: saat first enrollment + regenerate.
   */
  private async generateBackupCodesInternal(userId: string): Promise<string[]> {
    const codes: string[] = [];
    const hashes: { codeHash: string }[] = [];
    for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
      const code = generateBackupCode();
      codes.push(code);
      hashes.push({ codeHash: await bcrypt.hash(code, BACKUP_CODE_ROUNDS) });
    }
    // Bulk insert.
    await this.prisma.backupCode.createMany({
      data: hashes.map((h) => ({ userId, codeHash: h.codeHash })),
    });
    return codes;
  }

  /**
   * Regenerate backup codes (butuh passkey verify dulu — caller must assertGate).
   * Hapus kode lama (yang belum dipakai), generate baru. Return plaintext.
   */
  async regenerateBackupCodes(userId: string): Promise<string[]> {
    // Hapus unused backup codes (yang sudah dipakai tetap untuk audit).
    await this.prisma.backupCode.deleteMany({
      where: { userId, usedAt: null },
    });
    return this.generateBackupCodesInternal(userId);
  }

  /**
   * Verify backup code (recovery: all devices lost). One-time use.
   * Return true kalau valid → caller allow enroll device baru.
   */
  async verifyBackupCode(userId: string, code: string): Promise<boolean> {
    const candidates = await this.prisma.backupCode.findMany({
      where: { userId, usedAt: null },
    });
    if (candidates.length === 0) return false;

    // Constant-time-ish: compare semua (hindari timing leak kalau kode mana yang match).
    let matchedId: string | null = null;
    await Promise.all(
      candidates.map(async (c) => {
        if (await bcrypt.compare(code, c.codeHash)) {
          matchedId = c.id;
        }
      }),
    );
    if (!matchedId) return false;

    // Mark used (one-time).
    await this.prisma.backupCode.update({
      where: { id: matchedId },
      data: { usedAt: new Date() },
    });
    this.logger.log(
      `Backup code used for recovery by user ${userId.slice(0, 8)}`,
    );
    return true;
  }
}
