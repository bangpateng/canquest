import { IsString, MinLength } from 'class-validator';

/**
 * DTO untuk connect X via OAuth (Supabase Auth).
 * Body: { oauthAccessToken: string }
 *
 * Token adalah access token Supabase Auth yang didapat frontend setelah user
 * selesai authorize aplikasi di Twitter (via `supabase.auth.signInWithOAuth`).
 * Backend verify token via `supabase.auth.getUser()` → identitas X diverifikasi
 * pemiliknya (bukan input teks manual).
 */
export class ConnectTwitterOAuthDto {
  @IsString()
  @MinLength(10, {
    message: 'OAuth access token is missing or too short.',
  })
  oauthAccessToken!: string;
}
