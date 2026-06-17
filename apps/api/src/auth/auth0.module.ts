import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Auth0TokenService } from './auth0-token.service';
import { Auth0JwtGuard } from './auth0-jwt.guard';

/**
 * Auth0Module — global module providing Auth0 M2M token service and JWT guard.
 *
 * Marked @Global() so Auth0TokenService is available for injection in any module
 * (e.g. CantonModule) without needing to import Auth0Module explicitly everywhere.
 *
 * Provides:
 *   - Auth0TokenService: fetches M2M tokens for dapp-admin and dapp-reward identities
 *   - Auth0JwtGuard: validates RS256 JWT tokens from Auth0 (for protected endpoints)
 *
 * Import in AppModule (or any root module) to make it globally available.
 */
@Global()
@Module({
  imports: [ConfigModule],
  providers: [Auth0TokenService, Auth0JwtGuard],
  exports: [Auth0TokenService, Auth0JwtGuard],
})
export class Auth0Module {}
