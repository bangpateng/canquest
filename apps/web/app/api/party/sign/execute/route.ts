import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

/**
 * Proxy to Nest POST /party/sign/execute — langkah 2 relay tanda tangan:
 * signature dari browser dikirim → backend submit ke ledger.
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  return nestWithAccessCookie(req, '/party/sign/execute', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json' },
  });
}
