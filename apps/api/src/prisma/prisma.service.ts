import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Batas koneksi Prisma yang eksplisit & konsisten.
 *
 * Default Prisma = ceil(2 × numCPU + 1). Di VPS 6-core → 13 koneksi. Tapi tanpa
 * limit eksplisit, Prisma kadang pakai default CPU. Supaya konsisten, inject
 * `connection_limit` ke DATABASE_URL saat module-load (sebelum PrismaClient
 * construct). 10 = match dengan param di .env + aman (DB Supabase 60 slot,
 * dipakai ~16 → masih longgar).
 *
 * JANGAN terlalu kecil (mis. 5) — app punya banyak operasi concurrent
 * (maintenance + login + WSS handler + background services) → pool habis
 * lebih cepat dari 13 default. 10 = sweet spot.
 */
const PRISMA_CONNECTION_LIMIT = 10;

// Mutate process.env.DATABASE_URL sekali saat module load — sebelum class
// PrismaClient di-construct (dia baca env saat instantiation).
if (process.env.DATABASE_URL) {
  const url = process.env.DATABASE_URL;
  if (/[?&]connection_limit=/.test(url)) {
    process.env.DATABASE_URL = url.replace(
      /([?&]connection_limit=)\d+/,
      `$1${PRISMA_CONNECTION_LIMIT}`,
    );
  } else {
    const sep = url.includes('?') ? '&' : '?';
    process.env.DATABASE_URL = `${url}${sep}connection_limit=${PRISMA_CONNECTION_LIMIT}`;
  }
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
