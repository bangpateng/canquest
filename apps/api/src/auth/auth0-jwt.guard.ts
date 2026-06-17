import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import * as jwksRsa from 'jwks-rsa';
import type { Request } from 'express';

/**
 * Auth0JwtGuard — validates RS256 JWT tokens issued by Auth0.
 *
 * Uses jwks-rsa to fetch the public key from the JWKS endpoint and
 * verifies the token signature + audience + issuer.
 *
 * Required env vars:
 *   AUTH_JWKS_URL             — JWKS endpoint, e.g. https://your-tenant.auth0.com/.well-known/jwks.json
 *   AUTH_URL                  — Auth0 tenant URL (used as issuer), e.g. https://your-tenant.auth0.com
 *   LEDGER_API_AUTH_AUDIENCE  — Expected audience claim in the token
 *
 * Usage:
 *   @UseGuards(Auth0JwtGuard)
 *   @Get('protected')
 *   async protectedEndpoint() { ... }
 */
@Injectable()
export class Auth0JwtGuard implements CanActivate {
  private readonly logger = new Logger(Auth0JwtGuard.name);
  private readonly jwksClient: jwksRsa.JwksClient;
  private readonly issuer: string;
  private readonly audience: string;

  constructor(private readonly config: ConfigService) {
    const jwksUri =
      config.get<string>('AUTH_JWKS_URL') ??
      `${(config.get<string>('AUTH_URL') ?? '').replace(/\/$/, '')}/.well-known/jwks.json`;

    this.jwksClient = jwksRsa({
      jwksUri,
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: 10 * 60 * 60 * 1000, // 10 hours
      rateLimit: true,
      jwksRequestsPerMinute: 10,
    });

    this.issuer = `${(config.get<string>('AUTH_URL') ?? '').replace(/\/$/, '')}/`;
    this.audience = config.get<string>('LEDGER_API_AUTH_AUDIENCE') ?? '';
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('Missing Bearer token');
    }

    try {
      await this.verifyToken(token);
      return true;
    } catch (err) {
      this.logger.warn(`Auth0JwtGuard: token verification failed — ${String(err)}`);
      throw new UnauthorizedException('Invalid or expired Auth0 token');
    }
  }

  private extractToken(request: Request): string | null {
    const authHeader = request.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    return authHeader.slice(7);
  }

  private verifyToken(token: string): Promise<jwt.JwtPayload> {
    return new Promise((resolve, reject) => {
      // Decode header to get kid (key ID) for JWKS lookup
      const decoded = jwt.decode(token, { complete: true });
      if (!decoded || typeof decoded === 'string') {
        return reject(new Error('Cannot decode token header'));
      }

      const kid = decoded.header.kid;
      if (!kid) {
        return reject(new Error('Token header missing kid'));
      }

      this.jwksClient.getSigningKey(kid, (err, key) => {
        if (err || !key) {
          return reject(err ?? new Error('Signing key not found'));
        }

        const signingKey = key.getPublicKey();

        jwt.verify(
          token,
          signingKey,
          {
            algorithms: ['RS256'],
            audience: this.audience || undefined,
            issuer: this.issuer || undefined,
          },
          (verifyErr, payload) => {
            if (verifyErr) return reject(verifyErr);
            resolve(payload as jwt.JwtPayload);
          },
        );
      });
    });
  }
}
