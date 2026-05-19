import { type NextRequest } from 'next/server';
import { nestWithAccessCookie } from '@/lib/nest-proxy-cookie-jwt';

export async function GET(req: NextRequest) {
  return nestWithAccessCookie(req, '/quests/my-progress', { method: 'GET' });
}
