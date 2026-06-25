import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

type AdminJwtPayload = { sub?: string; scope?: string; email?: string };

@Injectable()
export class AdminPanelJwtStrategy extends PassportStrategy(
  Strategy,
  'admin-jwt',
) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
    });
  }

  validate(payload: AdminJwtPayload) {
    if (payload.sub !== 'admin-panel' || payload.scope !== 'admin-panel') {
      throw new UnauthorizedException('Invalid token');
    }
    if (!payload.email) {
      throw new UnauthorizedException('Invalid token');
    }
    return { adminPanel: true as const, email: payload.email };
  }
}
