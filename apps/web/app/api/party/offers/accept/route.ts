import { type NextRequest } from 'next/server';
import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';
export async function POST(req: NextRequest) {
  return nestWithAccessCookie(req, '/party/offers/accept', { method: 'POST', body: req.body });
}
