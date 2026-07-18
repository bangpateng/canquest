import { type NextRequest } from 'next/server';
import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

export const dynamic = 'force-dynamic';

/**
 * GET /api/twitter/auth-url
 *
 * Mulai OAuth flow Twitter. Proxy ke NestJS `/twitter/auth-url` yang akan:
 *   1. Generate code_verifier + code_challenge (PKCE S256).
 *   2. Simpan state ↔ { userId, codeVerifier } di Redis (TTL 10 menit).
 *   3. Return authorization URL Twitter.
 *
 * Frontend redirect browser ke URL ini, user authorize di Twitter, lalu
 * Twitter redirect ke /api/twitter/oauth/callback?code=...&state=...
 */
export async function GET(req: NextRequest) {
  return nestWithAccessCookie(req, '/twitter/auth-url', { method: 'GET' });
}
