import { Injectable } from '@nestjs/common';
import { CcTransactionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByUsername(username: string) {
    return this.prisma.user.findUnique({ where: { username } });
  }

  findByPartyId(cantonPartyId: string) {
    return this.prisma.user.findFirst({ where: { cantonPartyId } });
  }

  async create(params: {
    email: string;
    passwordHash: string;
    displayName?: string | null;
    inviteCode?: string;
    emailVerified?: boolean;
  }) {
    return this.prisma.user.create({
      data: {
        email: params.email,
        passwordHash: params.passwordHash,
        displayName: params.displayName ?? null,
        inviteCode: params.inviteCode ?? null,
        emailVerified: params.emailVerified ?? false,
      },
    });
  }

  setOtpPending(userId: string, otpCodeHash: string, otpExpiresAt: Date) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { otpCodeHash, otpExpiresAt },
    });
  }

  async setVerified(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { emailVerified: true, otpCodeHash: null, otpExpiresAt: null },
    });
  }

  async setPartyId(userId: string, cantonPartyId: string, username?: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { cantonPartyId, ...(username !== undefined ? { username } : {}) },
    });
  }

  /** Record a CC debit or credit in the local DB (audit trail). */
  async recordTransaction(params: {
    userId: string;
    amountCc: number;
    type: CcTransactionType;
    description: string;
    counterparty?: string;
    ledgerTxId?: string;
  }) {
    const amountMicroCc = BigInt(Math.round(Math.abs(params.amountCc) * 1_000_000));
    const signed =
      params.type === 'TRANSFER_OUT' ? -amountMicroCc : amountMicroCc;
    return this.prisma.ccTransaction.create({
      data: {
        userId: params.userId,
        amountMicroCc: signed,
        type: params.type,
        description: params.description,
        referenceId: params.counterparty ?? null,
        ledgerTxId: params.ledgerTxId ?? null,
        settledAt: new Date(),
      },
    });
  }

  /** Paginated transaction list for a user (newest first). BigInt serialized as string. */
  async getTransactions(userId: string, page: number, pageSize: number) {
    const skip = (page - 1) * pageSize;
    const [items, total] = await Promise.all([
      this.prisma.ccTransaction.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSize,
      }),
      this.prisma.ccTransaction.count({ where: { userId } }),
    ]);
    // Convert BigInt → string so JSON.stringify doesn't throw
    const serialized = items.map((tx) => ({
      ...tx,
      amountMicroCc: tx.amountMicroCc.toString(),
    }));
    return { items: serialized, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
  }
}
