import {
  CanActivate,
  ExecutionContext,
  Injectable,
  ForbiddenException,
} from '@nestjs/common';
import type { Request } from 'express';
import { ConfigService } from '@nestjs/config';

type AdminAuthedReq = Request & {
  user?: { adminPanel?: boolean; email?: string };
};

/**
 * Runs after Passport `admin-jwt` strategy: confirms this is an env-backed panel login
 * AND the JWT email still matches `ADMIN_PANEL_EMAIL` (handles env rotates).
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AdminAuthedReq>();
    const user = req.user;
    if (!user?.adminPanel || !user.email) {
      throw new ForbiddenException('Admin panel session required');
    }

    const norm = (s: string | undefined) =>
      s === undefined ? '' : s.replace(/^\ufeff/, '').trim();

    const expected =
      norm(this.config.get<string>('ADMIN_PANEL_EMAIL'))?.toLowerCase() ||
      norm(process.env.ADMIN_PANEL_EMAIL)?.toLowerCase();

    if (!expected || user.email.toLowerCase() !== expected) {
      throw new ForbiddenException(
        'Admin credentials were updated — sign in again',
      );
    }

    return true;
  }
}
