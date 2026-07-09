import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Singleton Supabase client (server-side) memakai `service_role` key.
 *
 * Penting:
 *  - service_role BYPASS Row Level Security (RLS). Dipakai HANYA di server (Nest),
 *    tidak pernah diekspos ke browser. Setiap query lewat sini = akses penuh admin.
 *  - Untuk operasi Auth (create user, verify token, reset password) kita pakai
 *    client ini + `auth.admin.*` API.
 *  - Koneksi database (Prisma) TETAP terpisah pakai DATABASE_URL langsung; client
 *    ini hanya untuk Auth Admin API + optional data query lewat PostgREST.
 */
@Injectable()
export class SupabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(SupabaseService.name);
  readonly client: SupabaseClient;

  constructor(private readonly config: ConfigService) {
    const url = config.get<string>('SUPABASE_URL');
    const serviceRoleKey = config.get<string>('SUPABASE_SERVICE_ROLE_KEY');

    if (!url || !serviceRoleKey) {
      this.logger.warn(
        'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diset — client akan dibuat kosong. ' +
          'Auth Supabase tidak akan berfungsi sampai env diisi. Set SUPABASE_AUTH_ENABLED=false untuk pakai HS256 lama.',
      );
    }

    this.client = createClient(url ?? '', serviceRoleKey ?? '', {
      auth: {
        // Auto-refresh tidak relevan di server (kita pakai service_role).
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }

  onModuleDestroy() {
    // supabase-js tidak punya close() eksplisit; no-op.
  }
}
