import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';

/**
 * Prisma dengan driver adapter `@prisma/adapter-pg` — fix PgBouncer incompatibility.
 *
 * MASALAH: Supabase pooler port 6543 (PgBouncer, mode transaction pooling) tidak
 * support prepared statements. Engine Prisma default bikin prepared statements
 * (s1, s2, s3...) → conflict error `prepared statement "s1" already exists`
 * (Postgres code 42P05) → semua query gagal → pool habis → login 504 + admin blank.
 *
 * FIX: driver adapter `pg` mengelola connection pooling sendiri dan KOMPATIBEL
 * dengan PgBouncer (tidak pakai prepared statements). Ini fix RESMI Prisma 6
 * untuk Supabase pooler.
 *
 * Koneksi:
 *   - DATABASE_URL (pooler 6543) untuk app runtime via adapter — unlimited.
 *   - DIRECT_URL (5432) untuk migration (di-set di schema.prisma directUrl).
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
