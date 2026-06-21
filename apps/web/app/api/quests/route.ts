import { type NextRequest } from 'next/server';
import { nestWithAccessCookie } from '@/lib/auth/nest-proxy-cookie-jwt';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');
  const qs = status ? `?${new URLSearchParams({ status }).toString()}` : '';
  return nestWithAccessCookie(req, `/quests${qs}`, { method: 'GET' });
}
