import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/nest-proxy-cookie-jwt';

/** Proxy to Nest POST /api/party/ensure-preapproval */
export async function POST(req: NextRequest) {
  return nestWithAccessCookie(req, '/party/ensure-preapproval', { method: 'POST' });
}
