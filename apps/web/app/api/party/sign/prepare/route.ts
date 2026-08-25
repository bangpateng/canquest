import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

/**
 * Proxy to Nest POST /party/sign/prepare — langkah 1 relay tanda tangan:
 * backend menyiapkan transaksi → hash dikirim ke browser untuk di-sign.
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  return nestWithAccessCookie(req, '/party/sign/prepare', {
    method: 'POST',
    body,
    headers: { 'Content-Type': 'application/json' },
  });
}
