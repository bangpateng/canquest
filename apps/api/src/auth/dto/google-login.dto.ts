import { IsString, MinLength } from 'class-validator';

/**
 * Body untuk `POST /auth/google`.
 *
 * `idToken` adalah Google ID Token yang diterima frontend dari
 * Google Identity Services (One Tap /GIS button). Backend verify signature,
 * audience, dan email_verified sebelum issue JWT CanQuest.
 */
export class GoogleLoginDto {
  @IsString()
  @MinLength(10)
  idToken!: string;
}
