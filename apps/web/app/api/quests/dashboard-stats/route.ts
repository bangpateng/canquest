import { type NextRequest } from 'next/server';
import { nestWithAccessCookie } from '@/lib/nest-proxy-cookie-jwt';

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  return nestWithAccessCookie(req, '/quests/dashboard-stats', { method: 'GET' });
}
