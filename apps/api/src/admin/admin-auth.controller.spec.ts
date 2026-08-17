import { InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import * as bcrypt from 'bcrypt';
import { Secret, TOTP } from 'otpauth';

import { AdminAuthController } from './admin-auth.controller';

/**
 * TOTP 2FA di login admin:
 * - password benar + kode benar → token terbit
 * - kode salah / hilang → Unauthorized (dan ikut lockout)
 * - kode sama tidak bisa dipakai ulang (replay guard)
 * - production tanpa ADMIN_TOTP_SECRET → login ditolak (fail-closed)
 */
describe('AdminAuthController — login + TOTP 2FA', () => {
  const EMAIL = 'admin@canquest.cc';
  const PASSWORD = 'S3cretPassword!';
  const REQ = { ip: '203.0.113.10' } as never;

  let controller: AdminAuthController;
  let totp: TOTP;

  function makeController(env: Record<string, string>) {
    const config = {
      get: (key: string) => env[key],
    } as unknown as ConfigService;
    return new AdminAuthController(
      { signAsync: async () => 'test-token' } as unknown as JwtService,
      config,
    );
  }

  beforeEach(() => {
    const secret = new Secret(); // random 20 byte
    const hash = bcrypt.hashSync(PASSWORD, 4); // rounds rendah agar test cepat
    totp = new TOTP({
      issuer: 'CanQuest Admin',
      label: EMAIL,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret,
    });
    controller = makeController({
      NODE_ENV: 'production',
      ADMIN_PANEL_EMAIL: EMAIL,
      ADMIN_PANEL_PASSWORD_HASH: hash,
      ADMIN_TOTP_SECRET: secret.base32,
    });
  });

  it('password + kode TOTP benar → token terbit', async () => {
    const res = await controller.login(REQ, {
      email: EMAIL,
      password: PASSWORD,
      totpCode: totp.generate(),
    });
    expect(res.accessToken).toBe('test-token');
  });

  it('kode TOTP salah → Unauthorized', async () => {
    await expect(
      controller.login(REQ, {
        email: EMAIL,
        password: PASSWORD,
        totpCode: '000000',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('kode TOTP tidak dikirim → Unauthorized', async () => {
    await expect(
      controller.login(REQ, { email: EMAIL, password: PASSWORD }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('kode TOTP yang sama tidak bisa dipakai ulang (replay guard)', async () => {
    const code = totp.generate();
    await controller.login(REQ, {
      email: EMAIL,
      password: PASSWORD,
      totpCode: code,
    });
    await expect(
      controller.login(REQ, {
        email: EMAIL,
        password: PASSWORD,
        totpCode: code,
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('production tanpa ADMIN_TOTP_SECRET → login ditolak (fail-closed)', async () => {
    const hash = bcrypt.hashSync(PASSWORD, 4);
    const prodNoTotp = makeController({
      NODE_ENV: 'production',
      ADMIN_PANEL_EMAIL: EMAIL,
      ADMIN_PANEL_PASSWORD_HASH: hash,
    });
    await expect(
      prodNoTotp.login(REQ, {
        email: EMAIL,
        password: PASSWORD,
        totpCode: '123456',
      }),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('non-production tanpa ADMIN_TOTP_SECRET → boleh login tanpa kode (dev)', async () => {
    const hash = bcrypt.hashSync(PASSWORD, 4);
    const devNoTotp = makeController({
      NODE_ENV: 'development',
      ADMIN_PANEL_EMAIL: EMAIL,
      ADMIN_PANEL_PASSWORD_HASH: hash,
    });
    const res = await devNoTotp.login(REQ, {
      email: EMAIL,
      password: PASSWORD,
    });
    expect(res.accessToken).toBe('test-token');
  });

  it('password salah → Unauthorized walau kode TOTP benar', async () => {
    await expect(
      controller.login(REQ, {
        email: EMAIL,
        password: 'wrong-password',
        totpCode: totp.generate(),
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
