import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

/**
 * Proxy to Nest POST /party/wallet-external/complete — langkah 2 onboarding
 * non-custodial: kirim SIGNATURE (hasil sign multiHash dengan kunci user di
 * browser) → backend allocate external party + bind ke akun.
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  return nestWithAccessCookie(req, '/party/wallet-external/complete', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json' },
  });
}
