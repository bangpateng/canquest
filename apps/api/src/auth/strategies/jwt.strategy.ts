import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { UsersService } from '../../users/users.service';

/**
 * Strategi JWT tunggal (nama 'jwt') — HS256 only.
 *
 * Menerima DUA jenis token HS256 (sama secret, dibedakan via payload.kind):
 *
 *  1. Access token utama — payload.sub = User.id (cuid), email, no kind.
 *     Di-issue oleh AuthService.issueTokens(), di-set sebagai httpOnly cookie
 *     cq_access oleh BFF frontend.
 *
 *  2. SSE ephemeral token — payload.sub = User.id, kind:'sse', 60s TTL.
 *     Di-issue oleh AuthService.issueSseToken(), dikirim via query param
 *     /api/realtime/stream?token=... (tidak bisa pakai cookie karena EventSource).
 *
 * Signature diverifikasi pakai JWT_ACCESS_SECRET.
 */
export type JwtPayload = { sub: string; email?: string; kind?: string };

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    private readonly config: ConfigService,
    private readonly users: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKeyProvider: (_req, _rawToken, done) => {
        const secret = this.config.get<string>('JWT_ACCESS_SECRET');
        if (!secret) {
          return done(new UnauthorizedException('JWT secret not configured'));
        }
        return done(null, secret);
      },
      algorithms: ['HS256'],
      ignoreExpiration: false,
      passReqToCallback: true,
    });
  }

  /**
   * validate() dipanggil SETELAH passport memverifikasi signature HS256.
   * passReqToCallback=true untuk konsistensi dengan passport-jwt API.
   */
  async validate(
    _req: unknown,
    payload: JwtPayload,
  ): Promise<{ userId: string; email: string }> {
    // Token SSE ephemeral (kind:'sse') → langsung pakai sub sebagai userId.
    // Tidak perlu cek emailVerified/status — token ini di-issue internal
    // hanya untuk user yang sudah authenticated.
    if (payload.kind === 'sse') {
      return { userId: payload.sub, email: payload.email ?? '' };
    }

    // Access token utama → sub = User.id (cuid).
    const user = await this.users.findById(payload.sub);
    if (!user?.emailVerified) {
      throw new UnauthorizedException('Email not verified');
    }
    return { userId: user.id, email: user.email };
  }
}
