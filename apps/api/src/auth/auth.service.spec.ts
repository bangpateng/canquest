import { createHash } from 'crypto';

import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';

import { AuthService } from './auth.service';
import { ResendEmailService } from './resend-email.service';
import { UsersService } from '../users/users.service';
import { ReferralService } from '../users/referral.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Unit test jalur uang-adjacent paling kritis: siklus sesi.
 * Register → Login → Refresh ROTATION (refresh token lama wajib revoked).
 * Bug kelas ini (sesi 15 menit / refresh tak terpakai) pernah terjadi diam-diam.
 */

type UserRow = {
  id: string;
  email: string;
  passwordHash: string;
  emailVerified: boolean;
  status: string;
  otpCodeHash: string | null;
  otpExpiresAt: Date | null;
  otpAttempts: number | null;
};

function makeUser(over: Partial<UserRow> = {}): UserRow {
  return {
    id: 'user-1',
    email: 'arie@gmail.com',
    passwordHash: '$2b$12$somehash',
    emailVerified: true,
    status: 'ACTIVE',
    otpCodeHash: null,
    otpExpiresAt: null,
    otpAttempts: 0,
    ...over,
  };
}

describe('AuthService — register / login / refresh', () => {
  let service: AuthService;
  let users: { [K in keyof UsersService]: jest.Mock };
  let referral: { [K in keyof ReferralService]: jest.Mock };
  let prisma: {
    refreshToken: {
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
      deleteMany: jest.Mock;
    };
  };
  let jwt: { signAsync: jest.Mock };
  let resend: { sendOtpEmail: jest.Mock };

  const REAL_PASSWORD = 'SuperSecret123!';

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = 'test-secret-for-hmac-32-chars-min!!';
    process.env.AUTH_REGISTER_SKIP_OTP = 'false';
  });

  beforeEach(async () => {
    users = {
      findByEmail: jest.fn(),
      findById: jest.fn(),
      create: jest.fn(),
      setVerified: jest.fn(),
      setOtpPending: jest.fn(),
      resumeUnverifiedRegistration: jest.fn(),
      clearOtp: jest.fn(),
    } as unknown as { [K in keyof UsersService]: jest.Mock };
    referral = {
      generateUniqueReferralCode: jest.fn().mockResolvedValue('ARIE123'),
      completeReferralForUser: jest.fn().mockResolvedValue(undefined),
      findReferrerByCode: jest.fn(),
    } as unknown as { [K in keyof ReferralService]: jest.Mock };
    prisma = {
      refreshToken: {
        findUnique: jest.fn(),
        create: jest.fn().mockResolvedValue({}),
        update: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    } as unknown as typeof prisma;
    jwt = { signAsync: jest.fn().mockResolvedValue('access-token-1') };
    resend = { sendOtpEmail: jest.fn().mockResolvedValue(undefined) };

    service = new AuthService(
      users as unknown as UsersService,
      referral as unknown as ReferralService,
      prisma as unknown as PrismaService,
      jwt as unknown as JwtService,
      resend as unknown as ResendEmailService,
    );
  });

  describe('register', () => {
    it('menolak email disposable (anti-sybil)', async () => {
      await expect(
        service.register({
          email: 'farmer@mailinator.com',
          password: REAL_PASSWORD,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(users.create).not.toHaveBeenCalled();
    });

    it('user baru → buat user + kirim OTP (bukan token langsung)', async () => {
      users.findByEmail.mockResolvedValue(null);
      users.create.mockResolvedValue(
        makeUser({ emailVerified: false, id: 'new-1' }),
      );
      users.findById.mockResolvedValue(makeUser({ id: 'new-1' }));

      const res = await service.register({
        email: 'arie@gmail.com',
        password: REAL_PASSWORD,
      });

      expect(users.create).toHaveBeenCalledTimes(1);
      expect(resend.sendOtpEmail).toHaveBeenCalledTimes(1);
      expect(res).toHaveProperty('userId');
      expect(res).not.toHaveProperty('accessToken');
    });

    it('email terverifikasi yang register lagi → Conflict', async () => {
      users.findByEmail.mockResolvedValue(makeUser());
      await expect(
        service.register({ email: 'arie@gmail.com', password: REAL_PASSWORD }),
      ).rejects.toThrow('Email already registered');
    });
  });

  describe('login', () => {
    it('password salah → Unauthorized (pesan generik, tidak bocor ada/tidaknya email)', async () => {
      users.findByEmail.mockResolvedValue(
        makeUser({ passwordHash: await bcrypt.hash(REAL_PASSWORD, 4) }),
      );
      await expect(
        service.login({ email: 'arie@gmail.com', password: 'wrong-pass' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('user BANNED dengan password benar → Forbidden (bukan Unauthorized)', async () => {
      users.findByEmail.mockResolvedValue(
        makeUser({
          status: 'BANNED',
          passwordHash: await bcrypt.hash(REAL_PASSWORD, 4),
        }),
      );
      await expect(
        service.login({ email: 'arie@gmail.com', password: REAL_PASSWORD }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('login sukses → access + refresh token & row refresh dibuat', async () => {
      users.findByEmail.mockResolvedValue(
        makeUser({ passwordHash: await bcrypt.hash(REAL_PASSWORD, 4) }),
      );
      const res = await service.login({
        email: 'arie@gmail.com',
        password: REAL_PASSWORD,
      });

      expect(res.accessToken).toBe('access-token-1');
      expect(res.refreshToken).toMatch(/^[0-9a-f]{96}$/); // 48 bytes hex
      // Refresh token disimpan sebagai HASH sha256, bukan plaintext.
      const storedHash = prisma.refreshToken.create.mock.calls[0][0]
        .data.tokenHash as string;
      expect(storedHash).toBe(
        createHash('sha256').update(res.refreshToken).digest('hex'),
      );
      expect(storedHash).not.toBe(res.refreshToken);
    });
  });

  describe('refresh — ROTASI wajib', () => {
    const rawToken = 'f'.repeat(96);
    const tokenHash = createHash('sha256').update(rawToken).digest('hex');

    function seedRefreshRow(over: Partial<{
      revokedAt: Date | null;
      expiresAt: Date;
      user: UserRow;
    }> = {}) {
      prisma.refreshToken.findUnique.mockResolvedValue({
        id: 'rt-1',
        tokenHash,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86_400_000),
        user: makeUser(),
        ...over,
      });
    }

    it('token tidak dikenal → Unauthorized', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);
      await expect(service.refresh(rawToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('token sudah revoked (dipakai ulang) → Unauthorized', async () => {
      seedRefreshRow({ revokedAt: new Date() });
      await expect(service.refresh(rawToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('token expired → Unauthorized', async () => {
      seedRefreshRow({ expiresAt: new Date(Date.now() - 1_000) });
      await expect(service.refresh(rawToken)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('user BANNED tidak bisa refresh — sesi mati saat access token habis', async () => {
      seedRefreshRow({ user: makeUser({ status: 'BANNED' }) });
      await expect(service.refresh(rawToken)).rejects.toThrow(
        UnauthorizedException,
      );
      expect(prisma.refreshToken.update).not.toHaveBeenCalled();
    });

    it('valid → token lama REVOKED + token baru diterbitkan (rotasi)', async () => {
      seedRefreshRow();
      jwt.signAsync.mockResolvedValue('access-token-2');

      const res = await service.refresh(rawToken);

      expect(res.accessToken).toBe('access-token-2');
      expect(prisma.refreshToken.update).toHaveBeenCalledWith({
        where: { id: 'rt-1' },
        data: { revokedAt: expect.any(Date) },
      });
      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
      // Refresh baru HARUS berbeda dari yang lama.
      expect(res.refreshToken).not.toBe(rawToken);
    });
  });
});
