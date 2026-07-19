import { IsOptional, IsString, MinLength } from 'class-validator';

/**
 * Body untuk `POST /auth/google`.
 *
 * `idToken` adalah Google ID Token yang diterima frontend dari
 * Google Identity Services (One Tap /GIS button). Backend verify signature,
 * audience, dan email_verified sebelum issue JWT CanQuest.
 *
 * `referralCode` opsional — hanya dipakai saat user BARU (belum terdaftar).
 * Di-pass frontend dari sessionStorage `canquest_referral_ref` (link `?ref=`)
 * atau input manual. Existing user login Google → referral diabaikan
 * (referrer tidak boleh berubah post-signup).
 */
export class GoogleLoginDto {
  @IsString()
  @MinLength(10)
  idToken!: string;

  @IsOptional()
  @IsString()
  referralCode?: string;
}
