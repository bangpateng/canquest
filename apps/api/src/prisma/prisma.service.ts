import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Batas koneksi Prisma yang eksplisit & konsisten.
 *
 * Default Prisma = ceil(2 × numCPU + 1). Di VPS 6-core → 13 koneksi. Itu
 * terlalu banyak saat pooler Supabase (PgBouncer) punya limit ketat, dan
 * ditambah Vercel serverless yang juga connect ke DB yang sama → rebutan →
 * error P2024 (pool exhausted) → login 504.
 *
 * Solusi: inject query param `connection_limit` ke process.env.DATABASE_URL
 * saat module-load (SEBELUM PrismaClient di-instantiate). Prisma baca URL dari
 * process.env saat runtime, jadi modifikasi ini JAMINAN limit = 5, terlepas
 * dari berapa core CPU atau apakah .env punya param ini.
 */
const PRISMA_CONNECTION_LIMIT = 5;

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
