import { type NextRequest } from 'next/server';
import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

/** POST /api/party/sign/preapproval/disable — cancel preapproval via validator API. */
export async function POST(req: NextRequest) {
  return nestWithAccessCookie(req, '/party/sign/preapproval/disable', {
    method: 'POST',
  });
}
