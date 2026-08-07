import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Prisma dengan driver adapter `@prisma/adapter-pg` (connection pool `pg`).
 *
 * SEJARAH: awalnya dipakai untuk mengatasi PgBouncer pooler Supabase (port 6543)
 * yang tidak support prepared statements. Sekarang database production sudah
 * Postgres lokal di VPS 2 (`localhost:5432`, tanpa pooler), namun driver
 * adapter ini tetap dipertahankan karena: (1) kompatibel penuh dengan Postgres
 * lokal, (2) mengelola pool sendiri (pool size via `max`), (3) menghindari
 * potensi issue prepared-statement di kemudian hari jika pakai pooler.
 *
 * Koneksi:
 *   - DATABASE_URL → app runtime via adapter (pool lokal di VPS 2).
 *   - DIRECT_URL   → prisma migrate deploy (di-set di schema.prisma directUrl).
 *     Pada Postgres lokal, nilainya SAMA dengan DATABASE_URL.
 */
function buildAdapterOptions(): { adapter?: PrismaPg } {
  const url = process.env.DATABASE_URL;
  if (!url) return {}; // Fallback ke engine default (mis. saat test).
  const pool = new Pool({ connectionString: url, max: 10 });
  return { adapter: new PrismaPg(pool) };
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super(buildAdapterOptions());
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
