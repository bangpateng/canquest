import { type NextRequest } from 'next/server';
import { nestWithAccessCookie } from '@/lib/nest-proxy-cookie-jwt';

export const dynamic = 'force-dynamic';

export async function DELETE(req: NextRequest) {
  return nestWithAccessCookie(req, '/twitter/disconnect', { method: 'DELETE' });
}
