/**
 * PasskeyController — WebAuthn endpoints untuk enrollment + verification transaksi.
 *
 * Menggantikan wallet-password management endpoints (GET/POST/DELETE /party/wallet-password).
 *
 * Routes (semua butuh JWT auth — req.user.userId):
 *   GET    /party/passkey                              — status + list credentials
 *   POST   /party/passkey/registration/options         — challenge untuk enroll
 *   POST   /party/passkey/registration/verify          — simpan credential + return backup codes
 *   DELETE /party/passkey/:credentialId                 — hapus device
 *   POST   /party/passkey/authentication/options        — challenge untuk verify transaksi
 *   POST   /party/passkey/authentication/verify         — return verification token (90s JWT)
 *   POST   /party/passkey/backup/regenerate             — re-issue 10 backup codes
 *   POST   /party/passkey/recover                       — backup code → enroll device baru
 *
 * Frontend: passkey options/verify dipakai di PasskeyModal + PasskeyEnrollModal +
 * Settings panel. Verification token dikirim ke endpoint transaksi (send/swap/lock).
 */

import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Logger,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { PasskeyService } from './passkey.service';
import { UsersService } from '../users/users.service';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/types';

type AuthedReq = Request & { user: { userId: string; email: string } };

@Controller('party/passkey')
@UseGuards(AuthGuard('jwt'))
export class PasskeyController {
  private readonly logger = new Logger(PasskeyController.name);

  constructor(
    private readonly passkey: PasskeyService,
    private readonly users: UsersService,
  ) {}

  /** GET /party/passkey — status enrollment + list credentials (Settings page). */
  @Get()
  async getStatus(@Req() req: AuthedReq) {
    const [hasPasskey, credentials] = await Promise.all([
      this.passkey.hasPasskey(req.user.userId),
      this.passkey.listCredentials(req.user.userId),
    ]);
    return { hasPasskey, credentials };
  }

  /** POST /party/passkey/registration/options — challenge untuk navigator.credentials.create(). */
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @Post('registration/options')
  async registrationOptions(@Req() req: AuthedReq) {
    const user = await this.users.findById(req.user.userId);
    const displayName =
      user?.displayName || user?.username || req.user.email || 'user';
    const options = await this.passkey.generateRegistrationOptions(
      req.user.userId,
      displayName,
    );
    return options;
  }

  /**
   * POST /party/passkey/registration/verify — verify attestation, simpan credential.
   * Return backup codes KALAU first enrollment (display sekali saja di frontend).
   */
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @Post('registration/verify')
  async registrationVerify(
    @Req() req: AuthedReq,
    @Body() body: { response: unknown; deviceLabel?: string },
  ) {
    if (!body?.response) {
      throw new ForbiddenException('response (WebAuthn attestation) is required.');
    }
    const result = await this.passkey.verifyRegistration(
      req.user.userId,
      // Cast: simplewebauthn types dari @simplewebauthn/types (RegistrationResponseJSON).
      body.response as RegistrationResponseJSON,
      body.deviceLabel,
    );
    return result;
  }

  /** DELETE /party/passkey/:credentialId — hapus device (Settings). */
  @Throttle({ auth: { limit: 10, ttl: 60_000 } })
  @Delete(':credentialId')
  async removeCredential(
    @Req() req: AuthedReq,
    @Param('credentialId') credentialId: string,
  ) {
    await this.passkey.removeCredential(req.user.userId, credentialId);
    return { ok: true };
  }

  /** POST /party/passkey/authentication/options — challenge untuk navigator.credentials.get(). */
  @Throttle({ auth: { limit: 20, ttl: 60_000 } })
  @Post('authentication/options')
  async authenticationOptions(@Req() req: AuthedReq) {
    const options = await this.passkey.generateAuthenticationOptions(
      req.user.userId,
    );
    return options;
  }

  /**
   * POST /party/passkey/authentication/verify — verify assertion → verification token.
   * Token (90s JWT) dikirim ke endpoint transaksi sebagai `txVerification`.
   */
  @Throttle({ auth: { limit: 20, ttl: 60_000 } })
  @Post('authentication/verify')
  async authenticationVerify(
    @Req() req: AuthedReq,
    @Body() body: { response: unknown },
  ) {
    if (!body?.response) {
      throw new ForbiddenException('response (WebAuthn assertion) is required.');
    }
    const result = await this.passkey.verifyAuthentication(
      req.user.userId,
      body.response as AuthenticationResponseJSON,
    );
    return result;
  }

  /**
   * POST /party/passkey/backup/regenerate — re-issue 10 backup codes baru.
   * Caller harus sudah pass passkey verify (verification token) di header transaksi
   * TIDAK berlaku di sini — endpoint ini regenerate setelah user verify passkey
   * via flow authentication (verification token dikirim sebagai txVerification body).
   */
  @Throttle({ auth: { limit: 5, ttl: 60_000 } })
  @Post('backup/regenerate')
  async regenerateBackupCodes(
    @Req() req: AuthedReq,
    @Body() body: { txVerification?: string },
  ) {
    // Gate: wajib passkey verify dulu (reuse assertGate).
    await this.passkey.assertGate(req.user.userId, body.txVerification);
    const codes = await this.passkey.regenerateBackupCodes(req.user.userId);
    this.logger.log(
      `Backup codes regenerated for user ${req.user.userId.slice(0, 8)}`,
    );
    return { backupCodes: codes };
  }

  /**
   * POST /party/passkey/recover — recovery flow (all devices lost).
   * Body: { backupCode }. Verify → return recovery token untuk enroll device baru.
   * Note: recovery token = bisa langsung call registration/verify tanpa passkey.
   * Implementasi MVP: verify backup code → return { recovered: true }, frontend
   * lalu call registration/options + registration/verify (yang tidak butuh passkey).
   */
  @Throttle({ auth: { limit: 5, ttl: 60_000 } })
  @Post('recover')
  async recover(@Req() req: AuthedReq, @Body() body: { backupCode?: string }) {
    if (!body?.backupCode) {
      throw new ForbiddenException('backupCode is required.');
    }
    const ok = await this.passkey.verifyBackupCode(
      req.user.userId,
      body.backupCode,
    );
    if (!ok) {
      throw new ForbiddenException('Invalid or used backup code.');
    }
    // Set passkeyEnrolledAt null supaya enrollment berikutnya dianggap "first"
    // → generate backup codes baru (yang lama sudah reduced by 1 dari yang dipakai).
    // Simplifikasi: user recover → enroll device baru → dapat backup codes fresh.
    this.logger.log(
      `Recovery initiated for user ${req.user.userId.slice(0, 8)} via backup code`,
    );
    return { recovered: true };
  }
}
