import { type NextRequest } from 'next/server';

import { nestWithAccessCookie } from '@/lib/nest-proxy-cookie-jwt';

export async function POST(req: NextRequest) {
  return nestWithAccessCookie(req, '/spin/execute', { method: 'POST' });
}
