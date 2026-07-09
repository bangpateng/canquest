import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { createPublicKey, type JsonWebKey as NodeJsonWebKey } from 'crypto';
import { UsersService } from '../../users/users.service';
import { SupabaseService } from '../../supabase/supabase.service';

/**
 * Strategi JWT tunggal (nama 'jwt') yang menerima DUA jenis token:
 *
 *  1. Supabase access token (alg ES256) — saat SUPABASE_AUTH_ENABLED=true.
 *     Signature diverifikasi pakai public key Supabase (JWKS).
 *     payload.sub = UUID auth.users → resolve via User.authUserId.
 *
 *  2. Legacy HS256 token (dipakai SSE token + rollback) — diverifikasi pakai
 *     JWT_ACCESS_SECRET. payload.sub = User.id (cuid) langsung.
 *
 * Kenapa secretOrKeyProvider dinamis?
 *  passport-jwt memverifikasi SIGNATURE SEBELUM validate() dipanggil. Token
 *  Supabase pakai ES256, legacy pakai HS256 — algoritma berbeda butuh key
 *  berbeda. secretOrKeyProvider menerima raw token, jadi kita decode header
 *  (tanpa verify) untuk tau alg, lalu return key yang sesuai.
 *
 *  Untuk ES256, kita fetch & cache public key dari JWKS endpoint Supabase:
 *    https://<project>.supabase.co/auth/v1/.well-known/jwks.json
 */
export type JwtPayload = { sub: string; email?: string; kind?: string };

