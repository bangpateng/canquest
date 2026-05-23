import { type NextRequest } from 'next/server';
import { nestWithAccessCookie } from '@/lib/nest-proxy-cookie-jwt';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const page = searchParams.get('page') ?? '1';
  const pageSize = searchParams.get('pageSize') ?? '5';
  const qs = new URLSearchParams({ page, pageSize });
  return nestWithAccessCookie(req, `/quests/activity?${qs.toString()}`, { method: 'GET' });
}
