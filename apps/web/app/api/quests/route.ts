import { type NextRequest } from 'next/server';
import { nestWithAccessCookie } from '@/lib/nest-proxy-cookie-jwt';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const status = searchParams.get('status');
  const path = status ? `/quests?status=${status}` : '/quests';
  return nestWithAccessCookie(req, path, { method: 'GET' });
}
