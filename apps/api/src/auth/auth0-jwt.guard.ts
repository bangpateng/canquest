import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { JwksClient } from 'jwks-rsa';
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
 *
 * NOTE: JwksClient is instantiated LAZILY on first use (not in constructor)
 * so that the guard can be registered as a global provider without crashing
 * the app at startup when AUTH_JWKS_URL is not yet configured.
 */
@Injectable()
export class Auth0JwtGuard implements CanActivate {
  private readonly logger = new Logger(Auth0JwtGuard.name);

  // Lazy — created on first call to this.jwks()
  private _jwksClient?: JwksClient;

  constructor(private readonly config: ConfigService) {
    // Intentionally empty — do NOT create JwksClient or read env here.
    // NestJS instantiates all providers at boot; creating the client here
    // would crash the app if AUTH_JWKS_URL is not configured.
  }

  /**
   * Lazy accessor for JwksClient.
   * Created on first call so that startup is never blocked by missing env vars.
   */
  private jwks(): JwksClient {
    if (!this._jwksClient) {
      const authUrl = (this.config.get<string>('AUTH_URL') ?? '').replace(/\/$/, '');
      const jwksUri =
        this.config.get<string>('AUTH_JWKS_URL') ??
        (authUrl ? `${authUrl}/.well-known/jwks.json` : '');

      this._jwksClient = new JwksClient({
        jwksUri,
        cache: true,
        cacheMaxEntries: 5,
        cacheMaxAge: 10 * 60 * 60 * 1000, // 10 hours
        rateLimit: true,
        jwksRequestsPerMinute: 10,
      });
    }
    return this._jwksClient;
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
    // Read issuer and audience at call time (not at construction time)
    const authUrl = (this.config.get<string>('AUTH_URL') ?? '').replace(/\/$/, '');
    const issuer = authUrl ? `${authUrl}/` : '';
    const audience = this.config.get<string>('LEDGER_API_AUTH_AUDIENCE') ?? '';

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

      this.jwks().getSigningKey(kid, (err, key) => {
        if (err || !key) {
          return reject(err ?? new Error('Signing key not found'));
        }

        const signingKey = key.getPublicKey();

        jwt.verify(
          token,
          signingKey,
          {
            algorithms: ['RS256'],
            audience: audience || undefined,
            issuer: issuer || undefined,
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