type Done = (err: unknown, secret?: string | Buffer) => void;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  private supabaseKidToPem = new Map<string, string>();
  private jwksFetchPromise: Promise<void> | null = null;

  constructor(
    private readonly config: ConfigService,
    private readonly users: UsersService,
    private readonly supabase: SupabaseService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      // Provider dinamis: dispatch key berdasarkan algoritma token.
      secretOrKeyProvider: (req, rawToken, done) =>
        this.provideSecret(rawToken, done),
      // Izinkan kedua algoritma. Verifikasi signature di-layer passport,
      // eksklusi token yang expired.
      algorithms: ['HS256', 'ES256'],
      ignoreExpiration: false,
      passReqToCallback: true,
    });
  }

  private get supabaseAuthEnabled(): boolean {
    return this.config.get<string>('SUPABASE_AUTH_ENABLED') === 'true';
  }

  /**
   * Decode JWT header (tanpa verify) untuk dapat alg + kid, lalu return key
   * yang sesuai. Dipanggil passport sebelum signature verification.
   */
  private async provideSecret(rawToken: string, done: Done): Promise<void> {
    try {
      const parts = rawToken.split('.');
      if (parts.length < 2) {
        return done(new UnauthorizedException('Malformed token'));
      }
      const headerJson = Buffer.from(parts[0], 'base64url').toString('utf8');
      const header = JSON.parse(headerJson) as {
        alg: string;
        kid?: string;
      };

      // ── Supabase ES256 → JWKS public key ──────────────────────────────────
      if (header.alg === 'ES256') {
        if (!this.supabaseAuthEnabled) {
          // Mode legacy tapi dapat token Supabase → tolak.
          return done(new UnauthorizedException('Supabase auth disabled'));
        }
        const pem = await this.getSupabasePublicKey(header.kid);
        if (!pem) {
          return done(new UnauthorizedException('Cannot verify token (no key)'));
        }
        return done(null, pem);
      }

      // ── Legacy HS256 → JWT_ACCESS_SECRET ──────────────────────────────────
      if (header.alg === 'HS256') {
        const secret = this.config.get<string>('JWT_ACCESS_SECRET');
        if (!secret) {
          return done(new UnauthorizedException('JWT secret not configured'));
        }
        return done(null, secret);
      }

      return done(new UnauthorizedException(`Unsupported alg: ${header.alg}`));
    } catch (err) {
      return done(
        new UnauthorizedException(
          `Token decode failed: ${err instanceof Error ? err.message : 'unknown'}`,
        ),
      );
    }
  }

  /**
   * Ambil public key Supabase untuk verifikasi ES256.
   * JWKS di-fetch sekali + cache per kid. Refetch kalau kid belum dikenal
   * (mendukung rotasi key Supabase).
   */
  private async getSupabasePublicKey(kid?: string): Promise<string | null> {
    if (kid && this.supabaseKidToPem.has(kid)) {
      return this.supabaseKidToPem.get(kid)!;
    }
    await this.ensureJwksFetched();
    if (kid && this.supabaseKidToPem.has(kid)) {
      return this.supabaseKidToPem.get(kid)!;
    }
    // Fallback: kalau cuma 1 key di JWKS & tanpa kid match, pakai itu.
    if (!kid && this.supabaseKidToPem.size >= 1) {
      return [...this.supabaseKidToPem.values()][0];
    }
    return null;
  }

  private async ensureJwksFetched(): Promise<void> {
    if (this.jwksFetchPromise) {
      return this.jwksFetchPromise;
    }
    this.jwksFetchPromise = this.fetchJwks();
    try {
      await this.jwksFetchPromise;
    } finally {
      this.jwksFetchPromise = null;
    }
  }

  private async fetchJwks(): Promise<void> {
    const url = this.config.get<string>('SUPABASE_URL');
    if (!url) return;
    const jwksUrl = `${url}/auth/v1/.well-known/jwks.json`;
    const res = await fetch(jwksUrl);
    if (!res.ok) {
      throw new UnauthorizedException(
        `JWKS fetch failed: HTTP ${res.status}`,
      );
    }
    const jwks = (await res.json()) as { keys: Array<JsonWebKey & { kid?: string }> };
    for (const jwk of jwks.keys ?? []) {
      const pem = await this.jwkToPem(jwk);
      if (jwk.kid) {
        this.supabaseKidToPem.set(jwk.kid, pem);
      }
    }
  }

  /**
   * Konversi JWK (EC P-256) → PEM pakai Node crypto.
   * Supabase pakai ES256 = ECDSA P-256.
   * Cast ke crypto.JsonWebKey supaya createPublicKey terima (DOM vs node lib
   * punya type JsonWebKey berbeda — isi sama, signature beda).
   */
  private async jwkToPem(jwk: JsonWebKey): Promise<string> {
    const keyObject = createPublicKey({
      key: jwk as unknown as NodeJsonWebKey,
      format: 'jwk',
    });
    return keyObject.export({ type: 'spki', format: 'pem' }).toString();
  }

  /**
   * validate() dipanggil SETELAH passport memverifikasi signature.
   * passReqToCallback=true → req ada di argumen pertama (untuk ambil raw token
   * kalau perlu verify tambahan via Supabase API).
   */
  async validate(
    req: unknown,
    payload: JwtPayload,
  ): Promise<{ userId: string; email: string }> {
    // Token SSE ephemeral (kind:'sse') → langsung pakai sub sebagai userId.
    if (payload.kind === 'sse') {
      return { userId: payload.sub, email: payload.email ?? '' };
    }

    // Token Supabase ES256 → sub = UUID auth.users.
    if (this.supabaseAuthEnabled && this.looksLikeUuid(payload.sub)) {
      return this.validateSupabase(payload);
    }

    // Legacy HS256 → sub = User.id (cuid).
    return this.validateLegacyHS256(payload);
  }

  /** Cek apakah string berbentuk UUID (token Supabase pakai UUID di sub). */
  private looksLikeUuid(s: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      s,
    );
  }

  /**
   * Mode Supabase: payload.sub = UUID auth.users. Resolve ke User lokal.
   * Signature sudah diverifikasi passport via JWKS — tidak perlu call getUser
   * lagi (hemat round-trip). Cukup cek user ada & aktif di DB lokal.
   */
  private async validateSupabase(
    payload: JwtPayload,
  ): Promise<{ userId: string; email: string }> {
    const user = await this.users.findByAuthUserId(payload.sub);
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
   * Mode legacy HS256: payload.sub = User.id (cuid).
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
}
