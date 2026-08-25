import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

/**
 * Proxy to Nest POST /party/swap/prepare-external — M3b: siapkan leg input
 * swap (user → depositParty OneSwap) untuk ditandatangani browser user
 * external. Setelah sign, frontend memanggil /api/party/swap dengan
 * externalDepositDone=true.
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  return nestWithAccessCookie(req, '/party/swap/prepare-external', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json' },
  });
}
