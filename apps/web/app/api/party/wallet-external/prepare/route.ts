import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

/**
 * Proxy to Nest POST /party/wallet-external/prepare — langkah 1 onboarding
 * non-custodial: kirim public key (HEX, bukan private) + partyHint →
 * backend generate topology → balas multiHash untuk ditandatangani browser.
 * Private key TIDAK PERNAH melewati route ini.
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  return nestWithAccessCookie(req, '/party/wallet-external/prepare', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json' },
  });
}
