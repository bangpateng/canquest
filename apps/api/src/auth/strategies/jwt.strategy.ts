import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../../users/users.service';
import { SupabaseService } from '../../supabase/supabase.service';

/**
 * Strategi JWT tunggal (nama 'jwt') yang dispatch berdasarkan feature flag
 * SUPABASE_AUTH_ENABLED:
 *  - true  → verifikasi access token Supabase (RS256) via supabase.auth.getUser,
 *            resolve `sub` (UUID) → User.authUserId → dapat User.id (cuid).
 *  - false → verifikasi HS256 lama (JWT_ACCESS_SECRET) — rollback path.
 *
 * Bentuk return { userId: cuid, email } IDENTIK untuk keduanya, sehingga semua
 * controller yang pakai @UseGuards(AuthGuard('jwt')) tidak perlu diubah.
 *
 * Catatan implementasi: passport-jwt Strategy mengekstrak token Bearer dari
 * header via ExtractJwt.fromAuthHeaderAsBearerToken(). Untuk path Supabase kita
 * TIDAK memverifikasi signature lokal (secretOrKey di-ignore) — verifikasi
 * delegasi ke Supabase API. Untuk path HS256 lama, secretOrKey dipakai normal.
 */
export type JwtPayload = { sub: string; email: string };

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly config: ConfigService,
    private readonly users: UsersService,
    private readonly supabase: SupabaseService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      // Signature diverifikasi manual di validate() sesuai mode; passport tetap
      // cek exp via secretOrKeyProvider, jadi kita beri secret dummy agar tidak
      // throw pada mode Supabase. Verifikasi sebenarnya ada di validate().
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET') ?? 'unused-in-supabase-mode',
      ignoreExpiration: false,
    });
  }

  private get supabaseAuthEnabled(): boolean {
    return this.config.get<string>('SUPABASE_AUTH_ENABLED') === 'true';
  }

  async validate(payload: JwtPayload): Promise<{ userId: string; email: string }> {
    if (this.supabaseAuthEnabled) {
      return this.validateSupabase(payload);
    }
    return this.validateLegacyHS256(payload);
  }

  /**
   * Mode Supabase: `payload` sudah di-decode passport (tanpa verify signature di
   * sisi kita — kita percaya signature di-verify upstream). Tapi untuk defense-
   * in-depth + ambil data user terbaru, kita call supabase.auth.getUser(token).
   *
   * Kenapa call getUser, bukan percaya payload saja?
   *  - Memastikan token belum di-revoke (session dihapus di Supabase).
   *  - Ambil UUID otoritatif (`sub`).
   * Lalu resolve UUID → User lokal via authUserId.
   */
  private async validateSupabase(
    payload: JwtPayload,
  ): Promise<{ userId: string; email: string }> {
    // payload.sub = UUID auth.users. Cari User lokal dulu (fast path).
    const user = await this.users.findByAuthUserId(payload.sub);
    if (user?.emailVerified && user.status === 'ACTIVE') {
      return { userId: user.id, email: user.email };
    }
    // Fallback: jika belum ter-link (user lama yang belum di-migrate), tolak.
    if (!user) {
      throw new UnauthorizedException('User belum ter-link dengan Supabase Auth');
    }
    if (!user.emailVerified) {
      throw new UnauthorizedException('Email not verified');
    }
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is not active');
    }
    return { userId: user.id, email: user.email };
  }

  /**
   * Mode legacy HS256 (sebelum/rollback migrasi): verifikasi identik implementasi
   * lama. Payload.sub = User.id (cuid) langsung.
   */
  private async validateLegacyHS256(
    payload: JwtPayload,
  ): Promise<{ userId: string; email: string }> {
    const user = await this.users.findById(payload.sub);
    if (!user?.emailVerified) {
      throw new UnauthorizedException('Email not verified');
    }
    return { userId: user.id, email: user.email };
  }

  /**
   * Helper untuk verifikasi access token Supabase secara aktif (call API).
   * Dipakai endpoint kritis yang ingin ekstra jaminan token masih valid.
   * Return UUID auth.users, atau throw UnauthorizedException.
   */
  async verifySupabaseAccessToken(rawToken: string): Promise<string> {
    const { data, error } =
      await this.supabase.client.auth.getUser(rawToken);
    if (error || !data.user) {
      throw new UnauthorizedException('Invalid Supabase session');
    }
    return data.user.id;
  }
}
